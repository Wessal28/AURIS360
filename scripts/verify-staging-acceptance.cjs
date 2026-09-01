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
  for (const fileName of ['auris-module-registry.js', 'auris-platform-services.js', 'auris-module-runtime.js', 'auris-module-layout.js', 'auris-workflow-service.js', 'auris-approval-centre.js', 'auris-core.js', 'kpi-module-upgrade.js', 'safety-engagement.js', 'document-control-upgrade.js']) {
    const source = await responseText(deployedAssetUrl(appHtml, preview, fileName), { headers: previewHeaders })
      .catch((error) => fail(`${fileName} deployment verification failed (${error.message}).`));
    if (source.length < 100) fail(`${fileName} was returned without usable application code.`);
    assetSources.set(fileName, source);
  }

  const functionalViews = [
    ['Executive Dashboard', 'auris-core.js', ['async function loadExecutive()', 'No open incidents']],
    ['Monthly KPI Follow-up', 'kpi-module-upgrade.js', ['No KPI data is available.', 'kpiXRenderMonthly']],
    ['Safety Engagement', 'safety-engagement.js', ['page-engagement', 'No engagement results for']],
    ['Document Control', 'document-control-upgrade.js', ['Loading Document Control', 'No documents']]
  ];
  for (const [label, asset, markers] of functionalViews) requireMarkers(assetSources.get(asset), label, markers);

  const registrySource = assetSources.get('auris-module-registry.js');
  requireMarkers(registrySource, 'Module registry', [
    "key:'executive'", "loader:'loadExecutive'",
    "key:'kpi'", "loader:'kpiLoadAll'",
    "key:'engagement'", "loader:'loadSafetyEngagement'",
    "key:'documents'", "loader:'loadDocs'"
  ]);
  requireMarkers(assetSources.get('auris-module-runtime.js'), 'Module runtime', [
    "version:'1.0.0'", 'activate:activate', 'readiness:readiness', "'auris:module-'+phase"
  ]);
  requireMarkers(assetSources.get('auris-platform-services.js'), 'Platform services', [
    "version:'1.0.0'", 'configure:configure', 'notifications:facade'
  ]);
  requireMarkers(assetSources.get('auris-module-layout.js'), 'Module layout', [
    "version:'1.0.0'", 'mount:mount', 'setView:setView', 'normaliseViews:normaliseViews'
  ]);
  requireMarkers(assetSources.get('auris-workflow-service.js'), 'Workflow service', [
    "version:'1.0.0'", 'configure:configure', 'requireTransition:requireTransition', 'transition:transition'
  ]);
  requireMarkers(assetSources.get('auris-approval-centre.js'), 'Approval Centre service', [
    "version:'1.0.0'", 'registerAdapters:registerAdapters', 'assertSource:assertSource', 'decide:decide'
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
    ['Executive Dashboard', `events?select=id&${companyFilter}&limit=1`],
    ['Executive Dashboard actions', `action_tracker?select=id&${companyFilter}&limit=1`],
    ['Monthly KPI Follow-up', `kpi_monthly_data?select=id&${companyFilter}&limit=1`],
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
