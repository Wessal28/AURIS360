const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const corePath = path.join(root, 'auris-core.js');
const outputs = [
  'auris-print-qr.css',
  'auris-print-noise-survey.css',
  'auris-print-sop-editor.css',
  'auris-print-sop-saved.css',
  'auris-print-swms.css',
  'auris-print-incident.css',
  'auris-print-legal-register.css',
  'auris-print-legal-change.css',
  'auris-print-toolbox-talk.css',
  'auris-print-risk-assessment.css',
  'auris-print-fire-layout.css',
  'auris-print-site-map.css'
];

let source = fs.readFileSync(corePath, 'utf8');
const blocks = [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)];
if (!blocks.length) {
  for (const output of outputs) {
    if (!fs.existsSync(path.join(root, output))) throw new Error(`Missing extracted print stylesheet: ${output}`);
  }
  console.log('Specialised print styles are already extracted.');
  process.exit(0);
}
if (blocks.length !== outputs.length) throw new Error(`Expected ${outputs.length} print style blocks, found ${blocks.length}`);

let cursor = 0;
let migrated = '';
blocks.forEach((block, index) => {
  migrated += source.slice(cursor, block.index);
  migrated += `<link rel="stylesheet" href="/${outputs[index]}">`;
  cursor = block.index + block[0].length;
  fs.writeFileSync(path.join(root, outputs[index]), block[1].trim() + '\n', 'utf8');
});
migrated += source.slice(cursor);
fs.writeFileSync(corePath, migrated, 'utf8');
console.log(`Extracted ${blocks.length} specialised print stylesheets.`);
