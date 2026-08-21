const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const APPROVED_STAGING_REF = 'beoutmqttgfyyzndcdxu';
const PRODUCTION_REF = 'iarfxjhahzbhncsaohbg';
const PRODUCTION_HOSTS = new Set(['auris360.app', 'www.auris360.app', 'auris-360.vercel.app']);

function fail(message) {
  console.error(`Staging acceptance: ${message}`);
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
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, redirect: 'follow' });
    const text = await response.text();
    if (response.url.startsWith('https://vercel.com/login') && new URL(url).hostname.endsWith('.vercel.app')) {
      throw new Error('Preview deployment protection rejected the automation bypass secret');
    }
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function jsonRequest(url, options = {}) {
  const text = await responseText(url, options);
  try { return text ? JSON.parse(text) : null; } catch (_) { throw new Error('received invalid JSON'); }
}

function runtimeConfig(script) {
  const match = String(script).match(/Object\.freeze\((\{[\s\S]*\})\)\s*;/);
  if (!match) fail('Preview /api/runtime-config did not return a valid public configuration.');
  try { return JSON.parse(match[1]); } catch (_) { fail('Preview runtime configuration could not be parsed.'); }
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

  if (PRODUCTION_HOSTS.has(preview.hostname.toLowerCase())) fail('Production application URLs are forbidden.');
  const expectedRef = projectRef(configuredSupabase.href);
  if (expectedRef === PRODUCTION_REF) fail('The production Supabase project is forbidden.');
  if (expectedRef !== APPROVED_STAGING_REF) fail(`Expected approved staging project ${APPROVED_STAGING_REF}.`);

  const runtime = runtimeConfig(await responseText(new URL('/api/runtime-config', preview).href, {
    headers: { 'x-vercel-protection-bypass': vercelBypassSecret }
  }).catch((error) => fail(`preview runtime verification failed (${error.message}).`)));
  if (runtime.error) fail(`Preview rejected its runtime configuration: ${runtime.error}`);
  if (runtime.environment !== 'preview') fail(`Expected a Preview deployment, received ${runtime.environment || 'unknown'}.`);
  if (projectRef(runtime.supabaseUrl) !== APPROVED_STAGING_REF) fail('Preview is not connected to the approved staging project.');
  if (runtime.supabaseUrl.replace(/\/$/, '') !== configuredSupabase.href.replace(/\/$/, '')) fail('Preview and acceptance secret reference different staging URLs.');

  const base = configuredSupabase.href.replace(/\/$/, '');
  const auth = await jsonRequest(`${base}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  }).catch((error) => fail(`staging sign-in failed (${error.message}).`));
  if (!auth || !auth.access_token || !auth.user || !auth.user.id) fail('Staging sign-in returned no authenticated identity.');

  const headers = { apikey: anonKey, Authorization: `Bearer ${auth.access_token}`, Accept: 'application/json' };
  const rest = async (resource) => jsonRequest(`${base}/rest/v1/${resource}`, { headers });
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
    ['Staging site', `sites?select=id&${companyFilter}&limit=1`]
  ];
  const checks = [];
  for (const [label, resource] of sources) {
    const rows = await rest(resource).catch((error) => fail(`${label} data source is unavailable (${error.message}).`));
    if (!Array.isArray(rows)) fail(`${label} data source returned an invalid response.`);
    checks.push({ label, accessible: true, sample_rows: rows.length });
  }

  const evidence = {
    generated_at: new Date().toISOString(),
    status: 'passed',
    preview_host: preview.hostname,
    staging_project_ref: APPROVED_STAGING_REF,
    tenant_name: companies[0].name,
    profile_role: profile.role,
    checks
  };
  const reportPath = reportPathFromArgs();
  if (reportPath) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`Staging acceptance evidence written to ${path.relative(root, reportPath)}.`);
  }
  console.log(`Staging acceptance passed: ${checks.length} tenant-scoped sources verified on ${preview.hostname}.`);
}

main().catch((error) => fail(error && error.message ? error.message : 'unexpected verification failure.'));
