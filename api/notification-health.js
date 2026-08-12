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
    const simulate = String(req.query && req.query.simulate || '').toLowerCase() === 'true';
    return res.status(200).json(await buildHealth(context, companyId, simulate));
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: safeError(error) });
  }
};

async function buildHealth(context, companyId, simulate) {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const [queue, pushJobs, whatsappJobs, pushSubscriptions, optedProfiles, whatsappSettings, linkOpens,
    inbox, events, escalationSettings, escalationRecipients, profiles, preferences, acknowledgementSettings] = await Promise.all([
    readRows(context, '/notification_queue?select=status,channel,created_at,error_msg&company_id=eq.' + enc(companyId) + '&created_at=gte.' + enc(since) + '&limit=5000'),
    readRows(context, '/push_delivery_jobs?select=status,created_at,error_msg&company_id=eq.' + enc(companyId) + '&created_at=gte.' + enc(since) + '&limit=5000', true),
    readRows(context, '/whatsapp_delivery_jobs?select=status,created_at,error_msg&company_id=eq.' + enc(companyId) + '&created_at=gte.' + enc(since) + '&limit=5000', true),
    readRows(context, '/push_subscriptions?select=id&company_id=eq.' + enc(companyId) + '&enabled=eq.true&limit=5000', true),
    readRows(context, '/profiles?select=id&company_id=eq.' + enc(companyId) + '&whatsapp_opted_in_at=not.is.null&whatsapp_opted_out_at=is.null&limit=5000', true),
    readRows(context, '/whatsapp_channel_settings?select=enabled,phone_number_id,alert_template_name,template_language,minimum_escalation_level&company_id=eq.' + enc(companyId) + '&limit=1', true),
    readRows(context, '/notification_link_opens?select=notification_id,first_opened_at,open_count&company_id=eq.' + enc(companyId) + '&first_opened_at=gte.' + enc(since) + '&limit=5000', true),
    readRows(context, '/user_notifications?select=id&company_id=eq.' + enc(companyId) + '&limit=1', true),
    readRows(context, '/notification_events?select=id&company_id=eq.' + enc(companyId) + '&limit=1', true),
    readRows(context, '/notification_escalation_settings?select=enabled,due_soon_days,level_1_overdue_days,level_2_overdue_days,level_3_overdue_days&company_id=eq.' + enc(companyId) + '&limit=1', true),
    readRows(context, '/notification_escalation_recipients?select=escalation_level,profile_id,email_override,active&company_id=eq.' + enc(companyId) + '&active=eq.true&limit=500', true),
    readRows(context, '/profiles?select=id,role,email,real_email&company_id=eq.' + enc(companyId) + '&limit=5000'),
    readRows(context, '/notification_user_preferences?select=id&company_id=eq.' + enc(companyId) + '&limit=1', true),
    readRows(context, '/notification_acknowledgement_settings?select=enabled&company_id=eq.' + enc(companyId) + '&limit=1', true)
  ]);

  const emailRows = queue.rows.filter(row => !row.channel || row.channel === 'email');
  const emailConfigured = !!((process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) || process.env.RESEND_API_KEY);
  const emailWebhook = !!(process.env.RESEND_API_KEY && process.env.RESEND_WEBHOOK_SECRET);
  const pushConfigured = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);
  const whatsappSecrets = !!(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_APP_SECRET && process.env.WHATSAPP_VERIFY_TOKEN);
  const waSetting = whatsappSettings.rows[0] || {};
  const whatsappConfigured = whatsappSecrets && waSetting.enabled === true && !!waSetting.phone_number_id;
  const routing = routingReadiness(escalationSettings, escalationRecipients, profiles);
  const scheduleMode = String(process.env.NOTIFICATION_SCHEDULE_MODE || 'daily_safety').toLowerCase();
  const scheduleReady = ['five_minute','external','vercel_pro'].includes(scheduleMode);
  const foundationMissing = [queue,inbox,events,escalationSettings,escalationRecipients,preferences,acknowledgementSettings]
    .filter(item => item.missing).map(item => item.label);
  const readiness = buildReadiness({
    foundationMissing, routing, emailConfigured, emailWebhook,
    pushConfigured: pushConfigured && !pushJobs.missing,
    whatsappConfigured, scheduleReady, scheduleMode,
    appBaseUrl: !!process.env.APP_BASE_URL,
    signedLinks: !!process.env.NOTIFICATION_LINK_SECRET,
    inboxInstalled: !inbox.missing,
    acknowledgementInstalled: !acknowledgementSettings.missing
  });

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
      mode: scheduleMode,
      productionReady: scheduleReady,
      warning: scheduleReady ? 'Urgent notification workers are configured on a five-minute Vercel Pro cycle.' : 'Urgent production delivery requires five-minute external or Vercel Pro schedules.'
    },
    readiness,
    simulation: simulate ? buildSimulation(readiness, routing, {
      email: emailConfigured,
      inApp: !inbox.missing,
      push: pushConfigured && !pushJobs.missing && pushSubscriptions.rows.length > 0,
      whatsapp: whatsappConfigured && optedProfiles.rows.length > 0
    }) : null,
    schemaWarnings: [queue,pushJobs,whatsappJobs,pushSubscriptions,optedProfiles,whatsappSettings,linkOpens,inbox,events,
      escalationSettings,escalationRecipients,preferences,acknowledgementSettings].filter(item => item.missing).map(item => item.label)
  };
}

function deliverableEmail(value) {
  const email=String(value||'').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && !email.endsWith('.local');
}

function routingReadiness(settingsResult, recipientsResult, profilesResult) {
  const settings=settingsResult.rows[0] || {};
  const profiles=profilesResult.rows || [];
  const byId=new Map(profiles.map(row=>[String(row.id),row]));
  const fallbackRoles={1:['supervisor','site_manager'],2:['manager','hse_manager'],3:['executive','director','company_admin','admin','hse_manager']};
  const levels=[1,2,3].map(level=>{
    const explicit=recipientsResult.rows.filter(row=>Number(row.escalation_level)===level && row.active!==false);
    const explicitDeliverable=explicit.filter(row=>deliverableEmail(row.email_override) || deliverableEmail((byId.get(String(row.profile_id))||{}).real_email) || deliverableEmail((byId.get(String(row.profile_id))||{}).email)).length;
    const fallbackDeliverable=profiles.filter(row=>fallbackRoles[level].includes(String(row.role||'').toLowerCase()) && (deliverableEmail(row.real_email)||deliverableEmail(row.email))).length;
    return {level,ready:explicitDeliverable>0||fallbackDeliverable>0,explicitRecipients:explicit.length,explicitDeliverable,fallbackDeliverable};
  });
  return {
    installed: !settingsResult.missing && !recipientsResult.missing,
    enabled: settings.enabled !== false,
    dueSoonDays: Number(settings.due_soon_days==null?7:settings.due_soon_days),
    thresholds: [Number(settings.level_1_overdue_days||7),Number(settings.level_2_overdue_days||21),Number(settings.level_3_overdue_days||45)],
    levels,
    allLevelsReady: levels.every(level=>level.ready)
  };
}

function buildReadiness(input) {
  const item=(key,label,ready,detail,remediation,blocking)=>({key,label,status:ready?'ready':blocking?'blocked':'review',detail,remediation:ready?null:remediation});
  const items=[
    item('foundation','Database foundation',input.foundationMissing.length===0,input.foundationMissing.length?'Missing: '+input.foundationMissing.join(', '):'Required notification components are installed.','Run the missing notification upgrade scripts before production use.',true),
    item('routing','Escalation recipients',input.routing.installed&&input.routing.enabled&&input.routing.allLevelsReady,input.routing.allLevelsReady?'Levels 1, 2 and 3 each resolve to a deliverable recipient.':'One or more escalation levels have no deliverable explicit or role-fallback recipient.','Assign a real notification email to the required hierarchy roles or configure explicit recipients.',true),
    item('email','Email delivery',input.emailConfigured,input.emailConfigured?'SMTP or Resend provider is configured.':'No SMTP or Resend provider configured.','Configure a server-side SMTP or Resend provider.',true),
    item('email_evidence','Email lifecycle evidence',input.emailWebhook,input.emailWebhook?'Resend delivery, bounce and complaint webhook is configured.':'Provider lifecycle webhook is not confirmed.','For Resend, configure RESEND_WEBHOOK_SECRET and the signed webhook endpoint; SMTP delivery can operate without this optional evidence.',false),
    item('in_app','In-app inbox',input.inboxInstalled,input.inboxInstalled?'Company-scoped personal inbox is installed.':'Personal inbox schema is missing.','Run the in-app notification centre upgrade.',true),
    item('push','Browser / mobile push',input.pushConfigured,input.pushConfigured?'VAPID configuration and push schema are present.':'VAPID configuration or push schema is incomplete.','Add all VAPID variables and install the push notification schema.',false),
    item('whatsapp','WhatsApp',input.whatsappConfigured,input.whatsappConfigured?'Provider secrets and tenant channel are enabled.':'Provider secrets, tenant phone ID or channel enablement is incomplete.','Complete Meta Cloud API configuration and retain explicit user consent.',false),
    item('links','Exact record links',input.appBaseUrl&&input.signedLinks,input.appBaseUrl&&input.signedLinks?'Application base URL and signed link evidence are configured.':'Base URL or signed link secret is missing.','Set APP_BASE_URL and NOTIFICATION_LINK_SECRET in every production environment.',true),
    item('acknowledgement','Acknowledgement controls',input.acknowledgementInstalled,input.acknowledgementInstalled?'Acknowledgement settings are installed.':'Acknowledgement settings are missing.','Run the notification acknowledgement control upgrade.',false),
    item('automation','Urgent processing cadence',input.scheduleReady,input.scheduleReady?'Production scheduling mode: '+input.scheduleMode+'.':'Current mode is '+input.scheduleMode+'; daily execution is fallback only.','Configure five-minute external or Vercel Pro schedules, then set NOTIFICATION_SCHEDULE_MODE=five_minute.',true)
  ];
  return {status:items.some(x=>x.status==='blocked')?'blocked':items.some(x=>x.status==='review')?'review':'ready',ready:items.filter(x=>x.status==='ready').length,total:items.length,items};
}

function buildSimulation(readiness, routing, channels) {
  const routeFor=level=>routing.levels.find(item=>item.level===level);
  const scenario=(key,label,level)=>{
    const route=level?routeFor(level):null;
    const selected=Object.keys(channels).filter(channel=>channels[channel]);
    return {key,label,level,routeReady:level?!!(route&&route.ready):true,channels:selected,deliverable:selected.length>0 && (!level || !!(route&&route.ready))};
  };
  return {
    readOnly:true,
    generatedAt:new Date().toISOString(),
    message:'Simulation only. No notification, delivery job or audit row was created.',
    scenarios:[scenario('assignment','New action assignment',0),scenario('level_1','Level 1 supervisor escalation',1),scenario('level_2','Level 2 manager escalation',2),scenario('level_3','Level 3 executive escalation',3)],
    productionReady:readiness.status==='ready'
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

module.exports._test={channelHealth,conversionPercent,deliverableEmail,routingReadiness,buildReadiness,buildSimulation};
