// AURIS360 browser/PWA push worker.

const crypto = require('crypto');
const webpush = require('web-push');

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 5;

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (!process.env.CRON_SECRET || authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    validateEnvironment();
    configureWebPush();
    return res.status(200).json(await processPushQueue());
  } catch (error) {
    return res.status(500).json({ error: safeError(error) });
  }
};

async function processPushQueue() {
  const context = supabaseContext();
  const workerId = 'push-' + crypto.randomUUID();
  const jobs = await claimJobs(context, workerId);
  let sent = 0, retried = 0, expired = 0, failed = 0;

  for (const job of jobs) {
    try {
      const detail = await loadJobDetail(context, job);
      if (!detail || !detail.subscription || !detail.notification) {
        await patchJob(context, job.id, finalPatch('skipped', { error_msg: 'Push source or subscription no longer exists' }));
        failed++;
        continue;
      }

      const notification = detail.notification;
      const subscription = detail.subscription;
      const policy = await evaluateDeliveryPolicy(context, notification, 'push');
      if (policy && policy.allowed === false) {
        await patchJob(context, job.id, finalPatch('skipped', { error_msg: 'Recipient preference: ' + policy.reason })); failed++; continue;
      }
      if (policy && policy.deliver_after && new Date(policy.deliver_after).getTime() > Date.now() + 15000) {
        await patchJob(context, job.id, {status:'pending',next_attempt_at:policy.deliver_after,locked_at:null,locked_by:null,error_msg:'Delivery deferred by recipient policy: '+policy.reason,updated_at:new Date().toISOString()}); retried++; continue;
      }
      if (policy && policy.override) await logPolicyOverride(context, notification, 'push', policy.reason);
      const payload = JSON.stringify({
        notificationId: notification.id,
        title: notification.title || 'AURIS360 Alert',
        body: plainText(notification.message || '').slice(0, 240),
        url: notification.record_url || '/',
        tag: 'auris360-' + notification.id,
        urgent: notification.severity === 'urgent',
        acknowledgementRequired: !!notification.acknowledgement_required,
        actions: notification.acknowledgement_required
          ? [{ action: 'open', title: 'Open in AURIS360' }]
          : []
      });

      const result = await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth_secret }
      }, payload, {
        TTL: notification.severity === 'urgent' ? 86400 : 14400,
        urgency: notification.severity === 'urgent' ? 'high' : 'normal',
        topic: topicFor(notification.id)
      });

      await patchJob(context, job.id, finalPatch('sent', {
        sent_at: new Date().toISOString(), provider_status: result && result.statusCode || 201, error_msg: null
      }));
      sent++;
    } catch (error) {
      const statusCode = Number(error && error.statusCode || 0);
      if (statusCode === 404 || statusCode === 410) {
        await disableSubscription(context, job.subscription_id, 'Browser push subscription expired');
        await patchJob(context, job.id, finalPatch('expired', { provider_status: statusCode, error_msg: safeError(error) }));
        expired++;
      } else if (isTransient(error) && Number(job.attempt_count || 1) < MAX_ATTEMPTS) {
        await patchJob(context, job.id, {
          status: 'pending', next_attempt_at: new Date(Date.now() + retryDelayMs(job.attempt_count || 1)).toISOString(),
          provider_status: statusCode || null, error_msg: safeError(error), locked_at: null, locked_by: null,
          updated_at: new Date().toISOString()
        });
        retried++;
      } else {
        await patchJob(context, job.id, finalPatch('failed', { provider_status: statusCode || null, error_msg: safeError(error) }));
        failed++;
      }
    }
  }
  return { sent, retried, expired, failed, total: jobs.length };
}

async function evaluateDeliveryPolicy(context, notification, channel) {
  const response=await fetch(context.baseUrl+'/rest/v1/rpc/evaluate_notification_delivery_policy',{method:'POST',headers:{...context.headers,'Content-Type':'application/json'},body:JSON.stringify({p_company_id:notification.company_id,p_profile_id:notification.recipient_profile_id,p_channel:channel,p_severity:notification.severity||'normal',p_ack_required:!!notification.acknowledgement_required})});
  if(response.ok)return response.json();const detail=await response.text();if(response.status===404||/PGRST202|schema cache|evaluate_notification_delivery_policy/i.test(detail))return null;throw transientError('Unable to evaluate recipient delivery policy');
}
async function logPolicyOverride(context,n,channel,reason){await fetch(context.baseUrl+'/rest/v1/notification_events',{method:'POST',headers:{...context.headers,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({company_id:n.company_id,notification_id:n.source_notification_id,event_type:'mandatory_alert_override',related_module:n.related_module||null,related_table:n.related_table||null,related_id:n.related_id||null,related_ref:n.related_ref||null,detail:{channel,reason,recipient_profile_id:n.recipient_profile_id}})});}

function validateEnvironment() {
  const required = ['SUPABASE_URL','SUPABASE_SERVICE_KEY','VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_SUBJECT'];
  const missing = required.filter(name => !process.env[name]);
  if (missing.length) throw new Error('Missing required environment variables: ' + missing.join(', '));
}

function configureWebPush() {
  const subject = String(process.env.VAPID_SUBJECT);
  if (!/^mailto:.+@.+\..+|^https:\/\//i.test(subject)) throw new Error('VAPID_SUBJECT must be a mailto: address or HTTPS URL');
  webpush.setVapidDetails(subject, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}

function supabaseContext() {
  const baseUrl = String(process.env.SUPABASE_URL).replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_KEY;
  return { baseUrl, headers: { apikey: key, Authorization: 'Bearer ' + key } };
}

async function claimJobs(context, workerId) {
  const response = await fetch(context.baseUrl + '/rest/v1/rpc/claim_push_delivery_jobs', {
    method: 'POST', headers: { ...context.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_limit: BATCH_SIZE, p_worker_id: workerId })
  });
  if (!response.ok) throw new Error('Unable to claim push jobs: ' + response.status + ' ' + (await response.text()).slice(0, 300));
  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

async function loadJobDetail(context, job) {
  const [subscriptionResponse, notificationResponse] = await Promise.all([
    fetch(context.baseUrl + '/rest/v1/push_subscriptions?id=eq.' + encodeURIComponent(job.subscription_id) + '&enabled=eq.true&limit=1', { headers: context.headers }),
    fetch(context.baseUrl + '/rest/v1/user_notifications?id=eq.' + encodeURIComponent(job.user_notification_id) + '&dismissed_at=is.null&limit=1', { headers: context.headers })
  ]);
  if (!subscriptionResponse.ok || !notificationResponse.ok) throw transientError('Unable to load push job detail');
  const subscriptions = await subscriptionResponse.json();
  const notifications = await notificationResponse.json();
  return { subscription: subscriptions[0] || null, notification: notifications[0] || null };
}

async function patchJob(context, id, patch) {
  const response = await fetch(context.baseUrl + '/rest/v1/push_delivery_jobs?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH', headers: { ...context.headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(patch)
  });
  if (!response.ok) throw new Error('Unable to update push job: ' + response.status);
}

async function disableSubscription(context, id, reason) {
  await fetch(context.baseUrl + '/rest/v1/push_subscriptions?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH', headers: { ...context.headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ enabled: false, disabled_at: new Date().toISOString(), disabled_reason: reason, updated_at: new Date().toISOString() })
  });
}

function finalPatch(status, patch) {
  return { ...patch, status, locked_at: null, locked_by: null, updated_at: new Date().toISOString() };
}

function topicFor(id) { return crypto.createHash('sha256').update(String(id)).digest('base64url').slice(0, 32); }
function plainText(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function retryDelayMs(attempt) { return Math.min(60, Math.pow(2, Math.max(0, Number(attempt) - 1))) * 60 * 1000; }
function transientError(message) { const error = new Error(message); error.transient = true; return error; }
function isTransient(error) {
  if (error && error.transient === true) return true;
  const status = Number(error && error.statusCode || 0);
  return status === 408 || status === 429 || status >= 500 || /timeout|network|temporar|connection/i.test(safeError(error));
}
function safeError(error) { return String(error && error.message ? error.message : error || 'Unknown error').slice(0, 500); }

module.exports._test = { evaluateDeliveryPolicy, isTransient, plainText, retryDelayMs, topicFor };
