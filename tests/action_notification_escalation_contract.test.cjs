const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'action_notification_escalation_upgrade.sql'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const worker = require(path.join(root, 'api', 'send-emails.js'))._test;

test('escalation thresholds are governed and ordered', () => {
  assert.match(sql, /due_soon_days integer not null default 7/i);
  assert.match(sql, /level_1_overdue_days integer not null default 7/i);
  assert.match(sql, /level_2_overdue_days integer not null default 21/i);
  assert.match(sql, /level_3_overdue_days integer not null default 45/i);
  assert.match(sql, /level_3_overdue_days > level_2_overdue_days/i);
});

test('escalation generation is idempotent per action, target date, event and recipient', () => {
  assert.match(sql, /unique\(action_id, event_key, recipient_email\)/i);
  assert.match(sql, /action-escalation\/.*event_key_value/i);
  assert.match(sql, /on conflict \(company_id,idempotency_key\).*do update/is);
});

test('closed and cancelled actions cannot be escalated', () => {
  assert.match(sql, /not in \('closed','cancelled','canceled','completed','complete','void'\)/i);
  assert.match(sql, /where id=action_row\.id.*not in \('closed','cancelled','canceled','completed','complete','void'\)/is);
});

test('automatic processor is service-role only', () => {
  assert.match(sql, /revoke all on function public\.process_action_notification_escalations\(date,integer\) from authenticated/i);
  assert.match(sql, /grant execute on function public\.process_action_notification_escalations\(date,integer\) to service_role/i);
});

test('email preferences cover due-soon and overdue action events', () => {
  assert.equal(worker.preferenceForType('action_due_soon'), 'notify_on_overdue');
  assert.equal(worker.preferenceForType('action_overdue'), 'notify_on_overdue');
});

test('email and escalation processors run at operational cadence', () => {
  const schedules = Object.fromEntries(vercel.crons.map(item => [item.path, item.schedule]));
  assert.equal(schedules['/api/send-emails'], '*/5 * * * *');
  assert.equal(schedules['/api/process-escalations'], '*/5 * * * *');
});

test('escalation endpoint is deployable and authenticated', () => {
  const source = fs.readFileSync(path.join(root, 'api', 'process-escalations.js'), 'utf8');
  assert.match(source, /process_action_notification_escalations/);
  assert.match(source, /CRON_SECRET/);
  assert.match(source, /SUPABASE_SERVICE_KEY/);
});
