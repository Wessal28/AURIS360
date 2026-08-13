const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const html=fs.readFileSync('index.html','utf8');

test('fresh sign-in waits for company context and dashboard data',()=>{
  const signIn=html.match(/async function authOnSignIn\(authData\) \{[\s\S]*?\n\}/)?.[0]||'';
  assert.match(signIn,/await saCompanyInit\(\)/);
  assert.match(signIn,/await Promise\.all\(\[loadPeopleCache\(\),loadLocationSitesCache\(\)\]\)/);
  assert.match(signIn,/await loadDash\(\{initial:true,attempt:0\}\)/);
});

test('session restoration uses the same ordered dashboard startup',()=>{
  const init=html.match(/async function authInitSession\(\) \{[\s\S]*?\n\}\n\n\nasync function authLoadCompanyDropdown/)?.[0]||'';
  assert.match(init,/await saCompanyInit\(\)/);
  assert.match(init,/await loadDash\(\{initial:true,attempt:0\}\)/);
});

test('dashboard ignores stale responses and retries temporary startup failures',()=>{
  const load=html.match(/async function loadDash\(options\) \{[\s\S]*?\/\/ DASHBOARD REDESIGN HELPERS/)?.[0]||'';
  assert.match(load,/loadGeneration!==_dashLoadGeneration/);
  assert.match(load,/hadApiFailure=true/);
  assert.match(load,/\(options\.attempt\|\|0\)<2/);
  assert.match(load,/1500/);
  assert.match(load,/dashboardReady='true'/);
});
