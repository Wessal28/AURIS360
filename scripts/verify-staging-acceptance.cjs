const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const APPROVED_STAGING_REF = 'beoutmqttgfyyzndcdxu';
const PRODUCTION_REF = 'iarfxjhahzbhncsaohbg';
const PRODUCTION_HOSTS = new Set(['auris360.app', 'www.auris360.app', 'auris-360.vercel.app']);

function fail(message) {
  const detail = `Staging acceptance: ${message}`;
  console.error(detail);
  if (process.env.GITHUB_ACTIONS === 'true') {
    console.error(`::error title=Staging acceptance failed::${detail.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);
  }
  process.exit(1);
}

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) fail(`${name} is required.`);
  return value;
}

function parseHttpsUrl(value, label) {
  let url;
  try { url = new URL(value); } catch (_) { fail(`${label} must be a valid URL.`); }
  if (url.protocol !== 'https:') fail(`${label} must use HTTPS.`);
  return url;
}

function projectRef(value) {
  const url = parseHttpsUrl(value, 'STAGING_SUPABASE_URL');
  if (!url.hostname.endsWith('.supabase.co')) return '';
  return url.hostname.slice(0, -'.supabase.co'.length);
}

async function responseText(url, options = {}) {
  const controller = new AbortController();
  const requestOptions = { ...options };
  const timeoutMs = Number(requestOptions.timeoutMs || 15000);
  delete requestOptions.timeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...requestOptions, signal: controller.signal, redirect: 'follow' });
    const text = await response.text();
    if (response.url.startsWith('https://vercel.com/login') && new URL(url).hostname.endsWith('.vercel.app')) {
      throw new Error('Preview deployment protection rejected the automation bypass secret');
    }
    if (!response.ok) {
      const error = new Error(`${response.status} ${response.statusText}`);
      error.status = response.status;
      throw error;
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function jsonRequest(url, options = {}) {
  const text = await responseText(url, options);
  try { return text ? JSON.parse(text) : null; } catch (_) { throw new Error('received invalid JSON'); }
}

function retryableRequestError(error) {
  const status = Number(error && error.status || 0);
  return error && error.name === 'AbortError' || status === 429 || status >= 500;
}

async function retryJsonRequest(url, options = {}, retry = {}) {
  const attempts = Math.max(1, Number(retry.attempts || 3));
  const delayMs = Math.max(0, Number(retry.delayMs || 2000));
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await jsonRequest(url, options); }
    catch (error) {
      lastError = error;
      if (attempt === attempts || !retryableRequestError(error)) throw error;
      console.warn(`Staging request attempt ${attempt} failed (${error.message}); retrying.`);
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw lastError;
}

function runtimeConfig(script) {
  const match = String(script).match(/Object\.freeze\((\{[\s\S]*\})\)\s*;/);
  if (!match) fail('Preview /api/runtime-config did not return a valid public configuration.');
  try { return JSON.parse(match[1]); } catch (_) { fail('Preview runtime configuration could not be parsed.'); }
}

function deployedAssetUrl(html, preview, fileName) {
  const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(html).match(new RegExp(`(?:src|href)=["']([^"']*${escaped}(?:\\?[^"']*)?)["']`, 'i'));
  if (!match) fail(`Preview does not publish ${fileName}.`);
  return new URL(match[1], preview).href;
}

function requireMarkers(source, label, markers) {
  for (const marker of markers) {
    if (!String(source).includes(marker)) fail(`${label} is missing its ${marker} functional marker.`);
  }
}

function reportPathFromArgs() {
  const index = process.argv.indexOf('--report');
  if (index === -1) return '';
  const requested = process.argv[index + 1];
  if (!requested) fail('--report requires a file path.');
  const resolved = path.resolve(root, requested);
  if (!resolved.startsWith(root + path.sep)) fail('Report path must stay inside the repository.');
  return resolved;
}

async function main() {
  const preview = parseHttpsUrl(required('STAGING_APP_URL'), 'STAGING_APP_URL');
  const configuredSupabase = parseHttpsUrl(required('STAGING_SUPABASE_URL'), 'STAGING_SUPABASE_URL');
  const anonKey = required('STAGING_SUPABASE_ANON_KEY');
  const email = required('STAGING_TEST_EMAIL');
  const password = required('STAGING_TEST_PASSWORD');
  const vercelBypassSecret = required('VERCEL_AUTOMATION_BYPASS_SECRET');
  const previewHeaders = { 'x-vercel-protection-bypass': vercelBypassSecret };

  if (PRODUCTION_HOSTS.has(preview.hostname.toLowerCase())) fail('Production application URLs are forbidden.');
  const expectedRef = projectRef(configuredSupabase.href);
  if (expectedRef === PRODUCTION_REF) fail('The production Supabase project is forbidden.');
  if (expectedRef !== APPROVED_STAGING_REF) fail(`Expected approved staging project ${APPROVED_STAGING_REF}.`);

  const appHtml = await responseText(new URL('/', preview).href, { headers: previewHeaders })
    .catch((error) => fail(`preview shell verification failed (${error.message}).`));
  requireMarkers(appHtml, 'Preview shell', ['name="auris-build"', 'id="page-executive"', 'id="page-kpi"', 'id="page-documents"']);

  const assetSources = new Map();
  for(const fileName of ['auris-tools-records.js','auris-tools-records.css']){
    const source=await responseText(deployedAssetUrl(appHtml,preview,fileName),{headers:previewHeaders});
    requireMarkers(source,fileName,fileName.endsWith('.js')?['toolsOpenLinkedRecord','assertSession']:['equipment-window','equipment-fields']);
    assetSources.set(fileName,source);
  }
  for (const fileName of ['auris-work-schedule-workspace.js','auris-work-schedule-workspace.css']) {
    const source = await responseText(deployedAssetUrl(appHtml, preview, fileName), { headers: previewHeaders });
    requireMarkers(source, fileName, fileName.endsWith('.js') ? ['wsOpenRecordRequest','assertSession'] : ['ws-record-window','ws-record-fields']);
    assetSources.set(fileName, source);
  }
  for (const fileName of ['auris-module-registry.js', 'auris-platform-services.js', 'auris-module-runtime.js', 'auris-application-lifecycle.js', 'auris-application-lifecycle-persistence.js', 'auris-command-centre.js', 'auris-view-engine.js', 'auris-record-workspace.js', 'auris-action-record-workspace.js', 'auris-record-edit-session.js', 'auris-form-draft.js', 'kpi-editor-drafts.js', 'auris-action-editor.js', 'auris-action-list-workspace.js', 'auris-moc-list-workspace.js', 'auris-moc-record-workspace.js', 'auris-toolbox-list-workspace.js', 'auris-toolbox-record-workspace.js', 'auris-permit-list-workspace.js', 'auris-permit-record-workspace.js', 'auris-risk-list-workspace.js', 'auris-incident-list-workspace.js', 'auris-tools-list-workspace.js', 'auris-audit-list-workspace.js', 'auris-contractor-list-workspace.js', 'auris-fleet-list-workspace.js', 'auris-atex-list-workspace.js', 'auris-fire-list-workspace.js', 'auris-chemical-list-workspace.js', 'auris-legal-list-workspace.js', 'auris-ppe-list-workspace.js', 'auris-ohealth-list-workspace.js', 'auris-emergency-list-workspace.js', 'auris-esg-list-workspace.js', 'auris-noise-list-workspace.js', 'auris-meetings-list-workspace.js', 'auris-reporting-engine.js', 'auris-dashboard-designer.js', 'auris-automation-engine.js', 'auris-automation-centre.js', 'auris-integration-engine.js', 'auris-integration-centre.js', 'auris-module-extraction.js', 'auris-extracted-module-adapters.js', 'auris-module-layout.js', 'auris-workflow-service.js', 'auris-approval-centre.js', 'auris-priority-module-adapters.js', 'auris-applications-admin.js', 'auris-workflow-studio.js', 'auris-work-centre.js', 'auris-core.js', 'kpi-definition-editor.js', 'kpi-module-upgrade.js', 'kpi-workflow.js', 'kpi-data-source.js', 'safety-engagement.js', 'document-control-upgrade.js']) {
    const source = await responseText(deployedAssetUrl(appHtml, preview, fileName), { headers: previewHeaders })
      .catch((error) => fail(`${fileName} deployment verification failed (${error.message}).`));
    if (source.length < 100) fail(`${fileName} was returned without usable application code.`);
    assetSources.set(fileName, source);
  }
  const trainingPlanSource = await responseText(deployedAssetUrl(appHtml, preview, 'auris-training-plan-list-workspace.js'), { headers: previewHeaders })
    .catch((error) => fail(`auris-training-plan-list-workspace.js deployment verification failed (${error.message}).`));
  if (trainingPlanSource.length < 100) fail('auris-training-plan-list-workspace.js was returned without usable application code.');
  assetSources.set('auris-training-plan-list-workspace.js', trainingPlanSource);

  const functionalViews = [
    ['Executive Dashboard', 'auris-core.js', ['async function loadExecutive()', 'No open incidents']],
    ['Objective and KPI definition editor', 'kpi-definition-editor.js', ['function openObjModal(', 'async function kpiSaveObjective(', 'function openKpiAddModal(', 'async function kpiSaveKPI(', 'function kpiDefinitionCheckContext(']],
    ['Monthly KPI Follow-up', 'kpi-module-upgrade.js', ['No KPI data is available.', 'kpiXRenderMonthly']],
    ['Safety Engagement', 'safety-engagement.js', ['page-engagement', 'No engagement results for']],
    ['Document Control', 'document-control-upgrade.js', ['Loading Document Control', 'No documents']]
  ];
  for (const [label, asset, markers] of functionalViews) requireMarkers(assetSources.get(asset), label, markers);
  requireMarkers(assetSources.get('kpi-data-source.js'), 'Governed KPI data sources', [
    "version:'1.0.0'", 'configure_kpi_indicator_source', 'refresh_kpi_indicator_month', 'override_kpi_monthly_result', 'function showFailure('
  ]);
  requireMarkers(assetSources.get('kpi-workflow.js'), 'Governed KPI workflow controls', [
    "version:'1.1.2'", 'Submit for verification', 'Retry workflow', 'function enhanceDrawer(', 'function retryWorkflow('
  ]);

  const registrySource = assetSources.get('auris-module-registry.js');
  requireMarkers(registrySource, 'Module registry', [
    "version:'2.2.0'", 'platformVersion:platformVersion', 'module.compatibility=freezeCompatibility',
    "key:'executive'", "loader:'loadExecutive'",
    "key:'kpi'", "loader:'kpiLoadAll'",
    "key:'engagement'", "loader:'loadSafetyEngagement'",
    "key:'documents'", "loader:'loadDocs'"
  ]);
  requireMarkers(assetSources.get('auris-application-lifecycle.js'), 'Application lifecycle', [
    "version:'1.0.0'", 'planUpgrade:planUpgrade', 'compatibility:compatibility', 'redactError:redactError', 'renderOperations:renderOperations'
  ]);
  requireMarkers(assetSources.get('auris-application-lifecycle-persistence.js'), 'Application lifecycle persistence', [
    "version:'1.0.0'", 'begin_application_upgrade', 'finish_application_upgrade', 'rollback_application_release'
  ]);
  requireMarkers(assetSources.get('auris-command-centre.js'), 'Command centre', [
    "version:'1.0.0'", 'catalogue:catalogue', 'execute:execute', 'toggleFavourite:toggleFavourite', 'diagnostics:diagnostics'
  ]);
  requireMarkers(assetSources.get('auris-view-engine.js'), 'Application view engine', [
    "version:'1.2.0'", 'definition:definition', 'model:model', 'mount:mount', 'diagnostics:diagnostics'
  ]);
  requireMarkers(assetSources.get('auris-record-workspace.js'), 'Record workspace engine', [
    "version:'1.2.0'", 'registerAdapter:registerAdapter', 'exactSource:exactSource', 'model:model', 'open:open', 'diagnostics:diagnostics', 'assertCurrentSession', 'data-record-feedback'
  ]);
  requireMarkers(assetSources.get('auris-form-draft.js'), 'Form draft session', ["version:'1.0.0'", 'function protect(']);
  requireMarkers(assetSources.get('kpi-editor-drafts.js'), 'KPI draft controls', ['function begin(', 'function canSave(', 'Restore draft']);
  requireMarkers(assetSources.get('auris-record-edit-session.js'), 'Record edit session', ["version:'1.0.0'", 'assertCurrent', 'return=representation']);
  requireMarkers(assetSources.get('auris-action-editor.js'), 'Master Action editor', ['mapEditorCommit', 'mapEditorWorkflow', 'mapEditorLeave']);
  requireMarkers(assetSources.get('auris-action-record-workspace.js'), 'Master Action record workspace', [
    "version:'1.0.0'", 'explicitOnly:true', 'assertSession', 'availableActions', 'open:open', 'load:load'
  ]);
  requireMarkers(assetSources.get('auris-action-list-workspace.js'), 'Master Action list workspace', [
    "version:'1.0.0'", 'assertSession', 'project:project', 'mount:mount'
  ]);
  requireMarkers(assetSources.get('auris-moc-list-workspace.js'), 'Management of Change list workspace', [
    "version:'1.0.0'", 'assertSession', 'legacyRecord:legacyRecord', 'project:project', 'mount:mount'
  ]);
  requireMarkers(assetSources.get('auris-moc-record-workspace.js'), 'Management of Change record workspace', [
    "version:'1.0.0'", 'explicitOnly:true', 'assertRecord', 'assertSession', 'availableActions', 'open:open', 'load:load'
  ]);
  requireMarkers(assetSources.get('auris-permit-list-workspace.js'), 'Permit to Work list workspace', [
    "version:'1.0.0'", 'assertSession', 'project:project', 'mount:mount'
  ]);
  requireMarkers(assetSources.get('auris-risk-list-workspace.js'), 'Risk Assessment list workspace', [
    "version:'1.0.0'", 'assertSession', 'riskSummary:riskSummary', 'project:project', 'mount:mount'
  ]);
  requireMarkers(assetSources.get('auris-incident-list-workspace.js'), 'Incident Management list workspace', [
    "version:'1.0.0'", 'assertSession', 'project:project', 'mount:mount'
  ]);
  requireMarkers(assetSources.get('auris-tools-list-workspace.js'), 'Tools & Equipment list workspace', [
    "version:'1.0.0'", 'assertSession', 'inspectionFor:inspectionFor', 'project:project', 'mount:mount'
  ]);
  requireMarkers(assetSources.get('auris-audit-list-workspace.js'), 'Audits & Inspections list workspace', [
    "version:'1.0.0'", 'assertSession', 'scoreSummary:scoreSummary', 'project:project', 'mount:mount'
  ]);
  requireMarkers(assetSources.get('auris-contractor-list-workspace.js'), 'Contractor Management list workspace', [
    "version:'1.0.0'", 'assertSession', 'dateState:dateState', 'project:project', 'mount:mount'
  ]);
  requireMarkers(assetSources.get('auris-fleet-list-workspace.js'), 'Fleet Management list workspace', [
    "version:'1.0.0'", 'assertSession', 'checkState:checkState', 'project:project', 'mount:mount'
  ]);
  requireMarkers(assetSources.get('auris-atex-list-workspace.js'), 'ATEX Areas list workspace', [
    "version:'1.0.0'", 'assertSession', 'dateState:dateState', 'project:project', 'mount:mount'
  ]);
  requireMarkers(assetSources.get('auris-fire-list-workspace.js'), 'Fire Certificates list workspace', [
    "version:'1.0.0'", 'assertSession', 'dateState:dateState', 'project:project', 'mount:mount'
  ]);
  requireMarkers(assetSources.get('auris-chemical-list-workspace.js'), 'Chemical Control list workspace', [
    "version:'1.0.0'", 'assertSession', 'dateState:dateState', 'sdsState:sdsState', 'project:project', 'mount:mount'
  ]);
  requireMarkers(assetSources.get('auris-legal-list-workspace.js'), 'Legal Compliance list workspace', [
    "version:'1.0.0'", 'assertSession', 'dateState:dateState', 'project:project', 'mount:mount'
  ]);
  requireMarkers(assetSources.get('auris-ppe-list-workspace.js'), 'PPE list workspace', [
    "version:'1.0.0'", 'assertSession', 'dateState:dateState', 'project:project', 'mount:mount'
  ]);
  requireMarkers(assetSources.get('auris-ohealth-list-workspace.js'), 'Occupational Health list workspace', [
    "version:'1.0.0'", 'assertSession', 'dateState:dateState', 'project:project', 'mount:mount'
  ]);
  requireMarkers(assetSources.get('auris-emergency-list-workspace.js'), 'Emergency equipment list workspace', [
    "version:'1.0.0'", 'assertSession', 'dateState:dateState', 'project:project', 'mount:mount'
  ]);
  requireMarkers(assetSources.get('auris-esg-list-workspace.js'), 'Environmental inspection list workspace', [
    "version:'1.0.0'", 'assertSession', 'dateState:dateState', 'project:project', 'mount:mount'
  ]);
  requireMarkers(assetSources.get('auris-noise-list-workspace.js'), 'Noise survey list workspace', [
    "version:'1.0.0'", 'assertSession', 'dateState:dateState', 'project:project', 'mount:mount'
  ]);
  requireMarkers(assetSources.get('auris-meetings-list-workspace.js'), 'HSE meeting list workspace', [
    "version:'1.0.0'", 'assertSession', 'dateState:dateState', 'project:project', 'mount:mount'
  ]);
  requireMarkers(assetSources.get('auris-training-plan-list-workspace.js'), 'Training plan list workspace', [
    "version:'1.0.0'", 'assertSession', 'dateState:dateState', 'project:project', 'mount:mount'
  ]);
  requireMarkers(assetSources.get('auris-toolbox-record-workspace.js'), 'Toolbox talk record workspace', [
    "version:'1.0.0'", 'explicitOnly:true', 'assertRecord', 'assertSession', 'availableActions', 'open:open', 'load:load'
  ]);
  requireMarkers(assetSources.get('auris-toolbox-list-workspace.js'), 'Toolbox talk list workspace', [
    "version:'1.0.0'", 'assertSession', 'project:project', 'mount:mount'
  ]);
  requireMarkers(assetSources.get('auris-permit-record-workspace.js'), 'Permit to Work record workspace', [
    "version:'1.0.0'", 'explicitOnly:true', 'assertRecord', 'assertSession', 'availableActions', 'open:open', 'load:load'
  ]);
  requireMarkers(assetSources.get('auris-reporting-engine.js'), 'Reporting and analysis engine', [
    "version:'1.0.0'", 'definition:definition', 'aggregate:aggregate', 'csv:csv', 'mount:mount', 'diagnostics:diagnostics'
  ]);
  requireMarkers(assetSources.get('auris-dashboard-designer.js'), 'Dashboard designer', [
    "version:'1.0.0'", 'configuration:configuration', 'mount:mount', 'diagnostics:diagnostics'
  ]);
  requireMarkers(assetSources.get('auris-automation-engine.js'), 'Automation engine', [
    "version:'1.0.0'", 'definition:definition', 'plan:plan', 'execute:execute', 'diagnostics:diagnostics'
  ]);
  requireMarkers(assetSources.get('auris-automation-centre.js'), 'Automation Centre', [
    "version:'1.0.0'", 'mount:mount', 'load:load', 'canManage:canManage'
  ]);
  requireMarkers(assetSources.get('auris-integration-engine.js'), 'Integration engine', [
    "version:'1.5.0'", 'connection:connection', 'event:event', 'delivery:delivery', 'exportCsv:exportCsv', 'parseCsv:parseCsv', 'importPlan:importPlan', 'stagedImport:stagedImport', 'stagedReconciliation:stagedReconciliation', 'mappingProfile:mappingProfile', 'mappedImport:mappedImport', 'stagedMappedImport:stagedMappedImport', 'exchangeSchedule:exchangeSchedule', 'scheduledMappedImport:scheduledMappedImport', 'genericMappedRows:genericMappedRows'
  ]);
  requireMarkers(assetSources.get('auris-integration-centre.js'), 'Integration Centre', [
    "version:'1.4.0'", 'mount:mount', 'load:load', 'canManage:canManage', 'Governed recurring data intake', 'queue_data_exchange_run', 'Save schedule draft', 'Safe rollback'
  ]);
  requireMarkers(assetSources.get('auris-module-runtime.js'), 'Module runtime', [
    "version:'2.0.0'", 'activate:activate', 'readiness:readiness', "'auris:module-'+phase"
  ]);
  requireMarkers(assetSources.get('auris-module-extraction.js'), 'Module extraction boundary', [
    "version:'1.0.0'", 'prepare:prepare', 'isolateFailure:isolateFailure', 'safeAsset:safeAsset'
  ]);
  requireMarkers(assetSources.get('auris-extracted-module-adapters.js'), 'Extracted module adapters', [
    "version:'1.0.0'", 'contextFor:contextFor', 'auris:extracted-module-ready'
  ]);
  requireMarkers(assetSources.get('auris-platform-services.js'), 'Platform services', [
    "version:'1.0.0'", 'configure:configure', 'notifications:facade'
  ]);
  requireMarkers(assetSources.get('auris-module-layout.js'), 'Module layout', [
    "version:'1.0.0'", 'mount:mount', 'setView:setView', 'normaliseViews:normaliseViews'
  ]);
  requireMarkers(assetSources.get('auris-workflow-service.js'), 'Workflow service', [
    "version:'3.0.0'", 'review:review', 'simulate:simulate', 'requireTransition:requireTransition', 'transition:transition'
  ]);
  requireMarkers(assetSources.get('auris-approval-centre.js'), 'Approval Centre service', [
    "version:'3.0.0'", 'registerAdapters:registerAdapters', 'assertSource:assertSource', 'decide:decide'
  ]);
  requireMarkers(assetSources.get('auris-priority-module-adapters.js'), 'Priority module adapters', [
    "version:'1.0.0'", "risk:{", "permit:{", "documents:{", "moc:{", "actions:{"
  ]);
  requireMarkers(assetSources.get('auris-applications-admin.js'), 'Applications administration', [
    "version:'1.0.0'", 'planEnable:planEnable', 'planDisable:planDisable', 'renderPortfolio:renderPortfolio'
  ]);
  requireMarkers(assetSources.get('auris-workflow-studio.js'), 'Visual Workflow Studio', [
    "version:'1.0.0'", 'Save draft', 'Simulate transition', 'Export reviewed JSON', 'Import reviewed JSON'
  ]);
  requireMarkers(assetSources.get('auris-work-centre.js'), 'Unified Work and Activity Centre', [
    "version:'1.0.0'", 'Offline read-only view', 'addActivity:addActivity', 'delegate:delegate', 'openSource:openSource'
  ]);
  const coreSource = assetSources.get('auris-core.js');
  requireMarkers(coreSource, 'Module navigation', [
    'function moduleLoaderFor(pageKey)',
    'window.AurisModuleRegistry',
    'pageLoader=moduleLoaderFor(name)'
  ]);

  const runtime = runtimeConfig(await responseText(new URL('/api/runtime-config', preview).href, {
    headers: previewHeaders
  }).catch((error) => fail(`preview runtime verification failed (${error.message}).`)));
  if (runtime.error) fail(`Preview rejected its runtime configuration: ${runtime.error}`);
  if (runtime.environment !== 'preview') fail(`Expected a Preview deployment, received ${runtime.environment || 'unknown'}.`);
  if (projectRef(runtime.supabaseUrl) !== APPROVED_STAGING_REF) fail('Preview is not connected to the approved staging project.');
  if (runtime.supabaseUrl.replace(/\/$/, '') !== configuredSupabase.href.replace(/\/$/, '')) fail('Preview and acceptance secret reference different staging URLs.');

  const base = configuredSupabase.href.replace(/\/$/, '');
  const auth = await retryJsonRequest(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    timeoutMs: 30000
  }, { attempts: 3, delayMs: 2000 }).catch((error) => fail(`staging sign-in failed (${error.message}).`));
  if (!auth || !auth.access_token || !auth.user || !auth.user.id) fail('Staging sign-in returned no authenticated identity.');

  const headers = { apikey: anonKey, Authorization: `Bearer ${auth.access_token}`, Accept: 'application/json' };
  const rest = async (resource) => jsonRequest(`${base}/rest/v1/${resource}`, { headers });
  const restWrite = async (resource, body) => jsonRequest(`${base}/rest/v1/${resource}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(body)
  });
  const profiles = await rest(`profiles?select=id,company_id,role,status&id=eq.${encodeURIComponent(auth.user.id)}&limit=1`)
    .catch((error) => fail(`profile verification failed (${error.message}).`));
  if (!Array.isArray(profiles) || profiles.length !== 1 || !profiles[0].company_id) fail('Staging identity has no usable application profile.');
  const profile = profiles[0];
  if (String(profile.status || '').toLowerCase() !== 'active') fail('Staging test profile is not active.');

  const companies = await rest(`companies?select=id,name&id=eq.${encodeURIComponent(profile.company_id)}&limit=1`)
    .catch((error) => fail(`tenant verification failed (${error.message}).`));
  if (!Array.isArray(companies) || companies.length !== 1 || companies[0].name !== 'AURIS360 Staging Test') {
    fail('Authenticated profile is not assigned to the dedicated staging tenant.');
  }

  const companyFilter = `company_id=eq.${encodeURIComponent(profile.company_id)}`;
  const sources = [
    ['Equipment inspection lifecycle (apply 20260911030000_tool_inspection_record_lifecycle.sql if missing)', `tool_inspections?select=id,tool_id,inspection_date,overall_result,status,archived_at,archived_by,archived_by_name,archive_reason,updated_at&status=eq.active&${companyFilter}&order=inspection_date.desc&limit=1`],
    ['Pre-start inspection forms (apply 20260909180000_inspection_prestart_form_fields.sql if missing)', `inspections?select=id,items,activity,location,inspection_time,duration_hours,supervisor,team_members,ra_ref,ptw_ref,tbt_done,tbt_topics,stop_work_briefed,decision,decision_notes,hazards,controls,ppe_required,ppe_extra,prestart_signed_at&${companyFilter}&limit=1`],
    ['Executive Dashboard', `events?select=id&${companyFilter}&limit=1`],
    ['Executive Dashboard actions', `action_tracker?select=id&${companyFilter}&limit=1`],
    ['Toolbox Talks (apply 20260907010000_toolbox_talk_save_fields.sql if missing)', `toolbox_talks?select=id,tbt_ref,topic_category,presenter,duration_mins,incidents_referenced&${companyFilter}&limit=1`],
    ['Monthly KPI Follow-up', `kpi_monthly_data?select=id&${companyFilter}&limit=1`],
    ['Governed KPI definitions', `kpis_v2?select=id,description,data_provider,data_source,reviewer,approver,approval_status,lifecycle_revision,lifecycle_reason,submitted_by,submitted_at,verified_by,verified_at,approved_by,approved_at,locked_by,locked_at&${companyFilter}&limit=1`],
    ['Planned KPI months (apply 20260911010000_kpi_planned_reporting_months.sql if missing)', `kpis_v2?select=id,frequency,planned_months&${companyFilter}&limit=1`],
    ['Retained chemical SDS (apply 20260911020000_chemical_sds_document_storage.sql if missing)', `chemical_register?select=id,sds_file_url,sds_file_path,sds_file_mime&${companyFilter}&limit=1`],
    ['Retained SDS versions (apply 20260911020000_chemical_sds_document_storage.sql if missing)', `chemical_sds_versions?select=id,file_url,file_path,file_mime&${companyFilter}&limit=1`],
    ['Completed meeting minutes', `hse_meetings?select=id,title,series_id,status,meeting_date,minutes,agenda_items,recommendations&${companyFilter}&limit=1`],
    ['Governed KPI sources', `kpi_indicators?select=id,source_mode,source_metric,source_revision&${companyFilter}&limit=1`],
    ['Workflow governance', `workflow_policy_versions?select=id,module_key,status,version,revision&${companyFilter}&limit=1`],
    ['Approval governance', `approval_requests?select=id,module_name,source_record_id,source_page,source_adapter_key,from_state,to_state,status,revision&${companyFilter}&limit=1`],
    ['Safety Engagement', `engagement_configuration_versions?select=id&${companyFilter}&limit=1`],
    ['Document Control', `documents?select=id&${companyFilter}&limit=1`],
    ['Staging site', `sites?select=id,name,updated_at&${companyFilter}&limit=1`]
  ];
  const checks = [];
  const sourceRows = new Map();
  for (const [label, resource] of sources) {
    const rows = await rest(resource).catch((error) => fail(`${label} data source is unavailable (${error.message}).`));
    if (!Array.isArray(rows)) fail(`${label} data source returned an invalid response.`);
    sourceRows.set(label, rows);
    checks.push({ label, accessible: true, sample_rows: rows.length, presentation_state: rows.length ? 'populated' : 'controlled_empty' });
  }

  const site = (sourceRows.get('Staging site') || [])[0];
  if (!site || !site.id || !site.name) fail('The staging tenant needs one dedicated site for the persistence probe.');
  const writeRows = await restWrite(
    `sites?id=eq.${encodeURIComponent(site.id)}&${companyFilter}&select=id,name,updated_at`,
    { name: site.name }
  ).catch((error) => fail(`staging write persistence probe failed (${error.message}).`));
  if (!Array.isArray(writeRows) || writeRows.length !== 1 || writeRows[0].id !== site.id || writeRows[0].name !== site.name) {
    fail('Staging write persistence probe did not return the exact tenant-scoped site.');
  }
  checks.push({ label: 'Tenant-scoped write persistence', accessible: true, record_id: site.id, operation: 'same-value site PATCH' });

  const storedFiles = await jsonRequest(base + '/storage/v1/object/list/documents', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix: profile.company_id + '/chemical-sds/', limit: 1, offset: 0 })
  }).catch(error => fail('Chemical SDS documents bucket is unavailable (' + error.message + ').'));
  if (!Array.isArray(storedFiles)) fail('Chemical SDS storage returned an invalid listing.');
  checks.push({ label: 'Chemical SDS storage listing', accessible: true, sample_rows: storedFiles.length });

  const probePath = profile.company_id + '/chemical-sds/qa-pr118-storage-probe.pdf';
  const probe = fs.readFileSync(path.join(root, 'tests/fixtures/qa-pr118-sds.pdf'));
  const uploadResponse = await fetch(base + '/storage/v1/object/documents/' + probePath, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: probe
  });
  if (!uploadResponse.ok) {
    const detail = await uploadResponse.json().catch(() => ({}));
    fail('Synthetic SDS upload failed (' + uploadResponse.status + '): ' + String(detail.message || detail.error || 'Storage rejected upload'));
  }
  const previewResponse = await fetch(base + '/storage/v1/object/public/documents/' + probePath);
  if (!previewResponse.ok) fail('Retained SDS public preview unavailable (' + previewResponse.status + ').');
  if (!Buffer.from(await previewResponse.arrayBuffer()).equals(probe)) fail('Retained SDS preview bytes do not match the uploaded fixture.');
  checks.push({ label: 'Synthetic SDS upload and retained preview', accessible: true });

  // Synthetic round-trip records are restricted to the verified staging tenant above.
  const matrix = { version: 1, kind: 'matrix', name: 'QA completion matrix', severity: ['Negligible','Minor','Moderate','Major','Extreme'], likelihood: ['Rare','Unlikely','Possible','Likely','Almost Certain'], cells: [['Very Low','Very Low','Low','Low','Medium'],['Very Low','Low','Low','Medium','High'],['Low','Low','Medium','High','High'],['Low','Medium','High','High','Very High'],['Medium','High','High','Very High','Very High']] };
  const photo = { data: 'data:image/jpeg;base64,' + fs.readFileSync(path.join(root, 'tests/fixtures/qa-attendance.jpg')).toString('base64'), name: 'qa-attendance.jpg', uploaded_by: profile.id };
  async function completionProbe(table, title, field, value, extra) {
    const found = await rest(`${table}?select=id&${companyFilter}&title=eq.${encodeURIComponent(title)}&limit=2`);
    if (!Array.isArray(found) || found.length > 1) fail(`Ambiguous synthetic ${table} fixture.`);
    const body = {company_id: profile.company_id, title, status: 'draft', ...extra, [field]: value};
    const resource = table + (found.length ? `?id=eq.${encodeURIComponent(found[0].id)}&${companyFilter}` : '');
    const saved = await jsonRequest(`${base}/rest/v1/${resource}`, {method: found.length ? 'PATCH' : 'POST', headers: {...headers, 'Content-Type':'application/json', Prefer:'return=representation'}, body:JSON.stringify(body)});
    if (!Array.isArray(saved) || saved.length !== 1 || saved[0].company_id !== profile.company_id) fail(`Synthetic ${table} save was not confirmed.`);
    const fetched = await rest(`${table}?select=id,company_id,${field}&id=eq.${encodeURIComponent(saved[0].id)}&${companyFilter}&limit=1`);
    const assert = require('node:assert/strict');
    assert.deepEqual(fetched[0]?.[field], value, `${table}.${field} did not survive reload`);
    checks.push({label:`Completion ${table}.${field} authenticated round trip`,accessible:true,record_id:saved[0].id});
  }
  await completionProbe('toolbox_talks', 'QA Improvement 260910 attendance fixture', 'attendance_photo', photo, {talk_date:'2026-09-13', presenter:'Synthetic QA', topic_category:'safety_general'});
  await completionProbe('documents', 'QA Improvement 260910 matrix fixture', 'template_definition', matrix, {document_type:'risk_assessment',doc_type:'risk_assessment',category:'Company Risk Matrix',approval_status:'draft'});
  await completionProbe('risk_assessments', 'QA Improvement 260910 matrix snapshot fixture', 'risk_matrix_snapshot', matrix, {ra_type:'task',ra_type_v2:'task'});

  const emptySources = checks.filter((check) => check.presentation_state === 'controlled_empty').map((check) => check.label);

  const evidence = {
    generated_at: new Date().toISOString(),
    status: emptySources.length ? 'passed_with_controlled_empty_states' : 'passed',
    preview_host: preview.hostname,
    staging_project_ref: APPROVED_STAGING_REF,
    tenant_name: companies[0].name,
    profile_role: profile.role,
    checks,
    deployed_functional_views: functionalViews.map((view) => view[0]),
    controlled_empty_sources: emptySources
  };
  const reportPath = reportPathFromArgs();
  if (reportPath) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`Staging acceptance evidence written to ${path.relative(root, reportPath)}.`);
  }
  if (emptySources.length) console.warn(`Controlled empty states verified for: ${emptySources.join(', ')}.`);
  console.log(`Staging functional acceptance passed: ${functionalViews.length} rendered module contracts and ${checks.length} tenant-scoped checks verified on ${preview.hostname}.`);
}

main().catch((error) => fail(error && error.message ? error.message : 'unexpected verification failure.'));
