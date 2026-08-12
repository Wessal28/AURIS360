const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const endpointText=fs.readFileSync(path.join(root,'api','notification-health.js'),'utf8');
const endpoint=require(path.join(root,'api','notification-health.js'))._test;
const app=fs.readFileSync(path.join(root,'index.html'),'utf8');
const vercel=require(path.join(root,'vercel.json'));

test('health endpoint requires a real user and authorised role',()=>{
  assert.match(endpointText,/\/auth\/v1\/user/);assert.match(endpointText,/Invalid or expired session/);
  assert.match(endpointText,/ALLOWED_ROLES/);assert.match(endpointText,/Administrator access required/);
  assert.match(endpointText,/profile\.role === 'sephs_admin' && requested \? requested : profile\.company_id/);
});
test('endpoint exposes booleans and counts but never secret values',()=>{
  assert.match(endpointText,/VAPID_PRIVATE_KEY/);assert.match(endpointText,/WHATSAPP_ACCESS_TOKEN/);
  assert.doesNotMatch(endpointText,/accessToken\s*:/i);assert.doesNotMatch(endpointText,/privateKey\s*:/i);
  assert.match(endpointText,/secretsConfigured: whatsappSecrets/);assert.match(endpointText,/deliveryWebhookConfigured: emailWebhook/);
});
test('missing optional channel schemas degrade to setup health',()=>{
  assert.match(endpointText,/optional && \(response\.status === 404/);assert.match(endpointText,/schemaWarnings/);
  assert.equal(endpoint.channelHealth(false,[],['failed'],{}).status,'setup');
});
test('failures require review while healthy configured activity is operational',()=>{
  assert.equal(endpoint.channelHealth(true,[{status:'delivered'}],['failed'],{}).status,'operational');
  const failed=endpoint.channelHealth(true,[{status:'failed'},{status:'pending'}],['failed'],{});
  assert.equal(failed.status,'review');assert.equal(failed.failures,1);assert.equal(failed.pending,1);
});
test('notification settings renders channel health and schedule caution',()=>{
  assert.match(app,/Notification delivery health/);assert.match(app,/Secret values are never displayed/);
  assert.match(app,/Operational/);assert.match(app,/Setup required/);assert.match(app,/health\.schedules/);
});
test('health endpoint is deployed as a bounded server function',()=>{
  assert.equal(vercel.functions['api/notification-health.js'].maxDuration,30);
});
