const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const sql=fs.readFileSync(path.join(root,'notification_user_preferences_upgrade.sql'),'utf8');
const email=fs.readFileSync(path.join(root,'api','send-emails.js'),'utf8');
const push=fs.readFileSync(path.join(root,'api','send-push.js'),'utf8');
const whatsapp=fs.readFileSync(path.join(root,'api','send-whatsapp.js'),'utf8');
const app=fs.readFileSync(path.join(root,'index.html'),'utf8');

test('preferences are recipient-owned and tenant-bound',()=>{
  assert.match(sql,/profile_id=auth\.uid\(\)/i);assert.match(sql,/p\.company_id=notification_user_preferences\.company_id/i);
  assert.match(sql,/set_my_notification_preferences/i);assert.match(sql,/Unsupported timezone/i);
});
test('quiet hours defer optional alerts and narrowly govern overrides',()=>{
  assert.match(sql,/quiet_hours_deferred/i);assert.match(sql,/urgent_quiet_hours_override/i);
  assert.match(sql,/lower\(coalesce\(p_severity,''\)\)='urgent'/i);assert.match(sql,/coalesce\(p_ack_required,false\)/i);
  assert.match(sql,/allow_urgent_override/i);
});
test('rate protection delays bursts without dropping alerts',()=>{
  assert.match(sql,/max_external_alerts_per_hour integer not null default 10/i);
  assert.match(sql,/rate_limit_deferred/i);assert.match(sql,/now\(\)\+interval '1 hour'/i);
  assert.doesNotMatch(sql,/delete from public\.notification/i);
});
test('email push and WhatsApp use the same service policy with rollout fallback',()=>{
  for(const worker of [email,push,whatsapp]){
    assert.match(worker,/evaluate_notification_delivery_policy/);assert.match(worker,/quiet|recipient policy|Delivery deferred/i);
    assert.match(worker,/PGRST202\|schema cache\|evaluate_notification_delivery_policy/i);
    assert.match(worker,/mandatory_alert_override/);
  }
});
test('delivery evidence contains recipient identity for per-user protection',()=>{
  assert.match(sql,/recipient_profile_id',new\.recipient_profile_id/i);
  assert.match(sql,/recipient_profile_id',notification_row\.recipient_profile_id/i);
  assert.match(sql,/recipient_profile_id',new\.recipient_profile_id/i);
});
test('users control their own channels quiet hours timezone and override',()=>{
  assert.match(app,/Only the account owner can change delivery preferences/i);
  assert.match(app,/Enable quiet hours/);assert.match(app,/Timezone/);assert.match(app,/Every override is audited/);
  assert.match(app,/In-app notifications always remain available/i);
});
