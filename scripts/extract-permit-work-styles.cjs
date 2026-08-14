const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');
const cssPath = path.join(root, 'auris-permit-work-static.css');
const index = fs.readFileSync(indexPath, 'utf8');
const start = index.indexOf('<div id="page-permit"');
const end = index.indexOf('<div id="page-contractor"', start);
if (start < 0 || end < 0) throw new Error('Could not locate the bounded Permit to Work page.');

const source = index.slice(start, end);
const extractedCount = (source.match(/\sstyle=(?:"[^"]*"|'[^']*')/gi) || []).length;

function renderCss(section, styles) {
  const idRules = [];
  for (const tag of section.match(/<[A-Za-z][^<>]*>/g) || []) {
    const id = tag.match(/\sid="([A-Za-z][\w:-]*)"/i)?.[1];
    const classes = tag.match(/\sclass="([^"]*)"/i)?.[1]?.split(/\s+/) || [];
    for (const generatedClass of classes.filter((name) => styles.has(name))) {
      if (id) idRules.push(`#${id}.${generatedClass}{${styles.get(generatedClass)}}`);
    }
  }
  return [
    '/* Generated from Permit to Work by scripts/extract-permit-work-styles.cjs. */',
    '/* Non-important declarations preserve permit, isolation, approval and close-out runtime state. */',
    ...[...styles.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `.${name}{${value}}`),
    '/* Preserve former inline precedence over existing ID selectors. */',
    ...[...new Set(idRules)].sort(),
    ''
  ].join('\n');
}

if (extractedCount === 0) {
  if (!index.includes('href="auris-permit-work-static.css') || !fs.existsSync(cssPath)) throw new Error('Permit to Work stylesheet is not installed.');
  const installedStyles = new Map();
  for (const match of fs.readFileSync(cssPath, 'utf8').matchAll(/^\.(auris-ptw-s-[a-f0-9]{10})\{([^}]*)\}$/gm)) installedStyles.set(match[1], match[2]);
  if (!installedStyles.size) throw new Error('The Permit to Work stylesheet has no generated rules.');
  fs.writeFileSync(cssPath, renderCss(source, installedStyles));
  console.log('Permit to Work styles are already externalized; specificity rules refreshed.');
  process.exit(0);
}

const styles = new Map();
if (fs.existsSync(cssPath)) {
  for (const match of fs.readFileSync(cssPath, 'utf8').matchAll(/^\.(auris-ptw-s-[a-f0-9]{10})\{([^}]*)\}$/gm)) styles.set(match[1], match[2]);
}
const migrated = source.replace(/<[A-Za-z][^<>]*>/g, (tag) => {
  let result = tag;
  const generatedClasses = [];
  let styleMatch;
  while ((styleMatch = result.match(/\sstyle=("([^"]*)"|'([^']*)')/i))) {
    const declaration = styleMatch[2] ?? styleMatch[3] ?? '';
    const className = `auris-ptw-s-${crypto.createHash('sha256').update(declaration).digest('hex').slice(0, 10)}`;
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
if (!nextIndex.includes('href="auris-permit-work-static.css')) {
  nextIndex = nextIndex.replace(
    '<link rel="stylesheet" href="auris-tools-equipment-static.css?v=20260814-1">',
    '<link rel="stylesheet" href="auris-tools-equipment-static.css?v=20260814-1">\n<link rel="stylesheet" href="auris-permit-work-static.css?v=20260814-1">'
  );
}
fs.writeFileSync(indexPath, nextIndex);
fs.writeFileSync(cssPath, renderCss(migrated, styles));
console.log(`Extracted ${extractedCount} Permit to Work style attributes into ${styles.size} reusable rules.`);
