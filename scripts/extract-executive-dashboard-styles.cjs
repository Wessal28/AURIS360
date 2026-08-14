const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');
const cssPath = path.join(root, 'auris-dashboard-executive.css');
const index = fs.readFileSync(indexPath, 'utf8');
const start = index.indexOf('<div id="page-executive"');
const end = index.indexOf('</div><!-- end page-executive -->', start);
if (start < 0 || end < 0) throw new Error('Could not locate the bounded executive dashboard.');

const source = index.slice(start, end);
const extractedCount = (source.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length;

function renderCss(section, styles) {
  const idRules = [];
  for (const tag of section.match(/<[A-Za-z][^<>]*>/g) || []) {
    const id = tag.match(/\sid="([A-Za-z][\w:-]*)"/i)?.[1];
    const classes = tag.match(/\sclass="([^"]*)"/i)?.[1]?.split(/\s+/) || [];
    const generatedClass = classes.find((name) => styles.has(name));
    if (id && generatedClass) idRules.push(`#${id}.${generatedClass}{${styles.get(generatedClass)}}`);
  }
  return [
    '/* Generated from the Executive Management Dashboard by scripts/extract-executive-dashboard-styles.cjs. */',
    '/* Non-important declarations preserve tab, progress and hover updates. */',
    ...[...styles.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `.${name}{${value}}`),
    '/* Preserve former inline precedence over existing ID selectors. */',
    ...[...new Set(idRules)].sort(),
    ''
  ].join('\n');
}

if (extractedCount === 0) {
  if (!index.includes('href="auris-dashboard-executive.css') || !fs.existsSync(cssPath)) throw new Error('Executive dashboard stylesheet is not installed.');
  const installedStyles = new Map();
  for (const match of fs.readFileSync(cssPath, 'utf8').matchAll(/^\.(auris-exec-s-[a-f0-9]{10})\{([^}]*)\}$/gm)) installedStyles.set(match[1], match[2]);
  if (!installedStyles.size) throw new Error('The executive dashboard stylesheet has no generated rules.');
  fs.writeFileSync(cssPath, renderCss(source, installedStyles));
  console.log('Executive dashboard styles are already externalized; specificity rules refreshed.');
  process.exit(0);
}

const styles = new Map();
const migrated = source.replace(/<[A-Za-z][^<>]*>/g, (tag) => {
  const styleMatch = tag.match(/\sstyle=("([^"]*)"|'([^']*)')/i);
  if (!styleMatch) return tag;
  const declaration = styleMatch[2] ?? styleMatch[3] ?? '';
  const className = `auris-exec-s-${crypto.createHash('sha256').update(declaration).digest('hex').slice(0, 10)}`;
  styles.set(className, declaration);
  let result = tag.replace(styleMatch[0], '');
  const classMatch = result.match(/\sclass=("([^"]*)"|'([^']*)')/i);
  if (classMatch) {
    const quote = classMatch[1][0];
    const existing = classMatch[2] ?? classMatch[3] ?? '';
    result = result.replace(classMatch[0], ` class=${quote}${existing} ${className}${quote}`);
  } else {
    const idMatch = result.match(/\sid=("[^"]*"|'[^']*')/i);
    if (idMatch) result = result.replace(idMatch[0], `${idMatch[0]} class="${className}"`);
    else result = result.replace(/^<([A-Za-z][\w:-]*)/, `<$1 class="${className}"`);
  }
  return result;
});

let nextIndex = index.slice(0, start) + migrated + index.slice(end);
if (!nextIndex.includes('href="auris-dashboard-executive.css"')) {
  nextIndex = nextIndex.replace(
    '<link rel="stylesheet" href="auris-dashboard-org.css?v=20260814-1">',
    '<link rel="stylesheet" href="auris-dashboard-org.css?v=20260814-1">\n<link rel="stylesheet" href="auris-dashboard-executive.css?v=20260814-1">'
  );
}
fs.writeFileSync(indexPath, nextIndex);
fs.writeFileSync(cssPath, renderCss(migrated, styles));
console.log(`Extracted ${extractedCount} executive dashboard style attributes into ${styles.size} reusable rules.`);
