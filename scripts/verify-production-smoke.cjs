const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const PRODUCTION_REF = 'iarfxjhahzbhncsaohbg';
const PRODUCTION_HOSTS = new Set(['auris360.app', 'www.auris360.app']);
const REQUEST_TIMEOUT_MS = 15000;
const PRODUCTION_SHELL_MARKERS = Object.freeze([
  'name="auris-build"',
  'id="login-screen"',
  'id="page-dashboard"',
  'id="page-events"',
  'id="page-risk"'
]);

function fail(message) {
  throw new Error(message);
}

function required(name, env = process.env) {
  const value = String(env[name] || '').trim();
  if (!value) fail(`${name} is required.`);
  return value;
}

function productionUrl(value) {
  let url;
  try { url = new URL(value); } catch (_) { fail('PRODUCTION_APP_URL must be a valid URL.'); }
  if (url.protocol !== 'https:') fail('PRODUCTION_APP_URL must use HTTPS.');
  if (!PRODUCTION_HOSTS.has(url.hostname.toLowerCase())) fail('PRODUCTION_APP_URL must use the canonical AURIS360 production domain.');
  if (url.username || url.password || (url.port && url.port !== '443')) fail('PRODUCTION_APP_URL must not contain credentials or a custom port.');
  url.pathname = '/';
  url.search = '';
  url.hash = '';
  return url;
}

function reportPathFromArgs(args = process.argv) {
  const index = args.indexOf('--report');
  if (index === -1) return '';
  const requested = args[index + 1];
  if (!requested) fail('--report requires a file path.');
  const resolved = path.resolve(root, requested);
  if (!resolved.startsWith(root + path.sep)) fail('Report path must stay inside the repository.');
  return resolved;
}

async function request(url, label, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'AURIS360-production-smoke/1.0' }
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return { response, text, duration_ms: Date.now() - startedAt, label };
  } catch (error) {
    fail(`${label} request failed (${error.name === 'AbortError' ? 'timed out' : error.message}).`);
  } finally {
    clearTimeout(timer);
  }
}

function runtimeConfig(script) {
  const match = String(script).match(/Object\.freeze\((\{[\s\S]*\})\)\s*;/);
  if (!match) fail('/api/runtime-config did not return a valid public configuration.');
  try { return JSON.parse(match[1]); } catch (_) { fail('/api/runtime-config returned invalid JSON.'); }
}

function projectRef(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && url.hostname.endsWith('.supabase.co')
      ? url.hostname.slice(0, -'.supabase.co'.length)
      : '';
  } catch (_) { return ''; }
}

function requireMarkers(source, label, markers) {
  for (const marker of markers) {
    if (!String(source).includes(marker)) fail(`${label} is missing its ${marker} release marker.`);
  }
}

function deployedAssetUrl(html, base, fileName) {
  const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(html).match(new RegExp(`(?:src|href)=["']([^"']*${escaped}(?:\\?[^"']*)?)["']`, 'i'));
  if (!match) fail(`Production shell does not publish ${fileName}.`);
  const asset = new URL(match[1], base);
  if (asset.origin !== base.origin) fail(`${fileName} must be served from the production origin.`);
  return asset.href;
}

function expectedReleaseMatches(actual, expected) {
  const cleanActual = String(actual || '').trim().toLowerCase();
  const cleanExpected = String(expected || '').trim().toLowerCase();
  return cleanActual.length >= 7 && cleanExpected.length >= 7 &&
    (cleanActual === cleanExpected || cleanActual.startsWith(cleanExpected) || cleanExpected.startsWith(cleanActual));
}

async function verifyProduction(options, evidence) {
  const env = options.env || process.env;
  const requestAsset = (url, label) => request(url, label, options.fetchImpl);
  const base = productionUrl(required('PRODUCTION_APP_URL', env));
  const expectedSha = required('EXPECTED_DEPLOYMENT_SHA', env);
  if (!/^[a-f0-9]{7,40}$/i.test(expectedSha)) fail('EXPECTED_DEPLOYMENT_SHA must be a Git commit SHA.');
  evidence.production_host = base.hostname;
  evidence.expected_release_sha = expectedSha;

  evidence.stage = 'shell';
  const shell = await requestAsset(base.href, 'production shell');
  evidence.shell_duration_ms = shell.duration_ms;
  requireMarkers(shell.text, 'Production shell', PRODUCTION_SHELL_MARKERS);

  evidence.stage = 'security_headers';
  const headers = Object.fromEntries([...shell.response.headers].map(([name, value]) => [name.toLowerCase(), value]));
  if (!/^no-store\b/i.test(headers['cache-control'] || '')) fail('Production shell must be served with no-store cache control.');
  if ((headers['x-content-type-options'] || '').toLowerCase() !== 'nosniff') fail('Production shell is missing X-Content-Type-Options: nosniff.');
  if ((headers['x-frame-options'] || '').toUpperCase() !== 'DENY') fail('Production shell is missing X-Frame-Options: DENY.');
  if (!/frame-ancestors\s+'none'/i.test(headers['content-security-policy'] || '')) fail('Production shell is missing its enforced frame-ancestors policy.');

  evidence.stage = 'runtime';
  const runtimeResponse = await requestAsset(new URL('/api/runtime-config', base).href, 'runtime configuration');
  const runtime = runtimeConfig(runtimeResponse.text);
  evidence.runtime_duration_ms = runtimeResponse.duration_ms;
  if (runtime.error) fail(`Production runtime rejected its configuration: ${runtime.error}`);
  if (runtime.environment !== 'production') fail(`Expected the production runtime, received ${runtime.environment || 'unknown'}.`);
  if (projectRef(runtime.supabaseUrl) !== PRODUCTION_REF) fail('Production is not connected to the approved Supabase project.');
  evidence.stage = 'release_identity';
  evidence.deployed_release_sha = runtime.releaseSha;
  if (!expectedReleaseMatches(runtime.releaseSha, expectedSha)) {
    fail(`Canonical production is serving ${runtime.releaseSha || 'an unidentified release'}, expected ${expectedSha}.`);
  }

  const assetChecks = evidence.assets;
  const assets = [
    ['auris-module-registry.js', ["version:'2.2.0'", 'platformVersion:platformVersion', 'module.compatibility=freezeCompatibility']],
    ['auris-platform-services.js', ["version:'1.0.0'", 'configure:configure', 'notifications:facade']],
    ['auris-module-layout.js', ["version:'1.0.0'", 'mount:mount', 'setView:setView']],
    ['auris-workflow-service.js', ["version:'3.0.0'", 'review:review', 'simulate:simulate', 'requireTransition:requireTransition']],
    ['auris-approval-centre.js', ["version:'3.0.0'", 'registerAdapters:registerAdapters', 'assertSource:assertSource']],
    ['auris-priority-module-adapters.js', ["version:'1.0.0'", "risk:{", "documents:{", 'mount:mount']],
    ['auris-applications-admin.js', ["version:'1.0.0'", 'planEnable:planEnable', 'renderPortfolio:renderPortfolio']],
    ['auris-workflow-studio.js', ["version:'1.0.0'", 'Save draft', 'Simulate transition', 'Export reviewed JSON']],
    ['auris-work-centre.js', ["version:'1.0.0'", 'Offline read-only view', 'openSource:openSource', 'addActivity:addActivity']],
    ['auris-module-runtime.js', ["version:'2.0.0'", 'activate:activate', 'readiness:readiness']],
    ['auris-application-lifecycle.js', ["version:'1.0.0'", 'planUpgrade:planUpgrade', 'redactError:redactError', 'renderOperations:renderOperations']],
    ['auris-application-lifecycle-persistence.js', ["version:'1.0.0'", 'begin_application_upgrade', 'rollback_application_release']],
    ['auris-command-centre.js', ["version:'1.0.0'", 'catalogue:catalogue', 'execute:execute', 'diagnostics:diagnostics']],
    ['auris-view-engine.js', ["version:'1.2.0'", 'definition:definition', 'model:model', 'mount:mount', 'diagnostics:diagnostics']],
    ['auris-record-workspace.js', ["version:'1.2.0'", 'registerAdapter:registerAdapter', 'exactSource:exactSource', 'model:model', 'open:open', 'diagnostics:diagnostics', 'assertCurrentSession', 'data-record-feedback']],
    ['auris-action-list-workspace.js', ["version:'1.0.0'", 'assertSession', 'project:project', 'mount:mount']],
    ['auris-moc-list-workspace.js', ["version:'1.0.0'", 'assertSession', 'legacyRecord:legacyRecord', 'project:project', 'mount:mount']],
    ['auris-moc-record-workspace.js', ["version:'1.0.0'", 'explicitOnly:true', 'assertRecord', 'assertSession', 'availableActions', 'open:open', 'load:load']],
    ['auris-action-record-workspace.js', ["version:'1.0.0'", 'explicitOnly:true', 'assertSession', 'availableActions', 'open:open', 'load:load']],
    ['auris-permit-list-workspace.js', ["version:'1.0.0'", 'assertSession', 'project:project', 'mount:mount']],
    ['auris-reporting-engine.js', ["version:'1.0.0'", 'definition:definition', 'aggregate:aggregate', 'csv:csv', 'mount:mount', 'diagnostics:diagnostics']],
    ['auris-dashboard-designer.js', ["version:'1.0.0'", 'configuration:configuration', 'mount:mount', 'diagnostics:diagnostics']],
    ['auris-automation-engine.js', ["version:'1.0.0'", 'definition:definition', 'plan:plan', 'execute:execute', 'diagnostics:diagnostics']],
    ['auris-automation-centre.js', ["version:'1.0.0'", 'mount:mount', 'load:load', 'canManage:canManage']],
    ['auris-integration-engine.js', ["version:'1.5.0'", 'connection:connection', 'event:event', 'delivery:delivery', 'exportCsv:exportCsv', 'parseCsv:parseCsv', 'importPlan:importPlan', 'stagedImport:stagedImport', 'stagedReconciliation:stagedReconciliation', 'mappingProfile:mappingProfile', 'mappedImport:mappedImport', 'stagedMappedImport:stagedMappedImport', 'exchangeSchedule:exchangeSchedule', 'scheduledMappedImport:scheduledMappedImport', 'genericMappedRows:genericMappedRows']],
    ['auris-integration-centre.js', ["version:'1.4.0'", 'mount:mount', 'load:load', 'canManage:canManage', 'Governed recurring data intake', 'queue_data_exchange_run', 'Save schedule draft', 'Safe rollback']],
    ['auris-module-extraction.js', ["version:'1.0.0'", 'prepare:prepare', 'isolateFailure:isolateFailure']],
    ['auris-extracted-module-adapters.js', ["version:'1.0.0'", 'contextFor:contextFor']],
    ['auris-core.js', ['AURIS_RUNTIME_CONFIG_READY', 'async function loadDash']],
    ['incident-management-upgrade.js', ['async function loadAll', 'window.imv2SaveForm']],
    ['risk-assessment-upgrade.js', ['function renderDashboard', 'window.loadRA']],
    ['sw.js', ['AURIS_SW_ASSET_MANIFEST']]
  ];
  for (const [fileName, markers] of assets) {
    evidence.stage = 'critical_assets';
    evidence.checking_asset = fileName;
    const url = fileName === 'sw.js' ? new URL('/sw.js', base).href : deployedAssetUrl(shell.text, base, fileName);
    const result = await requestAsset(url, fileName);
    if (result.text.length < 100) fail(`${fileName} was returned without usable application code.`);
    requireMarkers(result.text, fileName, markers);
    assetChecks.push({ asset: fileName, duration_ms: result.duration_ms, bytes: Buffer.byteLength(result.text) });
  }

  const buildMarker = (shell.text.match(/name="auris-build"\s+content="([^"]+)"/) || [])[1] || '';
  Object.assign(evidence, {
    generated_at: new Date().toISOString(),
    status: 'passed',
    production_host: base.hostname,
    expected_release_sha: expectedSha,
    deployed_release_sha: runtime.releaseSha,
    build_marker: buildMarker,
    production_project_ref: PRODUCTION_REF,
    shell_duration_ms: shell.duration_ms,
    runtime_duration_ms: runtimeResponse.duration_ms,
    security_headers: {
      cache_control_no_store: true,
      content_type_nosniff: true,
      framing_denied: true,
      frame_ancestors_none: true
    },
    assets: assetChecks
  });
  evidence.stage = 'complete';
  delete evidence.checking_asset;
  return evidence;
}

async function main(options = {}) {
  const reportPath = reportPathFromArgs(options.args || process.argv);
  const logger = options.logger || console;
  const evidence = { generated_at: new Date().toISOString(), status: 'failed', stage: 'configuration', assets: [] };
  try {
    await verifyProduction(options, evidence);
    logger.log(`Production smoke passed: ${evidence.deployed_release_sha.slice(0, 12)} is live on ${evidence.production_host}; ${evidence.assets.length} critical assets verified.`);
    return evidence;
  } catch (error) {
    evidence.error = error && error.message ? error.message : 'unexpected verification failure.';
    throw error;
  } finally {
    if (reportPath) {
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, `${JSON.stringify(evidence, null, 2)}\n`);
      logger.log(`Production smoke evidence written to ${path.relative(root, reportPath)}.`);
    }
  }
}

module.exports = { expectedReleaseMatches, productionUrl, PRODUCTION_SHELL_MARKERS, main };

if (require.main === module) {
  main().catch((error) => {
    console.error(`Production smoke: ${error && error.message ? error.message : 'unexpected verification failure.'}`);
    process.exitCode = 1;
  });
}
