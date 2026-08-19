const assert = require('assert');
const childProcess = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const node = process.execPath;
const verifier = path.join(root, 'scripts', 'verify-deployment-environment.cjs');
const productionUrl = 'https://iarfxjhahzbhncsaohbg.supabase.co';
const stagingUrl = 'https://stagingprojectref123.supabase.co';

function verify(environment, url, anonKey) {
  return childProcess.spawnSync(node, [verifier], {
    cwd: root,
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      VERCEL_ENV: environment,
      SUPABASE_URL: url || '',
      SUPABASE_ANON_KEY: anonKey || ''
    })
  });
}

assert.notStrictEqual(verify('preview', productionUrl, 'sb_publishable_preview').status, 0, 'Preview must reject the production project');
assert.notStrictEqual(verify('preview', stagingUrl, '').status, 0, 'Preview must require its staging public key');
assert.strictEqual(verify('preview', stagingUrl, 'sb_publishable_preview').status, 0, 'Preview should accept an isolated staging project');
assert.notStrictEqual(verify('production', stagingUrl, 'sb_publishable_preview').status, 0, 'Production must reject the staging project');
assert.strictEqual(verify('production', productionUrl, '').status, 0, 'Production should accept the approved project while the legacy public-key fallback remains');

const runtimeHandler = require('../api/runtime-config.js');

function invokeRuntimeConfig(environment, url, anonKey, serviceKey) {
  const previous = {
    VERCEL_ENV: process.env.VERCEL_ENV,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY
  };
  Object.assign(process.env, {
    VERCEL_ENV: environment,
    SUPABASE_URL: url,
    SUPABASE_ANON_KEY: anonKey || '',
    SUPABASE_SERVICE_KEY: serviceKey || ''
  });
  const result = { headers: {}, statusCode: 0, body: '' };
  const res = {
    setHeader(name, value) { result.headers[name] = value; },
    status(code) { result.statusCode = code; return this; },
    end(body) { result.body = String(body || ''); return result; }
  };
  runtimeHandler({ method: 'GET' }, res);
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  return result;
}

const blocked = invokeRuntimeConfig('preview', productionUrl, 'sb_publishable_preview', 'DO_NOT_EXPOSE_SERVICE');
assert.match(blocked.body, /production data project is blocked/i);
assert.doesNotMatch(blocked.body, /DO_NOT_EXPOSE_SERVICE/, 'runtime configuration must never expose the service key');

const allowed = invokeRuntimeConfig('preview', stagingUrl, 'sb_publishable_preview', 'DO_NOT_EXPOSE_SERVICE');
assert.match(allowed.body, /stagingprojectref123/);
assert.match(allowed.body, /sb_publishable_preview/);
assert.doesNotMatch(allowed.body, /DO_NOT_EXPOSE_SERVICE/, 'runtime configuration must expose only the public key');

const index = require('fs').readFileSync(path.join(root, 'index.html'), 'utf8');
const core = require('fs').readFileSync(path.join(root, 'auris-core.js'), 'utf8');
const vercel = JSON.parse(require('fs').readFileSync(path.join(root, 'vercel.json'), 'utf8'));
assert(index.indexOf('/api/runtime-config') < index.indexOf('auris-core.js'), 'runtime configuration must load before the application core');
assert.match(core, /window\.__AURIS_RUNTIME_CONFIG__/);
assert.match(core, /AURIS_RUNTIME_CONFIG_READY/);
assert.match(core, /AURIS_IS_APPROVED_PRODUCTION_RUNTIME/);
assert.match(core, /aurisRequireRuntimeConfiguration\(\)/);
assert.match(core, /apiBaseUrl\.textContent=SB\+'\/rest\/v1'/, 'the Integrations display must reflect the active environment');
assert.strictEqual(vercel.buildCommand, 'npm run vercel-build', 'Vercel must enforce the deployment boundary before publishing a build');

console.log('Deployment environment isolation contract passed.');
