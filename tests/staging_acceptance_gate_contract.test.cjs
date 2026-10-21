const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('staging acceptance rejects production and requires the approved staging project', () => {
  const source = read('scripts/verify-staging-acceptance.cjs');
  assert.match(source, /::error title=Staging acceptance failed::/);
  assert.match(source, /APPROVED_STAGING_REF = 'beoutmqttgfyyzndcdxu'/);
  assert.match(source, /PRODUCTION_REF = 'iarfxjhahzbhncsaohbg'/);
  assert.match(source, /Production application URLs are forbidden/);
  assert.match(source, /Expected a Preview deployment/);
});

test('staging acceptance authenticates without exposing credentials and verifies tenant scope', () => {
  const source = read('scripts/verify-staging-acceptance.cjs');
  assert.match(source, /auth\/v1\/token\?grant_type=password/);
  assert.match(source, /AURIS360 Staging Test/);
  assert.match(source, /Authorization: `Bearer \$\{auth\.access_token\}`/);
  assert.doesNotMatch(source, /console\.log\([^\n]*(password|access_token|anonKey)/i);
});

test('staging acceptance verifies atomic minutes RPC only after sign-in and exact staging tenant checks', () => {
  const source=read('scripts/verify-staging-acceptance.cjs');
  assert.match(source,/const \{ verifyMeetingsRpc \} = require\('\.\/verify-meetings-rpc\.cjs'\)/);
  assert.ok(source.indexOf('await verifyMeetingsRpc(')>source.indexOf("projectRef(runtime.supabaseUrl) !== APPROVED_STAGING_REF"));
  assert.ok(source.indexOf('await verifyMeetingsRpc(')>source.indexOf('const auth = await retryJsonRequest'));
  assert.ok(source.indexOf('await verifyMeetingsRpc(')>source.indexOf('Authenticated profile is not assigned to the dedicated staging tenant.'));
  assert.ok(source.indexOf('await verifyMeetingsRpc(')<source.indexOf('const minutesPayload ='));
  assert.match(source,/accessToken: auth\.access_token/);
  assert.match(source,/expectedProjectRef: APPROVED_STAGING_REF/);
  assert.match(source,/Atomic HSE minutes save RPC/);
});

test('atomic minutes functional acceptance uses one isolated Draft fixture, optimistic update token and exact tenant readback',()=>{
  const source=read('scripts/verify-staging-acceptance.cjs');
  assert.match(source,/minutesId = 'c2400000-0000-4000-8000-000000000001'/);
  assert.match(source,/QA Improvement 260910 minutes save fixture/);
  assert.match(source,/hse_meetings\?select=id,company_id,title,updated_at&id=eq\.\$\{encodeURIComponent\(minutesId\)\}&\$\{companyFilter\}&limit=2/);
  assert.match(source,/previousMinutes\.title !== minutesTitle/);assert.match(source,/!previousMinutes\.updated_at/);
  assert.match(source,/p_expected_updated_at: previousMinutes \? previousMinutes\.updated_at : null/);
  assert.match(source,/meeting_type: 'other', status: 'draft'/);assert.match(source,/T05:00:00\.000Z/);assert.match(source,/meeting_timezone: 'Asia\/Dubai'/);
  assert.match(source,/series_id: null/);assert.match(source,/agenda_items: \[\], recommendations: \[\]/);assert.match(source,/!matchesMinutes\(minutesReloaded\[0\]\)/);
  assert.match(source,/Atomic minutes draft save\/readback/);assert.doesNotMatch(source,/console\.(log|warn|error)\([^\n]*(minutesPayload|minutesSaved|headers|access_token|anonKey|password)/);
});

test('the synthetic 09:00 Dubai meeting uses the Dubai calendar date across UTC midnight boundaries',()=>{
  const source=read('scripts/verify-staging-acceptance.cjs'),assignment=source.match(/const minutesCalendarDate = [^\n]+;/)[0];
  for(const [instant,expected] of [['2026-10-20T19:30:00.000Z','2026-10-20'],['2026-10-20T21:30:00.000Z','2026-10-21']]){
    const CalendarDate=class extends Date{constructor(){super(instant);}};
    const day=vm.runInNewContext(assignment+'\nminutesCalendarDate;',{Intl,Date:CalendarDate});
    assert.equal(day,expected);assert.equal(new Date(day+'T05:00:00.000Z').toLocaleString('en-GB',{timeZone:'Asia/Dubai',hour:'2-digit',minute:'2-digit',hour12:false}),'09:00');
  }
});

test('staging authentication tolerates transient cold starts without masking credential failures', () => {
  const script = read('scripts/verify-staging-acceptance.cjs');
  assert.match(script, /retryableRequestError/);
  assert.match(script, /error\.name === 'AbortError'/);
  assert.match(script, /status === 429 \|\| status >= 500/);
  assert.match(script, /timeoutMs: 30000/);
  assert.match(script, /attempts: 3/);
});

test('staging acceptance verifies governed KPI workflow UI and persistence dependencies', () => {
  const source = read('scripts/verify-staging-acceptance.cjs');
  assert.match(source, /Governed KPI workflow controls/);
  assert.match(source, /version:'1\.1\.2'/);
  assert.match(source, /kpi-workflow\.js/);
  assert.match(source, /workflow_policy_versions\?select=id,module_key,status,version,revision/);
  assert.match(source, /approval_requests\?select=id,module_name,source_record_id,source_page,source_adapter_key,from_state,to_state,status,revision/);
});

test('four previously blank modules verify deployed render and controlled empty-state contracts', () => {
  const source = read('scripts/verify-staging-acceptance.cjs');
  for (const table of ['events', 'kpi_monthly_data', 'engagement_configuration_versions', 'documents']) {
    assert.match(source, new RegExp(`${table}\\?select=id`));
  }
  for (const asset of ['auris-module-registry.js', 'auris-platform-services.js', 'auris-module-runtime.js', 'auris-application-lifecycle.js', 'auris-application-lifecycle-persistence.js', 'auris-command-centre.js', 'auris-view-engine.js', 'auris-record-workspace.js', 'auris-reporting-engine.js', 'auris-dashboard-designer.js', 'auris-automation-engine.js', 'auris-automation-centre.js', 'auris-integration-engine.js', 'auris-integration-centre.js', 'auris-module-layout.js', 'auris-workflow-service.js', 'auris-approval-centre.js', 'auris-priority-module-adapters.js', 'auris-applications-admin.js', 'auris-workflow-studio.js', 'auris-core.js', 'kpi-module-upgrade.js', 'safety-engagement.js', 'document-control-upgrade.js']) {
    assert.match(source, new RegExp(asset.replace(/\./g, '\\\.')));
  }
  assert.match(source, /Integration engine[\s\S]*version:'1\.5\.0'[\s\S]*genericMappedRows:genericMappedRows/);
  for (const marker of ['No open incidents', 'No KPI data is available.', 'No engagement results for', 'No documents']) {
    assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(source, /presentation_state: rows\.length \? 'populated' : 'controlled_empty'/);
});

test('deployed module navigation is verified through the canonical registry', () => {
  const source = read('scripts/verify-staging-acceptance.cjs');
  for (const marker of ["key:'executive'", "loader:'loadExecutive'", "key:'kpi'", "loader:'kpiLoadAll'", "key:'engagement'", "loader:'loadSafetyEngagement'", "key:'documents'", "loader:'loadDocs'"]) {
    assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(source, /function moduleLoaderFor\(pageKey\)/);
  assert.match(source, /pageLoader=moduleLoaderFor\(name\)/);
  assert.doesNotMatch(source, /executive:loadExecutive/);
  for (const marker of ['activate:activate', 'readiness:readiness', "'auris:module-'+phase"]) assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('staging acceptance safely proves tenant-scoped write persistence', () => {
  const source = read('scripts/verify-staging-acceptance.cjs');
  assert.match(source, /method: 'PATCH'/);
  assert.match(source, /sites\?id=eq\.\$\{encodeURIComponent\(site\.id\)\}&\$\{companyFilter\}/);
  assert.match(source, /\{ name: site\.name \}/);
  assert.match(source, /same-value site PATCH/);
  const persistenceProbe = source.match(/const restWrite[\s\S]*?const profiles/);
  assert.ok(persistenceProbe, 'tenant write helper must remain identifiable');
  assert.doesNotMatch(persistenceProbe[0], /method:\s*'(POST|PUT|DELETE)'/);
});

test('staging acceptance verifies the governed KPI migration without requiring schema-document access', () => {
  const source = read('scripts/verify-staging-acceptance.cjs');
  assert.match(source, /kpis_v2\?select=id,description,data_provider,data_source,reviewer,approver,approval_status,lifecycle_revision,lifecycle_reason,submitted_by,submitted_at,verified_by,verified_at,approved_by,approved_at,locked_by,locked_at/);
  assert.match(source, /kpi_indicators\?select=id,source_mode,source_metric,source_revision/);
  assert.doesNotMatch(source, /application\/openapi\+json/);
  assert.doesNotMatch(source, /PostgREST schema verification/);
});

test('successful Preview deployments trigger the governed acceptance workflow', () => {
  const workflow = read('.github/workflows/staging-acceptance.yml');
  assert.match(workflow, /deployment_status:/);
  assert.match(workflow, /deployment\.environment != 'Production'/);
  assert.match(workflow, /environment: staging/);
  for (const secret of ['STAGING_SUPABASE_URL', 'STAGING_SUPABASE_ANON_KEY', 'STAGING_TEST_EMAIL', 'STAGING_TEST_PASSWORD']) {
    assert.match(workflow, new RegExp(`secrets\\.${secret}`));
  }
  assert.match(workflow, /upload-artifact@v4/);
});

test('staging acceptance serializes the shared tenant job without changing per-deployment duplicate handling',()=>{
  const workflow=read('.github/workflows/staging-acceptance.yml');
  assert.match(workflow,/^concurrency:\r?\n  group: staging-acceptance-\$\{\{ github\.event\.deployment\.id \|\| github\.run_id \}\}\r?\n  cancel-in-progress: true/m);
  const jobConcurrency=workflow.match(/^    concurrency:\r?\n      group: ([^\r\n]+)\r?\n      cancel-in-progress: (true|false)/m);
  assert.ok(jobConcurrency,'The verify job must serialize writes to the shared staging tenant');
  assert.equal(jobConcurrency[1],'staging-acceptance-beoutmqttgfyyzndcdxu-tenant-persistence');assert.equal(jobConcurrency[2],'false');
  assert.doesNotMatch(jobConcurrency[1],/\$\{\{|deployment|run_id|sha/,'Every deployment must use the same tenant lock');
  assert.ok(workflow.indexOf(jobConcurrency[0])>workflow.indexOf('  verify:'));assert.ok(workflow.indexOf(jobConcurrency[0])<workflow.indexOf('    steps:'));
});

test('protected Vercel previews use the automation bypass without exposing it in the URL', () => {
  const source = read('scripts/verify-staging-acceptance.cjs');
  const workflow = read('.github/workflows/staging-acceptance.yml');
  assert.match(workflow, /secrets\.VERCEL_AUTOMATION_BYPASS_SECRET/);
  assert.match(source, /required\('VERCEL_AUTOMATION_BYPASS_SECRET'\)/);
  assert.match(source, /'x-vercel-protection-bypass': vercelBypassSecret/);
  assert.doesNotMatch(source, /x-vercel-protection-bypass=/);
});
