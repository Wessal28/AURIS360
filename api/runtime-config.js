const productionProjectRef = 'iarfxjhahzbhncsaohbg';

function projectRefFromUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) return '';
    return url.hostname.slice(0, -'.supabase.co'.length);
  } catch (_) {
    return '';
  }
}

function safePublicKey(value) {
  const key = String(value || '').trim();
  if (!key || key.startsWith('sb_secret_')) return '';
  if (key.startsWith('sb_publishable_')) return key;
  try {
    const payload = JSON.parse(Buffer.from(key.split('.')[1] || '', 'base64url').toString('utf8'));
    return payload.role === 'anon' ? key : '';
  } catch (_) {
    return '';
  }
}

module.exports = function handler(req, res) {
  if (String(req.method || 'GET').toUpperCase() !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).end('GET only');
  }

  const environment = String(process.env.VERCEL_ENV || 'development').toLowerCase();
  const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const supabaseAnonKey = safePublicKey(process.env.SUPABASE_ANON_KEY);
  const projectRef = projectRefFromUrl(supabaseUrl);
  const errors = [];

  if (!projectRef) errors.push('A valid Supabase URL is not configured.');
  if (environment === 'preview' && projectRef === productionProjectRef) errors.push('Preview access to the production data project is blocked.');
  if (environment === 'preview' && !supabaseAnonKey) errors.push('The staging public key is not configured.');
  if (environment === 'production' && projectRef && projectRef !== productionProjectRef) errors.push('Production is connected to an unapproved data project.');

  const config = {
    environment,
    supabaseUrl: errors.length ? '' : supabaseUrl,
    supabaseAnonKey: errors.length ? '' : supabaseAnonKey,
    releaseSha: String(process.env.VERCEL_GIT_COMMIT_SHA || '').trim(),
    build: '2026-09-01-modular-foundation-17',
    platformVersion: '2.0.0',
    moduleRegistryVersion: '2.1.0',
    error: errors.join(' ')
  };
  const body = `window.__AURIS_RUNTIME_CONFIG__ = Object.freeze(${JSON.stringify(config)});\n`;

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(200).end(body);
};

module.exports.projectRefFromUrl = projectRefFromUrl;
module.exports.safePublicKey = safePublicKey;
