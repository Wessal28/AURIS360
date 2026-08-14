const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
if (scripts.length) throw new Error(`Expected no inline application scripts, found ${scripts.length}`);
const externalAssets = [
  'auris-static-event-handlers.js',
  'auris-generated-event-handlers.js',
  'auris-runtime-event-handlers.js',
  'auris-module-event-handlers-batch-1.js',
  'auris-core.js',
  'auris-detached-modules.js'
];
for (const asset of externalAssets) {
  if (!new RegExp(`<script\\b[^>]*\\bsrc=["']${asset.replace('.', '\\.')}(?:\\?[^"']*)?["']`, 'i').test(html)) {
    throw new Error(`Missing external application script: ${asset}`);
  }
  try {
    new Function(fs.readFileSync(asset, 'utf8'));
  } catch (error) {
    throw new Error(`${asset} failed syntax validation: ${error.message}`);
  }
}
if (/<scr['"]?\s*\+\s*['"]?ipt/i.test(fs.readFileSync('auris-core.js', 'utf8'))) {
  throw new Error('Generated inline script markup remains in auris-core.js');
}
console.log('External application scripts passed syntax validation; inline script blocks: 0.');
