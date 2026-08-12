// AURIS360 Email Worker - Vercel Serverless Function
// Uses an atomic database lease when notification_delivery_reliability_upgrade.sql
// is installed. Falls back to the legacy pending-row reader during rollout.

const crypto = require('crypto');

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 50;

module.exports = async function handler(req, res) {
  const cronHeader = req.headers['x-vercel-cron'];
  const authHeader = req.headers['authorization'];
  if (!cronHeader && authHeader !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    validateEnvironment();
    const results = await processEmailQueue();
    return res.status(200).json(results);
  } catch (err) {
    return res.status(500).json({ error: safeError(err) });
  }
};

async function processEmailQueue() {
  const context = supabaseContext();
  const workerId = 'email-' + crypto.randomUUID();
  const claim = await claimNotifications(context, workerId);
  const notifications = claim.rows;

  if (!notifications.length) {
    return { sent: 0, retried: 0, failed: 0, skipped: 0, mode: claim.mode, message: 'No due notifications' };
  }

  let sent = 0;
  let retried = 0;
  let failed = 0;
  let skipped = 0;

  for (const notification of notifications) {
    try {
      const policy = await evaluateDeliveryPolicy(context, notification, 'email');
      if (policy && policy.allowed === false) {
        await patchNotification(context, notification.id, finalPatch(claim.mode, { status: 'skipped', error_msg: 'Recipient preference: ' + policy.reason }));
        skipped++; continue;
      }
      if (policy && policy.deliver_after && new Date(policy.deliver_after).getTime() > Date.now() + 15000) {
        await patchNotification(context, notification.id, { status:'pending', next_attempt_at:policy.deliver_after, locked_at:null, locked_by:null, error_msg:'Delivery deferred by recipient policy: '+policy.reason });
        retried++; continue;
      }
      if (policy && policy.override) await logPolicyOverride(context, notification, 'email', policy.reason);
      if (!isDeliverableEmail(notification.to_email)) {
        await patchNotification(context, notification.id, finalPatch(claim.mode, {
          status: 'skipped',
          error_msg: 'No deliverable email address. Use an enabled in-app or verified alternate channel.',
          sent_at: new Date().toISOString()
        }));
        skipped++;
        continue;
      }

      const settings = await loadNotificationSettings(context, notification.company_id);
      const disabledReason = emailDisabledReason(notification, settings);
      if (disabledReason) {
        await patchNotification(context, notification.id, finalPatch(claim.mode, {
          status: 'skipped',
          error_msg: disabledReason
        }));
        skipped++;
        continue;
      }

      const sendResult = await sendNotificationEmail(notification);
      if (!sendResult.ok) {
        const providerError = new Error(sendResult.error || 'Email provider error');
        providerError.transient = !!sendResult.transient;
        throw providerError;
      }

      const sentAt = new Date().toISOString();
      await patchNotification(context, notification.id, finalPatch(claim.mode, {
        status: 'sent',
        sent_at: sentAt,
        error_msg: null,
        resend_id: sendResult.provider === 'resend' ? sendResult.providerId || null : null,
        provider: sendResult.provider,
        provider_message_id: sendResult.providerId || null
      }));
      sent++;
    } catch (err) {
      const attempts = claim.mode === 'leased'
        ? Number(notification.attempt_count || 1)
        : Number(notification.retry_count || 0) + 1;
      const canRetry = claim.mode === 'leased' && isTransientError(err) && attempts < MAX_ATTEMPTS;

      if (canRetry) {
        await patchNotification(context, notification.id, {
          status: 'pending',
          error_msg: safeError(err),
          retry_count: attempts,
          next_attempt_at: new Date(Date.now() + retryDelayMs(attempts)).toISOString(),
          locked_at: null,
          locked_by: null
        });
        retried++;
      } else {
        await patchNotification(context, notification.id, finalPatch(claim.mode, {
          status: 'failed',
          error_msg: safeError(err),
          retry_count: attempts
        }));
        failed++;
      }
    }
  }

  return { sent, retried, failed, skipped, total: notifications.length, mode: claim.mode };
}

async function evaluateDeliveryPolicy(context, notification, channel) {
  if (!notification.recipient_profile_id) return null;
  const response = await fetch(context.baseUrl + '/rest/v1/rpc/evaluate_notification_delivery_policy', {
    method:'POST', headers:{...context.headers,'Content-Type':'application/json'}, body:JSON.stringify({
      p_company_id:notification.company_id,p_profile_id:notification.recipient_profile_id,p_channel:channel,
      p_severity:notification.priority||'normal',p_ack_required:!!(notification.metadata&&notification.metadata.acknowledgement_required)
    })
  });
  if (response.ok) return response.json();
  const detail=await response.text();
  if (response.status===404||/PGRST202|schema cache|evaluate_notification_delivery_policy/i.test(detail)) return null;
  throw transientError('Unable to evaluate recipient delivery policy');
}
async function logPolicyOverride(context, notification, channel, reason) {
  await fetch(context.baseUrl+'/rest/v1/notification_events',{method:'POST',headers:{...context.headers,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify({company_id:notification.company_id,notification_id:notification.id,event_type:'mandatory_alert_override',related_module:notification.related_module||null,related_table:notification.related_table||null,related_id:notification.related_id||null,related_ref:notification.related_ref||null,detail:{channel,reason,recipient_profile_id:notification.recipient_profile_id}})});
}

function validateEnvironment() {
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'].filter(name => !process.env[name]);
  if (missing.length) throw new Error('Missing required environment variables: ' + missing.join(', '));
}

function supabaseContext() {
  const baseUrl = String(process.env.SUPABASE_URL).replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_KEY;
  return {
    baseUrl,
    headers: { apikey: key, Authorization: 'Bearer ' + key }
  };
}

async function claimNotifications(context, workerId) {
  const response = await fetch(context.baseUrl + '/rest/v1/rpc/claim_notification_queue', {
    method: 'POST',
    headers: { ...context.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_limit: BATCH_SIZE, p_worker_id: workerId })
  });

  if (response.ok) {
    const rows = await response.json();
    return { rows: Array.isArray(rows) ? rows : [], mode: 'leased' };
  }

  const detail = await response.text();
  if (!isMissingClaimFunction(response.status, detail)) {
    throw new Error('Unable to claim notification queue: ' + response.status + ' ' + detail.slice(0, 300));
  }

  const legacy = await fetch(
    context.baseUrl + '/rest/v1/notification_queue?status=eq.pending&order=created_at.asc&limit=' + BATCH_SIZE,
    { headers: context.headers }
  );
  if (!legacy.ok) throw new Error('Unable to read notification queue: ' + legacy.status + ' ' + (await legacy.text()).slice(0, 300));
  const rows = await legacy.json();
  return { rows: Array.isArray(rows) ? rows : [], mode: 'legacy' };
}

function isMissingClaimFunction(status, detail) {
  return status === 404 || /PGRST202|claim_notification_queue|schema cache/i.test(String(detail || ''));
}

async function loadNotificationSettings(context, companyId) {
  const response = await fetch(
    context.baseUrl + '/rest/v1/notification_settings?company_id=eq.' + encodeURIComponent(companyId) + '&limit=1',
    { headers: context.headers }
  );
  if (!response.ok) throw transientError('Unable to load notification settings: ' + response.status);
  const rows = await response.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : {};
}

function emailDisabledReason(notification, settings) {
  if (settings.email_enabled === false) return 'Email notifications disabled for company';
  const preference = preferenceForType(notification.type);
  if (preference && settings[preference] === false) {
    return 'Notification type disabled by company preference: ' + preference;
  }
  return null;
}

function preferenceForType(type) {
  const value = String(type || '').toLowerCase();
  if (value === 'permit' || value.startsWith('permit_')) return 'notify_on_permit';
  if (value.startsWith('incident')) return 'notify_on_incident';
  if (value.startsWith('investigation')) return 'notify_on_investigation';
  if (value.startsWith('audit') || value.startsWith('inspection')) return 'notify_on_audit';
  if (value === 'action_due_soon' || value === 'action_overdue' || value === 'overdue_digest') return 'notify_on_overdue';
  return null;
}

async function patchNotification(context, id, body) {
  const response = await fetch(context.baseUrl + '/rest/v1/notification_queue?id=eq.' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: { ...context.headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error('Unable to update notification ' + id + ': ' + response.status + ' ' + (await response.text()).slice(0, 300));
}

function finalPatch(mode, patch) {
  if (mode !== 'leased') {
    const legacy = { ...patch };
    delete legacy.provider;
    delete legacy.provider_message_id;
    return legacy;
  }
  return { ...patch, locked_at: null, locked_by: null, next_attempt_at: new Date().toISOString() };
}

function isDeliverableEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return false;
  return !value.endsWith('.local');
}

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

async function sendNotificationEmail(notification) {
  const prepared = { ...notification, body_html: trackedEmailHtml(notification) };
  if (smtpConfigured()) return sendWithSmtp(prepared);
  if (process.env.RESEND_API_KEY) return sendWithResend(prepared);
  return {
    ok: false,
    transient: false,
    error: 'Email sender is not configured. Add SMTP_HOST, SMTP_USER and SMTP_PASS, or RESEND_API_KEY.'
  };
}

function trackedEmailHtml(notification) {
  const html=String(notification.body_html||''),secret=process.env.NOTIFICATION_LINK_SECRET;
  if(!secret||!notification.id)return html;
  const base=String(process.env.APP_BASE_URL||'https://auris-360.vercel.app').replace(/\/$/,''),expires=Date.now()+30*86400000;
  return html.replace(/href=(['"])(https:\/\/[^'"\s>]+)\1/gi,function(match,quote,encoded){
    const destination=encoded.replace(/&amp;/g,'&');
    try{const url=new URL(destination);if(url.origin!==new URL(base).origin)return match;}catch(_){return match;}
    const token=require('crypto').createHmac('sha256',secret).update(notification.id+'|'+expires+'|'+destination).digest('base64url');
    const tracked=base+'/api/notification-open?n='+encodeURIComponent(notification.id)+'&e='+expires+'&d='+Buffer.from(destination).toString('base64url')+'&t='+encodeURIComponent(token);
    return 'href='+quote+tracked+quote;
  });
}

async function sendWithSmtp(notification) {
  try {
    const nodemailer = require('nodemailer');
    const port = Number(process.env.SMTP_PORT || 587);
    const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
    const fromAddress = process.env.EMAIL_FROM || process.env.SMTP_USER;
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    const info = await transporter.sendMail({
      from: fromAddress,
      to: notification.to_name
        ? '"' + String(notification.to_name).replace(/"/g, '') + '" <' + notification.to_email + '>'
        : notification.to_email,
      subject: notification.subject,
      html: notification.body_html
    });
    return { ok: true, provider: 'smtp', providerId: info && info.messageId ? info.messageId : null };
  } catch (err) {
    return { ok: false, transient: isTransientError(err), error: safeError(err) };
  }
}

async function sendWithResend(notification) {
  const fromAddress = process.env.EMAIL_FROM || 'AURIS360 by SEPHS Consulting <onboarding@resend.dev>';
  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + process.env.RESEND_API_KEY,
        'Idempotency-Key': notification.idempotency_key || 'notification/' + notification.id
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [notification.to_email],
        subject: notification.subject,
        html: notification.body_html
      })
    });
  } catch (err) {
    return { ok: false, transient: true, error: safeError(err) };
  }

  if (!response.ok) {
    let message = 'Resend error ' + response.status;
    try {
      const providerError = await response.json();
      message = providerError.message || message;
    } catch (_) {}
    return { ok: false, transient: response.status === 429 || response.status >= 500, error: message };
  }

  let providerId = null;
  try {
    const body = await response.json();
    providerId = body && body.id;
  } catch (_) {}
  return { ok: true, provider: 'resend', providerId };
}

function retryDelayMs(attempt) {
  const minutes = Math.min(60, Math.pow(2, Math.max(0, Number(attempt) - 1)));
  return minutes * 60 * 1000;
}

function transientError(message) {
  const error = new Error(message);
  error.transient = true;
  return error;
}

function isTransientError(error) {
  if (error && typeof error.transient === 'boolean') return error.transient;
  const code = String(error && error.code || '').toUpperCase();
  const responseCode = Number(error && error.responseCode);
  const message = safeError(error).toLowerCase();
  // SMTP 4xx responses are temporary; SMTP 5xx responses are permanent.
  // HTTP provider failures set the explicit `transient` flag before this path.
  if ([421, 429, 450, 451, 452].includes(responseCode)) return true;
  return /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENETUNREACH/.test(code) ||
    /timeout|temporar|rate limit|connection|network|try again|service unavailable/.test(message);
}

function safeError(error) {
  return String(error && error.message ? error.message : error || 'Unknown error').slice(0, 500);
}

module.exports._test = {
  emailDisabledReason,
  isDeliverableEmail,
  isMissingClaimFunction,
  isTransientError,
  preferenceForType,
  retryDelayMs
  ,evaluateDeliveryPolicy
  ,trackedEmailHtml
};
