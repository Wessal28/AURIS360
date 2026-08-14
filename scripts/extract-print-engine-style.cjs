const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'auris-core.js'), 'utf8');
const match = /function aurisPrintCSS\(\)\s*\{[\s\S]*?return `([\s\S]*?)`;\s*\}/.exec(source);
if (!match) throw new Error('aurisPrintCSS template was not found');

const css = match[1]
  .replace(/\$\{P\}/g, 'var(--auris-print-primary)')
  .replace(/\$\{S\}/g, 'var(--auris-print-secondary)')
  .replace(/\$\{A\}/g, 'var(--auris-print-accent)')
  .replace(/^\s*\r?\n/, '')
  .replace(/\s*$/, '') + `

body.auris-print-landscape { width: 297mm; min-height: 210mm; }
body.auris-print-landscape .report-page { width: 297mm; max-width: none !important; min-height: 210mm; padding: 8mm; }
body.auris-print-landscape table { font-size: 7.2pt; }
body.auris-print-landscape th,
body.auris-print-landscape td { padding: 3px 4px; }
body.auris-print-landscape .rpt-section { break-inside: avoid; }
body.auris-print-landscape .fire-print-table th,
body.auris-print-landscape .fire-print-table td { vertical-align: top; }
body.auris-print-landscape .fire-print-table td { white-space: normal; overflow: visible; height: auto; }
@page { size: A4; margin: 10mm; }
body.auris-print-landscape { page: auris-landscape; }
@page auris-landscape { size: A4 landscape; margin: 8mm; }
`;

fs.writeFileSync(path.join(root, 'auris-print.css'), css, 'utf8');
console.log('Generated auris-print.css from the legacy print engine template.');
