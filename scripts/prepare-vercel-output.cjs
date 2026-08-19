const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outputRoot = path.join(root, 'public');
const manifestPath = path.join(root, 'sw-assets.js');
const alwaysPublished = ['sw.js', 'sw-assets.js', 'legal_register_import_template.csv'];

function deploymentAssets() {
  const source = fs.readFileSync(manifestPath, 'utf8');
  const match = source.match(/self\.AURIS_SW_ASSET_MANIFEST\s*=\s*(\{[\s\S]*\})\s*;/);
  if (!match) throw new Error('Unable to parse the generated offline asset manifest.');
  const manifest = JSON.parse(match[1]);
  return [...new Set([
    ...(manifest.assets || []).filter((asset) => asset !== '/').map((asset) => asset.replace(/^\//, '')),
    ...alwaysPublished
  ])].sort();
}

function safeSource(relativePath) {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes('..')) {
    throw new Error(`Unsafe deployment asset path: ${relativePath}`);
  }
  const absolutePath = path.resolve(root, relativePath);
  if (!absolutePath.startsWith(root + path.sep)) throw new Error(`Deployment asset escapes repository root: ${relativePath}`);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw new Error(`Missing deployment asset: ${relativePath}`);
  }
  return absolutePath;
}

const assets = deploymentAssets();
fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

for (const relativePath of assets) {
  const source = safeSource(relativePath);
  const destination = path.join(outputRoot, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

const forbiddenExtensions = new Set(['.sql', '.md', '.cjs', '.ps1', '.yaml', '.yml']);
const forbidden = assets.filter((relativePath) => forbiddenExtensions.has(path.extname(relativePath).toLowerCase()));
if (forbidden.length) {
  fs.rmSync(outputRoot, { recursive: true, force: true });
  throw new Error(`Forbidden repository files entered the deployment bundle: ${forbidden.join(', ')}`);
}

console.log(`Prepared public deployment bundle with ${assets.length} allowlisted files.`);
