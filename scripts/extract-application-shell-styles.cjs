const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');
const cssPath = path.join(root, 'auris-application-shell.css');
const index = fs.readFileSync(indexPath, 'utf8');
const start = index.indexOf('<div id="app"');
const end = index.indexOf('<!-- DASHBOARD (Real-time HSE)', start);

if (start < 0 || end < 0) {
  throw new Error('Could not locate the bounded authenticated application shell.');
}

const sourceShell = index.slice(start, end);
const extractedCount = (sourceShell.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length;

function renderCss(shell, styles) {
  const idRules = [];
  for (const tag of shell.match(/<[A-Za-z][^<>]*>/g) || []) {
    const id = tag.match(/\sid="([A-Za-z][\w:-]*)"/i)?.[1];
    const classes = tag.match(/\sclass="([^"]*)"/i)?.[1]?.split(/\s+/) || [];
    const generatedClass = classes.find((name) => styles.has(name));
    if (id && generatedClass) idRules.push(`#${id}.${generatedClass}{${styles.get(generatedClass)}}`);
  }
  return [
    '/* Generated from the authenticated application chrome by scripts/extract-application-shell-styles.cjs. */',
    '/* Declarations remain non-important so runtime visibility and state updates retain precedence. */',
    ...[...styles.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, declaration]) => `.${name}{${declaration}}`),
    '/* ID-bearing controls retain the specificity of their former inline state over base ID selectors. */',
    ...[...new Set(idRules)].sort(),
    ''
  ].join('\n');
}

if (extractedCount === 0) {
  if (!index.includes('href="auris-application-shell.css') || !fs.existsSync(cssPath)) {
    throw new Error('Application-shell styles are absent, but the extracted stylesheet is not installed.');
  }
  const installedCss = fs.readFileSync(cssPath, 'utf8');
  const installedStyles = new Map();
  for (const match of installedCss.matchAll(/^\.(auris-shell-s-[a-f0-9]{10})\{([^}]*)\}$/gm)) {
    installedStyles.set(match[1], match[2]);
  }
  if (!installedStyles.size) throw new Error('The installed application-shell stylesheet has no generated rules.');
  fs.writeFileSync(cssPath, renderCss(sourceShell, installedStyles));
  console.log('Application-shell styles are already externalized; specificity rules refreshed.');
  process.exit(0);
}

const styles = new Map();
const migratedShell = sourceShell.replace(/<[A-Za-z][^<>]*>/g, (tag) => {
  const styleMatch = tag.match(/\sstyle=("([^"]*)"|'([^']*)')/i);
  if (!styleMatch) return tag;

  const declaration = styleMatch[2] ?? styleMatch[3] ?? '';
  const className = `auris-shell-s-${crypto.createHash('sha256').update(declaration).digest('hex').slice(0, 10)}`;
  styles.set(className, declaration);

  let migrated = tag.replace(styleMatch[0], '');
  const classMatch = migrated.match(/\sclass=("([^"]*)"|'([^']*)')/i);
  if (classMatch) {
    const quote = classMatch[1][0];
    const existing = classMatch[2] ?? classMatch[3] ?? '';
    migrated = migrated.replace(classMatch[0], ` class=${quote}${existing} ${className}${quote}`);
  } else {
    const idMatch = migrated.match(/\sid=("[^"]*"|'[^']*')/i);
    if (idMatch) {
      migrated = migrated.replace(idMatch[0], `${idMatch[0]} class="${className}"`);
    } else {
      migrated = migrated.replace(/^<([A-Za-z][\w:-]*)/, `<$1 class="${className}"`);
    }
  }
  return migrated;
});

const css = renderCss(migratedShell, styles);

let nextIndex = index.slice(0, start) + migratedShell + index.slice(end);
if (!nextIndex.includes('href="auris-application-shell.css"')) {
  nextIndex = nextIndex.replace(
    '<link rel="stylesheet" href="auris-login-shell.css?v=20260814-1">',
    '<link rel="stylesheet" href="auris-login-shell.css?v=20260814-1">\n<link rel="stylesheet" href="auris-application-shell.css?v=20260814-1">'
  );
}

fs.writeFileSync(indexPath, nextIndex);
fs.writeFileSync(cssPath, css);
console.log(`Extracted ${extractedCount} application-shell style attributes into ${styles.size} reusable rules.`);
