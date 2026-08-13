const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'in_app_notification_centre_upgrade.sql'), 'utf8');
const app = fs.readFileSync(path.join(root, 'notification-centre.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'notification-centre.css'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('personal inbox is recipient-private under RLS', () => {
  assert.match(sql, /alter table public\.user_notifications enable row level security/i);
  assert.match(sql, /recipient_profile_id = auth\.uid\(\)/i);
  assert.match(sql, /revoke all on public\.user_notifications from authenticated/i);
  assert.match(sql, /grant update\(read_at, acknowledged_at, acknowledged_by, dismissed_at, updated_at\)/i);
  assert.doesNotMatch(sql, /grant insert on public\.user_notifications to authenticated/i);
});

test('governed queue creates one personal notification per recipient', () => {
  assert.match(sql, /after insert on public\.notification_queue/i);
  assert.match(sql, /unique\(source_notification_id, recipient_profile_id\)/i);
  assert.match(sql, /resolve_notification_recipient_profile/i);
  assert.match(sql, /real_email[\s\S]*p\.email/i);
  assert.match(sql, /on conflict\(source_notification_id, recipient_profile_id\) do nothing/i);
});

test('read and acknowledgement evidence is immutable and audited', () => {
  assert.match(sql, /A notification acknowledgement is immutable/i);
  assert.match(sql, /A read notification cannot be returned to unread/i);
  assert.match(sql, /'opened'[\s\S]*'personal_inbox'/i);
  assert.match(sql, /'acknowledged'[\s\S]*'personal_inbox'/i);
  assert.match(sql, /acknowledgement_required[\s\S]*priority[\s\S]*urgent/i);
});

test('notification centre supplies inbox, filters, badge and exact-record navigation', () => {
  assert.match(app, /user_notifications\?recipient_profile_id=eq\./);
  assert.match(app, /notificationCentreMarkAllRead/);
  assert.match(app, /notificationCentreAcknowledge/);
  assert.match(app, /Needs acknowledgement/);
  assert.match(app, /deepLinkNormalise/);
  assert.match(app, /deepLinkResume\('personal-notification-centre'\)/);
  assert.match(app, /Notification centre is being activated/);
});

test('read notifications leave the active inbox and persistence is verified', () => {
  assert.match(app, /!x\.read_at\|\|\(x\.acknowledgement_required&&!x\.acknowledged_at\)/);
  assert.match(app, /filterButton\('all','Active',activeCount\(\)\)/);
  assert.match(app, /p:'return=representation'/);
  assert.match(app, /if\(!Array\.isArray\(updated\)\|\|!updated\.length\)throw new Error/);
  assert.match(app, /dismissed_at:now/);
});

test('desktop and mobile application chrome mount the personal inbox', () => {
  assert.match(index, /id="nc-mobile-trigger"/);
  assert.match(index, /notificationCentreInit/);
  assert.match(index, /notification-centre\.css\?v=/);
  assert.match(index, /notification-centre\.js\?v=/);
  assert.match(app, /id='nc-desktop-trigger'/);
  assert.match(css, /@media\(max-width:768px\)/);
});
