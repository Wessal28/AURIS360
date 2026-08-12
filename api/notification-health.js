// Read-only notification delivery health for authorised AURIS360 administrators.
// Secret values never leave the server; only configuration booleans are returned.

const ALLOWED_ROLES = new Set(['sephs_admin','admin','hse_manager','hse_officer']);

module.exports = async function handler(req, res) {
  if (String(req.method || 'GET').toUpperCase() !== 'GET') return res.status(405).json({ error: 'GET only' });
  try {
    validateEnvironment();
    const context = supabaseContext();
    const user = await authenticateUser(req, context);
    const profile = await loadProfile(context, user.id);
    if (!profile || !ALLOWED_ROLES.has(profile.role)) return res.status(403).json({ error: 'Administrator access required' });
    const requested = String(req.query && req.query.company_id || '').trim();
    const companyId = profile.role === 'sephs_admin' && requested ? requested : profile.company_id;
    if (!companyId) return res.status(400).json({ error: 'Company context is required' });
    return res.status(200).json(await buildHealth(context, companyId));
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: safeError(error) });
  }
};

async function buildHealth(context, companyId) {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const [queue, pushJobs, whatsappJobs, pushSubscriptions, optedProfiles, whatsappSettings, linkOpens] = await Promise.all([
    readRows(context, '/notification_queue?select=status,channel,created_at,error_msg&company_id=eq.' + enc(companyId) + '&created_at=gte.' + enc(since) + '&limit=5000'),
    readRows(context, '/push_delivery_jobs?select=status,created_at,error_msg&company_id=eq.' + enc(companyId) + '&created_at=gte.' + enc(since) + '&limit=5000', true),
    readRows(context, '/whatsapp_delivery_jobs?select=status,created_at,error_msg&company_id=eq.' + enc(companyId) + '&created_at=gte.' + enc(since) + '&limit=5000', true),
    readRows(context, '/push_subscriptions?select=id&company_id=eq.' + enc(companyId) + '&enabled=eq.true&limit=5000', true),
    readRows(context, '/profiles?select=id&company_id=eq.' + enc(companyId) + '&whatsapp_opted_in_at=not.is.null&whatsapp_opted_out_at=is.null&limit=5000', true),
    readRows(context, '/whatsapp_channel_settings?select=enabled,phone_number_id,alert_template_name,template_language,minimum_escalation_level&company_id=eq.' + enc(companyId) + '&limit=1', true),
    readRows(context, '/notification_link_opens?select=notification_id,first_opened_at,open_count&company_id=eq.' + enc(companyId) + '&first_opened_at=gte.' + enc(since) + '&limit=5000', true)
  ]);

  const emailRows = queue.rows.filter(row => !row.channel || row.channel === 'email');
  const emailConfigured = !!((process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) || process.env.RESEND_API_KEY);
  const emailWebhook = !!(process.env.RESEND_API_KEY && process.env.RESEND_WEBHOOK_SECRET);
  const pushConfigured = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
  const whatsappSecrets = !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_APP_SECRET && process.env.WHATSAPP_VERIFY_TOKEN);
  const waSetting = whatsappSettings.rows[0] || {};
  const whatsappConfigured = whatsappSecrets && waSetting.enabled === true && !!waSetting.phone_number_id;

  return {
    companyId,
    checkedAt: new Date().toISOString(),
    periodDays: 7,
    channels: {
      email: channelHealth(emailConfigured, emailRows, ['failed','bounced'], {
        provider: process.env.SMTP_HOST ? 'smtp' : process.env.RESEND_API_KEY ? 'resend' : null,
        deliveryWebhookConfigured: emailWebhook,
        signedRecordLinksConfigured: !!process.env.NOTIFICATION_LINK_SECRET,
        uniqueRecordOpens: linkOpens.rows.length,
        deliveredToOpenPercent: conversionPercent(emailRows.filter(row=>row.status==='delivered').length,linkOpens.rows.length)
      }),
      inApp: {
        status: queue.missing ? 'setup' : 'operational', configured: !queue.missing,
        queued: queue.rows.length, note: queue.missing ? 'Notification queue migration is missing' : 'Personal inbox derives from the governed queue'
      },
      push: channelHealth(pushConfigured && !pushJobs.missing, pushJobs.rows, ['failed','expired'], {
        activeSubscriptions: pushSubscriptions.rows.length, schemaInstalled: !pushJobs.missing
      }),
      whatsapp: channelHealth(whatsappConfigured && !whatsappJobs.missing, whatsappJobs.rows, ['failed'], {
        secretsConfigured: whatsappSecrets, tenantEnabled: waSetting.enabled === true,
        phoneNumberConfigured: !!waSetting.phone_number_id, template: waSetting.alert_template_name || null,
        activeConsents: optedProfiles.rows.length, schemaInstalled: !whatsappJobs.missing
      })
    },
    schedules: {
      mode: 'daily_safety',
      warning: 'Daily Hobby-plan schedules are safety fallbacks. Urgent production delivery requires five-minute external or Vercel Pro schedules.'
    },
    schemaWarnings: [queue,pushJobs,whatsappJobs,pushSubscriptions,optedProfiles,whatsappSettings,linkOpens]
      .filter(item => item.missing).map(item => item.label)
  };
}

function conversionPercent(delivered,opened){return delivered>0?Math.round(Math.min(opened,delivered)/delivered*100):null;}

function channelHealth(configured, rows, failureStates, extra) {
  const counts = {};
  rows.forEach(row => { const key=String(row.status || 'unknown').toLowerCase(); counts[key]=(counts[key]||0)+1; });
  const failures = failureStates.reduce((sum,key) => sum + (counts[key] || 0), 0);
  const pending = (counts.pending || 0) + (counts.processing || 0);
  return { ...extra, configured, status: !configured ? 'setup' : failures ? 'review' : 'operational', counts, failures, pending, total: rows.length };
}

async function authenticateUser(req, context) {
  const authorization = String(req.headers.authorization || '');
  if (!authorization.startsWith('Bearer ')) throw httpError(401, 'Authentication required');
  const response = await fetch(context.baseUrl + '/auth/v1/user', { headers: { apikey: context.key, Authorization: authorization } });
  if (!response.ok) throw httpError(401, 'Invalid or expired session');
  return response.json();
}
async function loadProfile(context, userId) {
  const rows = await readRows(context, '/profiles?select=id,company_id,role&id=eq.' + enc(userId) + '&limit=1');
  return rows.rows[0] || null;
}
async function readRows(context, path, optional) {
  const label = path.split('?')[0].replace(/^\//,'');
  const response = await fetch(context.baseUrl + '/rest/v1' + path, { headers: context.headers });
  if (response.ok) return { rows: await response.json(), missing: false, label };
  const detail = await response.text();
  if (optional && (response.status === 404 || /PGRST205|schema cache|does not exist/i.test(detail))) return { rows: [], missing: true, label };
  throw new Error('Unable to inspect ' + label + ': ' + response.status + ' ' + detail.slice(0,200));
}
function validateEnvironment(){const missing=['SUPABASE_URL','SUPABASE_SERVICE_KEY'].filter(name=>!process.env[name]);if(missing.length)throw new Error('Missing required environment variables: '+missing.join(', '));}
function supabaseContext(){const baseUrl=String(process.env.SUPABASE_URL).replace(/\/$/,'');const key=process.env.SUPABASE_SERVICE_KEY;return {baseUrl,key,headers:{apikey:key,Authorization:'Bearer '+key}};}
function enc(value){return encodeURIComponent(String(value));}
function httpError(statusCode,message){const error=new Error(message);error.statusCode=statusCode;return error;}
function safeError(error){return String(error&&error.message?error.message:error||'Unknown error').slice(0,500);}

module.exports._test={channelHealth,conversionPercent};
