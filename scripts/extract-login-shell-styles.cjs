const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');
const cssPath = path.join(root, 'auris-login-shell.css');
const index = fs.readFileSync(indexPath, 'utf8');
const start = index.indexOf('<div id="login-screen"');
const end = index.indexOf('<div id="app"', start);

if (start < 0 || end < 0) {
  throw new Error('Could not locate the bounded login shell in index.html.');
}

const styles = new Map();
const sourceLoginShell = index.slice(start, end);
const extractedCount = (sourceLoginShell.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length;

if (extractedCount === 0) {
  if (!index.includes('href="auris-login-shell.css') || !fs.existsSync(cssPath)) {
    throw new Error('Login styles are absent, but the extracted stylesheet is not installed.');
  }
  console.log('Login-shell styles are already externalized.');
  process.exit(0);
}

const loginShell = sourceLoginShell.replace(/<[A-Za-z][^<>]*>/g, (tag) => {
  const styleMatch = tag.match(/\sstyle=("([^"]*)"|'([^']*)')/i);
  if (!styleMatch) return tag;

  const declaration = styleMatch[2] ?? styleMatch[3] ?? '';
  const className = `auris-login-s-${crypto.createHash('sha256').update(declaration).digest('hex').slice(0, 10)}`;
  styles.set(className, declaration);

  let migrated = tag.replace(styleMatch[0], '');
  const classMatch = migrated.match(/\sclass=("([^"]*)"|'([^']*)')/i);
  if (classMatch) {
    const quote = classMatch[1][0];
    const existing = classMatch[2] ?? classMatch[3] ?? '';
    migrated = migrated.replace(classMatch[0], ` class=${quote}${existing} ${className}${quote}`);
  } else {
    migrated = migrated.replace(/^<([A-Za-z][\w:-]*)/, `<$1 class="${className}"`);
  }
  return migrated;
});

const css = [
  '/* Generated from the static login shell by scripts/extract-login-shell-styles.cjs. */',
  '/* Keep declarations literal so interactive element.style updates can still override them. */',
  ...[...styles.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, declaration]) => `.${name}{${declaration}}`),
  ''
].join('\n');

let nextIndex = index.slice(0, start) + loginShell + index.slice(end);
if (!nextIndex.includes('href="auris-login-shell.css"')) {
  nextIndex = nextIndex.replace(
    '<link rel="stylesheet" href="tools-equipment-upgrade.css?v=20260805-1">',
    '<link rel="stylesheet" href="tools-equipment-upgrade.css?v=20260805-1">\n<link rel="stylesheet" href="auris-login-shell.css?v=20260814-1">'
  );
}

fs.writeFileSync(indexPath, nextIndex);
fs.writeFileSync(cssPath, css);
console.log(`Extracted ${extractedCount} login-shell style attributes into ${styles.size} reusable rules.`);
