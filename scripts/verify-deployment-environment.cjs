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

const environment = String(process.env.VERCEL_ENV || 'development').toLowerCase();
const supabaseUrl = process.env.SUPABASE_URL;
const publicKey = process.env.SUPABASE_ANON_KEY;
const projectRef = projectRefFromUrl(supabaseUrl);
const errors = [];

if (environment === 'preview') {
  if (!projectRef) errors.push('Preview requires a valid HTTPS SUPABASE_URL.');
  if (projectRef === productionProjectRef) errors.push('Preview cannot use the AURIS360 production Supabase project.');
  if (!publicKey) errors.push('Preview requires SUPABASE_ANON_KEY from the staging Supabase project.');
}

if (environment === 'production') {
  if (!projectRef) errors.push('Production requires a valid HTTPS SUPABASE_URL.');
  if (projectRef && projectRef !== productionProjectRef) errors.push('Production is not connected to the approved AURIS360 production Supabase project.');
}

if (errors.length) {
  console.error('Unsafe deployment environment:');
  errors.forEach(error => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Deployment environment boundary passed (${environment}${projectRef ? `, Supabase project ${projectRef}` : ''}).`);

module.exports = { projectRefFromUrl, productionProjectRef };
