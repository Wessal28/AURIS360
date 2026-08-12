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
test('operational readiness checks foundation, hierarchy, links and production cadence',()=>{
  assert.match(endpointText,/Database foundation/);assert.match(endpointText,/Escalation recipients/);
  assert.match(endpointText,/NOTIFICATION_SCHEDULE_MODE/);assert.match(endpointText,/APP_BASE_URL/);
  assert.match(endpointText,/NOTIFICATION_LINK_SECRET/);assert.match(endpointText,/allLevelsReady/);
  const input={foundationMissing:[],routing:{installed:true,enabled:true,allLevelsReady:true},emailConfigured:true,emailWebhook:true,
    pushConfigured:true,whatsappConfigured:true,scheduleReady:true,scheduleMode:'five_minute',appBaseUrl:true,signedLinks:true,
    inboxInstalled:true,acknowledgementInstalled:true};
  const readiness=endpoint.buildReadiness(input);
  assert.equal(readiness.status,'ready');assert.equal(readiness.ready,readiness.total);
});
test('routing readiness accepts deliverable explicit recipients or controlled role fallbacks',()=>{
  const settings={rows:[{enabled:true}],missing:false};
  const recipients={rows:[{escalation_level:1,profile_id:'p1',active:true}],missing:false};
  const profiles={rows:[
    {id:'p1',role:'employee',real_email:'supervisor@example.com'},
    {id:'p2',role:'hse_manager',real_email:'manager@example.com'},
    {id:'p3',role:'admin',real_email:'admin@example.com'}
  ]};
  const result=endpoint.routingReadiness(settings,recipients,profiles);
  assert.equal(result.allLevelsReady,true);assert.equal(result.levels[0].explicitDeliverable,1);
  assert.equal(endpoint.deliverableEmail('login@auris.local'),false);
});
test('read-only simulation reports routes without creating notifications',()=>{
  assert.match(endpointText,/simulate/);assert.match(endpointText,/No notification, delivery job or audit row was created/);
  assert.match(app,/Run read-only simulation/);assert.match(app,/No notifications were created or sent/);
  const routing={levels:[1,2,3].map(level=>({level,ready:true}))};
  const result=endpoint.buildSimulation({status:'ready'},routing,{email:true,inApp:true,push:false,whatsapp:false});
  assert.equal(result.readOnly,true);assert.equal(result.scenarios.length,4);assert.equal(result.scenarios[3].deliverable,true);
});
test('health endpoint is deployed as a bounded server function',()=>{
  assert.equal(vercel.functions['api/notification-health.js'].maxDuration,30);
});
