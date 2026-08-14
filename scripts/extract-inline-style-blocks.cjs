const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');
const outputs = [
  'auris-base.css',
  'auris-meeting-tabs.css',
  'auris-document-control.css',
  'auris-brand-drop.css',
  'auris-mobile-final-polish.css',
  'auris-premium-3d-sidebar.css'
];

let html = fs.readFileSync(indexPath, 'utf8');
const blocks = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)];

if (!blocks.length) {
  for (const output of outputs) {
    if (!fs.existsSync(path.join(root, output))) throw new Error(`Missing extracted stylesheet: ${output}`);
  }
  console.log('Inline style blocks are already extracted.');
  process.exit(0);
}
if (blocks.length !== outputs.length) throw new Error(`Expected ${outputs.length} inline style blocks, found ${blocks.length}`);

let cursor = 0;
let migrated = '';
blocks.forEach((block, index) => {
  migrated += html.slice(cursor, block.index);
  migrated += `<link rel="stylesheet" href="${outputs[index]}"/>`;
  cursor = block.index + block[0].length;
  fs.writeFileSync(path.join(root, outputs[index]), block[1].replace(/^\s*\r?\n/, '').replace(/\s*$/, '') + '\n', 'utf8');
});
migrated += html.slice(cursor);
fs.writeFileSync(indexPath, migrated, 'utf8');
console.log(`Extracted ${blocks.length} inline style blocks into ordered stylesheets.`);
