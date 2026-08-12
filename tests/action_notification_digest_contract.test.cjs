const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const sql=fs.readFileSync(path.join(root,'action_notification_digest_upgrade.sql'),'utf8');
const worker=fs.readFileSync(path.join(root,'api','process-digests.js'),'utf8');
const emailWorker=require(path.join(root,'api','send-emails.js'));
const vercel=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));

test('digest is service-only, preference-gated and one per recipient/day',()=>{
  assert.match(sql,/create table if not exists public\.action_digest_runs/i);
  assert.match(sql,/unique\(company_id,run_date,recipient_profile_id\)/i);
  assert.match(sql,/coalesce\(ns\.email_enabled,true\)[\s\S]*coalesce\(ns\.notify_on_overdue,true\)/i);
  assert.match(sql,/not exists\(select 1 from public\.action_digest_runs/i);
  assert.match(sql,/revoke all on function public\.process_action_overdue_digests\(date,uuid,integer\) from public,anon,authenticated/i);
  assert.match(sql,/grant execute on function public\.process_action_overdue_digests\(date,uuid,integer\) to service_role/i);
});

test('digest includes only current overdue open actions and exact record links',()=>{
  assert.match(sql,/a\.target_date<p_run_date/i);
  assert.match(sql,/not in \('closed','cancelled','canceled','completed','complete','void'\)/i);
  assert.match(sql,/\?goto=actions&amp;record='\|\|a\.id::text/i);
  assert.match(sql,/idempotency_key[\s\S]*overdue-digest\//i);
  assert.match(sql,/'overdue_digest'/i);
});

test('terminal action state stops only pending individual alerts on every channel',()=>{
  assert.match(sql,/after update of status on public\.action_tracker/i);
  assert.match(sql,/type in \('action','action_due_soon','action_overdue'\)/i);
  assert.match(sql,/update public\.notification_queue set status='skipped'/i);
  assert.match(sql,/update public\.user_notifications u set dismissed_at/i);
  assert.match(sql,/to_regclass\('public\.push_delivery_jobs'\)/i);
  assert.match(sql,/to_regclass\('public\.whatsapp_delivery_jobs'\)/i);
  assert.doesNotMatch(sql,/type in \([^)]*overdue_digest/i);
});

test('protected daily builder runs before the email worker and respects delivery policy',()=>{
  assert.match(worker,/CRON_SECRET/);
  assert.match(worker,/process_action_overdue_digests/);
  const digestCron=vercel.crons.find(x=>x.path==='/api/process-digests');
  const emailCron=vercel.crons.find(x=>x.path==='/api/send-emails');
  assert.equal(digestCron.schedule,'55 8 * * *');
  assert.equal(emailCron.schedule,'*/5 * * * *');
  assert.equal(emailWorker._test.preferenceForType('overdue_digest'),'notify_on_overdue');
});
