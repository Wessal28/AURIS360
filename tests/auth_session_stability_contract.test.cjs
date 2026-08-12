const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const html=fs.readFileSync('index.html','utf8');

test('authentication owns only one refresh timer and transient failure cannot sign out',()=>{
  assert.match(html,/var _authRefreshTimer = null/);
  assert.match(html,/var _authSessionGeneration = 0/);
  assert.match(html,/if\(_authRefreshTimer\)\{clearTimeout\(_authRefreshTimer\);_authRefreshTimer=null;\}/);
  const schedule=html.match(/function authScheduleRefresh\(session\) \{[\s\S]*?\n\}/)?.[0]||'';
  assert.match(schedule,/_authRefreshPromise=authRefreshSession/);
  assert.match(html,/navigator\.locks\.request\('auris360-auth-refresh'/);
  assert.match(html,/latest\.refresh_token!==session\.refresh_token/);
  assert.match(schedule,/generation!==_authSessionGeneration/);
  assert.doesNotMatch(schedule,/doLogout\s*\(/);
  assert.match(schedule,/60000/);
});

test('slow session restoration never deletes the stored session',()=>{
  const init=html.match(/async function authInitSession\(\) \{[\s\S]*?\n\}\n\n\nasync function authLoadCompanyDropdown/)?.[0]||'';
  assert.match(init,/Restoring your secure session/);
  assert.doesNotMatch(init,/timedOut/);
  assert.doesNotMatch(init,/Set a hard timeout[\s\S]*?authClearSession/);
});

test('service-worker activation has exactly one reload path',()=>{
  const registration=html.match(/\/\/ Register service worker[\s\S]*?\/\/ Capture install prompt/)?.[0]||'';
  assert.equal((registration.match(/window\.location\.reload\(\)/g)||[]).length,1);
  assert.match(registration,/controllerchange/);
});
