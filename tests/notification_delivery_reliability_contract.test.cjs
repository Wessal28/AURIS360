const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const worker = require(path.join(root, 'api', 'send-emails.js'))._test;
const webhook = require(path.join(root, 'api', 'resend-webhook.js'))._test;

test('email address validation excludes login-only aliases', () => {
  assert.equal(worker.isDeliverableEmail('person@example.com'), true);
  assert.equal(worker.isDeliverableEmail('person@auris.local'), false);
  assert.equal(worker.isDeliverableEmail('not-an-email'), false);
});

test('event types map to the relevant company preference', () => {
  assert.equal(worker.preferenceForType('incident_assigned'), 'notify_on_incident');
  assert.equal(worker.preferenceForType('permit'), 'notify_on_permit');
  assert.equal(worker.preferenceForType('investigation_signoff'), 'notify_on_investigation');
  assert.equal(worker.preferenceForType('audit_due'), 'notify_on_audit');
  assert.equal(worker.preferenceForType('action_overdue'), 'notify_on_overdue');
  assert.equal(worker.preferenceForType('training'), null);
  assert.match(
    worker.emailDisabledReason({ type: 'permit' }, { email_enabled: true, notify_on_permit: false }),
    /notify_on_permit/
  );
});

test('retry delay is bounded exponential backoff', () => {
  assert.equal(worker.retryDelayMs(1), 60_000);
  assert.equal(worker.retryDelayMs(2), 120_000);
  assert.equal(worker.retryDelayMs(5), 960_000);
  assert.equal(worker.retryDelayMs(20), 3_600_000);
});

test('transient failures are distinguished from permanent configuration errors', () => {
  assert.equal(worker.isTransientError(Object.assign(new Error('socket timeout'), { code: 'ETIMEDOUT' })), true);
  assert.equal(worker.isTransientError(Object.assign(new Error('mailbox temporarily unavailable'), { responseCode: 451 })), true);
  assert.equal(worker.isTransientError(Object.assign(new Error('recipient rejected'), { responseCode: 550 })), false);
  assert.equal(worker.isTransientError(new Error('Email sender is not configured')), false);
});

test('Resend lifecycle events produce governed queue states', () => {
  assert.equal(webhook.eventPatch('email.delivered', {}).status, 'delivered');
  assert.equal(webhook.eventPatch('email.bounced', { bounce: { message: 'mailbox unavailable' } }).status, 'bounced');
  assert.equal(webhook.eventPatch('email.complained', {}).status, 'bounced');
  assert.equal(webhook.eventPatch('email.delivery_delayed', {}).status, undefined);
  assert.equal(webhook.eventPatch('email.opened', {}), null);
});

test('Resend webhook verifies an exact raw-body Svix signature', () => {
  const raw = Buffer.from(JSON.stringify({ type: 'email.delivered', data: { email_id: 'email-1' } }));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const messageId = 'msg_test';
  const secretBytes = crypto.randomBytes(32);
  const secret = 'whsec_' + secretBytes.toString('base64');
  const signed = Buffer.concat([Buffer.from(messageId + '.' + timestamp + '.'), raw]);
  const signature = crypto.createHmac('sha256', secretBytes).update(signed).digest('base64');

  assert.doesNotThrow(() => webhook.verifySignature({
    'svix-id': messageId,
    'svix-timestamp': timestamp,
    'svix-signature': 'v1,' + signature
  }, raw, secret));

  assert.throws(() => webhook.verifySignature({
    'svix-id': messageId,
    'svix-timestamp': timestamp,
    'svix-signature': 'v1,' + signature
  }, Buffer.from('{}'), secret), /Invalid signature/);
});

test('database upgrade enforces service-only atomic queue leases', () => {
  const sql = fs.readFileSync(path.join(root, 'notification_delivery_reliability_upgrade.sql'), 'utf8');
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /attempt_count integer not null default 0/i);
  assert.match(sql, /next_attempt_at timestamptz not null default now\(\)/i);
  assert.match(sql, /grant execute on function public\.claim_notification_queue\(integer, text\) to service_role/i);
  assert.match(sql, /revoke all on function public\.claim_notification_queue\(integer, text\) from authenticated/i);
});

test('delivery webhook is inside the deployable API directory', () => {
  assert.equal(fs.existsSync(path.join(root, 'api', 'resend-webhook.js')), true);
  const compatibility = fs.readFileSync(path.join(root, 'resend-webhook.js'), 'utf8');
  assert.match(compatibility, /require\('\.\/api\/resend-webhook'\)/);
});
