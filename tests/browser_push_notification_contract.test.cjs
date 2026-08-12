const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'browser_push_notifications_upgrade.sql'), 'utf8');
const client = fs.readFileSync(path.join(root, 'notification-centre.js'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const configApi = fs.readFileSync(path.join(root, 'api', 'push-config.js'), 'utf8');
const sender = fs.readFileSync(path.join(root, 'api', 'send-push.js'), 'utf8');
const packageJson = require(path.join(root, 'package.json'));
const vercel = require(path.join(root, 'vercel.json'));

test('subscriptions are user-owned and tenant-bound', () => {
  assert.match(sql, /alter table public\.push_subscriptions enable row level security/i);
  assert.match(sql, /recipient_profile_id = auth\.uid\(\)/i);
  assert.match(sql, /p\.company_id = push_subscriptions\.company_id/i);
  assert.match(sql, /revoke all on public\.push_subscriptions from anon/i);
});

test('only important personal notifications generate push work', () => {
  assert.match(sql, /severity in \('high','urgent'\) or new\.acknowledgement_required/i);
  assert.match(sql, /unique\(user_notification_id, subscription_id\)/i);
  assert.match(sql, /n\.read_at is null and n\.dismissed_at is null/i);
  assert.match(sql, /n\.created_at >= now\(\) - interval '7 days'/i);
});

test('push delivery jobs are atomically leased to the service role', () => {
  assert.match(sql, /for update of j skip locked/i);
  assert.match(sql, /revoke all on function public\.claim_push_delivery_jobs\(integer,text\) from authenticated/i);
  assert.match(sql, /grant execute on function public\.claim_push_delivery_jobs\(integer,text\) to service_role/i);
  assert.match(sql, /push_sent[\s\S]*push_failed[\s\S]*push_subscription_expired/i);
  assert.match(sql, /insert into public\.notification_events/i);
  assert.match(sql, /Notification no longer requires push/i);
  assert.match(sql, /Browser push subscription is disabled/i);
});

test('client permission is requested only from explicit user action', () => {
  assert.match(client, /window\.notificationCentrePushToggle=async function/);
  assert.match(client, /Notification\.requestPermission\(\)/);
  assert.doesNotMatch(client, /notificationCentreInit[\s\S]{0,300}Notification\.requestPermission\(\)/);
  assert.match(client, /Share > Add to Home Screen/);
  assert.match(client, /pushManager\.subscribe/);
  assert.match(client, /subscription\.unsubscribe/);
  assert.match(client, /saveSubscription\(subscription\)\.catch/);
});

test('only the public VAPID key is exposed to the browser', () => {
  assert.match(configApi, /VAPID_PUBLIC_KEY/);
  assert.doesNotMatch(configApi, /VAPID_PRIVATE_KEY/);
  assert.match(configApi, /enabled: !!publicKey/);
});

test('push worker authenticates and handles expiration and retries', () => {
  assert.match(sender, /CRON_SECRET/);
  assert.match(sender, /SUPABASE_SERVICE_KEY/);
  assert.match(sender, /statusCode === 404 \|\| statusCode === 410/);
  assert.match(sender, /Browser push subscription expired/);
  assert.match(sender, /retryDelayMs/);
  assert.match(sender, /webpush\.sendNotification/);
});

test('service worker safely opens exact same-origin notification target', () => {
  assert.match(serviceWorker, /requestedUrl\.origin === self\.location\.origin/);
  assert.match(serviceWorker, /client\.navigate\(targetUrl\)/);
  assert.match(serviceWorker, /pushsubscriptionchange/);
});

test('deployment declares web-push and a Hobby-compatible safety schedule', () => {
  assert.equal(packageJson.dependencies['web-push'], '^3.6.7');
  assert.equal(fs.existsSync(path.join(root, 'pnpm-lock.yaml')), true);
  const schedules = Object.fromEntries(vercel.crons.map(item => [item.path, item.schedule]));
  assert.equal(schedules['/api/send-push'], '10 9 * * *');
});

test('push topic is stable, bounded and URL-safe', () => {
  const id = 'd8548a00-9f28-4fea-b795-2d9cc7454b9f';
  const topic = crypto.createHash('sha256').update(id).digest('base64url').slice(0, 32);
  assert.match(sender, /digest\('base64url'\)\.slice\(0, 32\)/);
  assert.equal(topic.length, 32);
  assert.match(topic, /^[A-Za-z0-9_-]+$/);
});
