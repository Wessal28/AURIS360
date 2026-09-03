const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function context(){const c={globalThis:null,console,Date};c.globalThis=c;vm.runInNewContext(read('auris-module-registry.js'),c);c.AurisModuleRuntime={readiness:()=>({ready:true,reasons:[]})};c.AurisPlatformServices={};vm.runInNewContext(read('auris-application-lifecycle.js'),c);return c;}

test('manifests publish semantic lifecycle compatibility contracts',()=>{
  const c=context(),registry=c.AurisModuleRegistry;
  assert.equal(registry.version,'2.2.0');assert.equal(registry.platformVersion,'2.0.0');
  for(const manifest of registry.list()){assert.match(manifest.version,/^\d+\.\d+\.\d+$/);assert.equal(Object.isFrozen(manifest.compatibility),true);assert.equal(manifest.compatibility.platform,'^2.0.0');assert.ok(manifest.compatibility.migrations.includes('20260901040000_modular_foundation_13_application_lifecycle'));for(const dependency of manifest.dependencies)assert.equal(manifest.compatibility.dependencies[dependency],'^2.0.0');}
});

test('upgrade planning blocks dependencies and migrations before pilot activation',()=>{
  const c=context(),service=c.AurisApplicationLifecycle,migration={migration_key:'20260901040000_modular_foundation_13_application_lifecycle',status:'succeeded'};
  assert.equal(service.satisfies('2.5.1','^2.0.0'),true);assert.equal(service.satisfies('3.0.0','^2.0.0'),false);
  const allowed=service.planUpgrade('events','2.1.0',{states:{events:{installed_version:'2.0.0'}},migrations:[migration]});assert.equal(allowed.compatible,true);assert.equal(allowed.activation,'pilot');
  const blocked=service.planUpgrade('events','2.1.0',{states:{events:{installed_version:'2.0.0'}},migrations:[]});assert.equal(blocked.compatible,false);assert.match(blocked.blockers.join(' '),/Migration .* pending/);
  assert.match(service.redactError(new Error('failed https://secret.example/token abcdefghijklmnopqrstuvwxyz123456')).message,/\[url\].*\[redacted\]/);
});

test('tenant lifecycle migration is RLS-protected, idempotent and rollback-capable',()=>{
  const sql=read('supabase/migrations/20260901040000_modular_foundation_13_application_lifecycle.sql');
  for(const table of ['company_application_releases','application_upgrade_runs','application_migration_status','application_health_events']){assert.match(sql,new RegExp(`create table if not exists public\\.${table}`,'i'));assert.match(sql,new RegExp(`alter table public\\.${table} enable row level security`,'i'));}
  for(const marker of ['auris_can_access_company','auris_can_manage_company','pg_advisory_xact_lock','idempotency_key','begin_application_upgrade','finish_application_upgrade','rollback_application_release','previous_version','activation_status','safe_context'])assert.match(sql,new RegExp(marker));
  assert.match(sql,/activation_status=case when p_status='failed' then 'paused'/i);
  assert.doesNotMatch(sql,/grant\s+(insert|update|delete)\s+on\s+public\.(company_application_releases|application_upgrade_runs)/i);
});

test('operations UI and deployment expose version, health and release identity',()=>{
  const html=read('index.html'),core=read('auris-core.js'),api=read('api/runtime-config.js'),admin=read('auris-applications-admin.js'),manifest=read('sw-assets.js');
  assert.match(html,/modular-foundation-26/);assert.match(html,/settings-application-lifecycle-card/);assert.ok(html.indexOf('auris-application-lifecycle.js?v=20260901-13')<html.indexOf('auris-core.js?v=20260901-11'));
  assert.match(core,/AurisApplicationLifecycle\.configurePersistence/);assert.match(core,/AurisApplicationLifecycle\.renderOperations/);assert.match(admin,/platformRange/);
  for(const marker of ["build: '2026-09-03-modular-foundation-26'","platformVersion: '2.0.0'","moduleRegistryVersion: '2.2.0'"])assert.match(api,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(manifest,/auris-application-lifecycle\.js/);assert.match(manifest,/auris-application-lifecycle-persistence\.js/);
});

test('enterprise quality, extension and recovery contracts are executable',()=>{
  const result=spawnSync(process.execPath,['scripts/verify-platform-quality.cjs'],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stdout+result.stderr);
  const extension=read('AURIS_APPLICATION_EXTENSION_CONTRACT.md'),recovery=read('APPLICATION_RECOVERY_REHEARSAL.md');
  for(const marker of ['semantic','AurisModuleRuntime','AurisPlatformServices','RLS','idempotency','performance'])assert.match(extension,new RegExp(marker,'i'));
  for(const marker of ['pilot company','governed rollback','previous version','disposable backup','Never rehearse destructive restore steps against production'])assert.match(recovery,new RegExp(marker,'i'));
});
