const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const sql=fs.readFileSync(path.join(root,'whatsapp_notifications_upgrade.sql'),'utf8');
const sender=fs.readFileSync(path.join(root,'api','send-whatsapp.js'),'utf8');
const webhook=fs.readFileSync(path.join(root,'api','whatsapp-webhook.js'),'utf8');
const app=fs.readFileSync(path.join(root,'index.html'),'utf8');
const vercel=require(path.join(root,'vercel.json'));

test('consent is self-service, withdrawable and append-only audited',()=>{
  assert.match(sql,/profile_id=auth\.uid\(\)/i);assert.match(sql,/set_my_whatsapp_consent/i);
  assert.match(sql,/event_type in \('opted_in','opted_out','phone_changed'\)/i);
  assert.match(sql,/Recipient withdrew WhatsApp consent/i);assert.match(app,/Only the account owner can change WhatsApp consent/i);
  assert.match(app,/I agree — enable WhatsApp/);assert.match(app,/Disable WhatsApp alerts/);
  assert.match(app,/saveWhatsappChannelSettings/);assert.match(app,/Access token and app secret stay in Vercel/);
});
test('tenant settings require approved templates and governed escalation routing',()=>{
  assert.match(sql,/provider text not null default 'meta_cloud'/i);assert.match(sql,/minimum_escalation_level integer not null default 2/i);
  assert.match(sql,/profile_row\.preferred_notification_channel='whatsapp'/i);assert.match(sql,/new\.severity in \('high','urgent'\)/i);
  assert.match(sql,/whatsapp_settings_admin_write/i);
});
test('delivery queue is private, idempotent and atomically leased',()=>{
  assert.match(sql,/unique\(user_notification_id, recipient_profile_id\)/i);assert.match(sql,/for update skip locked/i);
  assert.match(sql,/grant execute on function public\.claim_whatsapp_delivery_jobs\(integer,text\) to service_role/i);
  assert.match(sql,/whatsapp_delivered[\s\S]*whatsapp_read[\s\S]*whatsapp_failed/i);
});
test('sender uses Meta templates, credentials and bounded retry',()=>{
  assert.match(sender,/WHATSAPP_ACCESS_TOKEN/);assert.match(sender,/graph\.facebook\.com/);assert.match(sender,/type:'template'/);
  assert.match(sender,/MAX_ATTEMPTS = 5/);assert.match(sender,/isTransient/);assert.match(sender,/safeRecordUrl/);
  assert.match(sender,/!process\.env\.CRON_SECRET/);
  assert.doesNotMatch(sender,/WHATSAPP_APP_SECRET/);
});
test('webhook verifies Meta signature and records lifecycle statuses',()=>{
  assert.match(webhook,/x-hub-signature-256/);assert.match(webhook,/createHmac\('sha256'/);assert.match(webhook,/timingSafeEqual/);
  assert.match(webhook,/status==='delivered'/);assert.match(webhook,/status==='read'/);assert.match(webhook,/status==='failed'/);
  assert.match(webhook,/bodyParser:false/);assert.match(webhook,/hub\.verify_token/);
  assert.match(webhook,/eligiblePriorStatuses/);assert.match(webhook,/status=in\./);
});
test('deployment uses Vercel Pro five-minute schedule',()=>{
  const schedules=Object.fromEntries(vercel.crons.map(x=>[x.path,x.schedule]));assert.equal(schedules['/api/send-whatsapp'],'*/5 * * * *');
  assert.equal(vercel.functions['api/send-whatsapp.js'].maxDuration,30);
});
