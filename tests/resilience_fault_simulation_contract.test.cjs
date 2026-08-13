const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),app=fs.readFileSync(path.join(root,'resilience-fault-simulation.js'),'utf8'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');

test('fault simulation is administrator-only and session-scoped',()=>{
  assert.match(app,/isSA[\s\S]*isAdm/);
  assert.match(app,/sessionStorage\.setItem\(KEY,key\)/);
  assert.match(app,/sessionStorage\.removeItem\(KEY\)/);
  assert.doesNotMatch(app,/localStorage|api\(|fetch\(/);
});

test('only approved optional dependencies can be simulated',()=>{
  for(const pathName of ['/incident_evidence','/checklist_templates','/audit_findings','/jsa_records'])assert.ok(app.includes(pathName));
  assert.match(app,/No database object or record has been changed/);
  assert.match(html,/aurisResilienceFaultForPath\(path\)/);
});

test('simulation has visible controls and recovery',()=>{
  assert.match(html,/id="settings-resilience-simulation-card"/);
  assert.match(html,/renderResilienceSimulation\(\)/);
  assert.match(html,/resilience-fault-simulation\.js\?v=20260814-1/);
  assert.match(app,/Stop simulation/);
  assert.match(app,/confirm recovery/);
});
