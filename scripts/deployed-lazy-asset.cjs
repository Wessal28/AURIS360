function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function literalList(source) {
  const values = [];
  const remainder = source.replace(/(['"])([^'"\\]*)\1/g, (_match, _quote, value) => { values.push(value); return ''; });
  if (!/^[\s,]*$/.test(remainder)) throw Error('Lazy deployment declaration must contain only literal asset names.');
  return values;
}

// Parse only reviewed literal declarations. Never execute fetched application
// JavaScript in the release verifier or expose credentials to deployed code.
function deployedLazyAssetUrl({ registrySource, extractionSource, base, moduleKey, fileName, requiredVersion }) {
  const label = `${fileName} lazy deployment`;
  if (!/^[a-z0-9][a-z0-9-]*\.js$/i.test(fileName) || !/^[a-z0-9-]+$/i.test(moduleKey)) throw Error(`${label} has an invalid identity.`);
  if (!/^[a-z0-9-]+$/i.test(requiredVersion || '')) throw Error(`${label} requires an explicit release version.`);
  for (const source of [registrySource, extractionSource]) {
    if (typeof source !== 'string' || source.length < 100 || source.length > 1024 * 1024) throw Error(`${label} is missing its deployed registry or extraction source.`);
  }
  const module = registrySource.match(new RegExp(`^\\s*${escapeRegExp(moduleKey)}:\\s*\\{([^{}]*)\\}`, 'm'));
  const declared = module && module[1].match(/\bassets:\s*\[([^\]]*)\]/);
  const assets = declared ? literalList(declared[1]) : [];
  const additions = new RegExp(`extractionMap\\.${escapeRegExp(moduleKey)}\\.assets\\.push\\(([^()]*)\\)`, 'g');
  for (const addition of registrySource.matchAll(additions)) assets.push(...literalList(addition[1]));
  if (!declared || assets.filter(asset => asset === fileName).length !== 1) throw Error(`${fileName} is not declared exactly once by ${moduleKey} extraction.`);
  const version = extractionSource.match(/script\.src\s*=\s*asset\s*\+\s*(['"])\?v=([a-z0-9][a-z0-9.-]*)\1/i);
  if (!version) throw Error(`${label} is missing its extraction URL version.`);
  const direct = new RegExp(`if\\(asset===['"]${escapeRegExp(fileName)}['"]\\)script\\.src\\+=['"]&${escapeRegExp(requiredVersion)}['"]`).test(extractionSource);
  const grouped = Array.from(extractionSource.matchAll(/if\(\[([^\]]*)\]\.includes\(asset\)\)script\.src\+=['"]&([a-z0-9-]+)['"]/gi)).some(match => match[2] === requiredVersion && literalList(match[1]).includes(fileName));
  if (!direct && !grouped) throw Error(`${label} is missing its ${requiredVersion} release version.`);
  const origin = new URL(base);
  const asset = new URL('/' + fileName, origin);
  asset.search = `?v=${version[2]}&${requiredVersion}`;
  if (asset.origin !== origin.origin || asset.pathname !== '/' + fileName || asset.username || asset.password || asset.hash) throw Error(`${label} must use its deployment origin and exact asset path.`);
  return asset.href;
}

module.exports = { deployedLazyAssetUrl };
