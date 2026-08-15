const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');
const cssPath = path.join(root, 'auris-approval-center-static.css');
const index = fs.readFileSync(indexPath, 'utf8');
const start = index.indexOf('<div id="page-approvals"');
const end = index.indexOf('<div id="page-audit"', start);
if (start < 0 || end < 0) throw new Error('Could not locate the bounded Approval Center page.');

const source = index.slice(start, end);
const extractedCount = (source.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length;

function renderCss(styles) {
  return [
    '/* Generated from Approval Center by scripts/extract-approval-center-styles.cjs. */',
    '/* Non-important declarations preserve queue, workflow, evidence, decision and exact-record runtime states. */',
    ...[...styles.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `.${name}{${value}}`),
    ''
  ].join('\n');
}

if (extractedCount === 0) {
  if (!index.includes('href="auris-approval-center-static.css') || !fs.existsSync(cssPath)) throw new Error('Approval Center stylesheet is not installed.');
  const installedStyles = new Map();
  for (const match of fs.readFileSync(cssPath, 'utf8').matchAll(/^\.(auris-approval-center-s-[a-f0-9]{10})\{([^}]*)\}$/gm)) installedStyles.set(match[1], match[2]);
  if (!installedStyles.size) throw new Error('The Approval Center stylesheet has no generated rules.');
  fs.writeFileSync(cssPath, renderCss(installedStyles));
  console.log('Approval Center styles are already externalized.');
  process.exit(0);
}

const styles = new Map();
if (fs.existsSync(cssPath)) {
  for (const match of fs.readFileSync(cssPath, 'utf8').matchAll(/^\.(auris-approval-center-s-[a-f0-9]{10})\{([^}]*)\}$/gm)) styles.set(match[1], match[2]);
}
const migrated = source.replace(/<[A-Za-z][^<>]*>/g, (tag) => {
  let result = tag;
  const generatedClasses = [];
  let styleMatch;
  while ((styleMatch = result.match(/\sstyle=("([^"]*)"|'([^']*)')/i))) {
    const declaration = styleMatch[2] ?? styleMatch[3] ?? '';
    const className = `auris-approval-center-s-${crypto.createHash('sha256').update(declaration).digest('hex').slice(0, 10)}`;
    styles.set(className, declaration);
    generatedClasses.push(className);
    result = result.replace(styleMatch[0], '');
  }
  if (!generatedClasses.length) return tag;
  const classNames = [...new Set(generatedClasses)].join(' ');
  const classMatch = result.match(/\sclass=("([^"]*)"|'([^']*)')/i);
  if (classMatch) {
    const quote = classMatch[1][0];
    const existing = classMatch[2] ?? classMatch[3] ?? '';
    result = result.replace(classMatch[0], ` class=${quote}${existing} ${classNames}${quote}`);
  } else {
    const idMatch = result.match(/\sid=("[^"]*"|'[^']*')/i);
    if (idMatch) result = result.replace(idMatch[0], `${idMatch[0]} class="${classNames}"`);
    else result = result.replace(/^<([A-Za-z][\w:-]*)/, `<$1 class="${classNames}"`);
  }
  return result;
});

let nextIndex = index.slice(0, start) + migrated + index.slice(end);
if (!nextIndex.includes('href="auris-approval-center-static.css')) {
  nextIndex = nextIndex.replace(
    '<link rel="stylesheet" href="auris-ai-insights-static.css?v=20260815-1">',
    '<link rel="stylesheet" href="auris-ai-insights-static.css?v=20260815-1">\n<link rel="stylesheet" href="auris-approval-center-static.css?v=20260815-1">'
  );
}
fs.writeFileSync(indexPath, nextIndex);
fs.writeFileSync(cssPath, renderCss(styles));
console.log(`Extracted ${extractedCount} Approval Center style attributes into ${styles.size} reusable rules.`);
