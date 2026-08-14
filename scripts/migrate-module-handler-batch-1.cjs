const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const batchNumber = Number((process.argv.find((value) => value.startsWith('--batch=')) || '--batch=1').split('=')[1]);
const batches = {
  1: {
    prefix: 'b',
    files: ['kpi-configuration.js','noise-management.js','incident-management-upgrade.js','legal-compliance-upgrade.js','sop-video-upgrade.js','elearning-course-path.js','resilience-fault-simulation.js','offline-sync-diagnostic.js','rollback-rehearsal.js','notification-centre.js']
  },
  2: {
    prefix: 'c',
    files: ['document-control-upgrade.js','risk-assessment-upgrade.js','chemical-control-upgrade.js']
  },
  3: {
    prefix: 'd',
    files: ['kpi-module-upgrade.js','swms-upgrade.js','contractor-management-upgrade.js','tools-equipment-upgrade.js']
  }
};
const batch = batches[batchNumber];
if (!batch) throw new Error(`Unknown module handler batch: ${batchNumber}`);
const files = batch.files;
const registryPath = path.join(root, `auris-module-event-handlers-batch-${batchNumber}.js`);
const attributePattern = /\s(on[a-z]+)=(?:"([^"]*)"|'([^']*)')/gi;
const handlers = new Map();
const skipped = [];
let migratedCount = 0;

function isEscaped(value, index) {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && value[i] === '\\'; i -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function decodeBody(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"');
}

function splitDynamicBody(body) {
  const chunks = [];
  const expressions = [];
  let cursor = 0;
  while (cursor < body.length) {
    let start = -1;
    let expressionStart = -1;
    for (let i = cursor; i < body.length; i += 1) {
      if (body[i] !== "'" || isEscaped(body, i)) continue;
      let plus = i + 1;
      while (/\s/.test(body[plus] || '')) plus += 1;
      if (body[plus] === '+') { start = i; expressionStart = plus + 1; break; }
    }
    if (start < 0) break;
    let quote = null;
    let depth = 0;
    let end = -1;
    let continuationStart = -1;
    for (let i = expressionStart; i < body.length; i += 1) {
      const char = body[i];
      if (quote) {
        if (char === quote && !isEscaped(body, i)) quote = null;
        continue;
      }
      if ((char === "'" || char === '"' || char === '`') && !isEscaped(body, i)) { quote = char; continue; }
      if (char === '(' || char === '[' || char === '{') depth += 1;
      else if (char === ')' || char === ']' || char === '}') depth -= 1;
      else if (char === '+' && depth === 0) {
        let next = i + 1;
        while (/\s/.test(body[next] || '')) next += 1;
        if (body[next] === "'" && !isEscaped(body, next)) { end = i; continuationStart = next + 1; break; }
      }
    }
    if (end < 0) return null;
    chunks.push(body.slice(cursor, start));
    expressions.push(body.slice(expressionStart, end).trim());
    cursor = continuationStart;
  }
  if (expressions.length === 0) return null;
  chunks.push(body.slice(cursor));
  return { chunks, expressions };
}

function unwrapEscaper(expression) {
  let value = expression.trim();
  let match = value.match(/^(?:escH|escH2|h|esc|noiseH|imH|legalH|sopH|elcH|notifH)\(([\s\S]*)\)$/);
  while (match) {
    value = match[1].trim();
    match = value.match(/^(?:escH|escH2|h|esc|noiseH|imH|legalH|sopH|elcH|notifH)\(([\s\S]*)\)$/);
  }
  return value;
}

function markerOutsideString(value, marker) {
  const markerIndex = value.indexOf(marker);
  let quote = null;
  for (let i = 0; i < markerIndex; i += 1) {
    const char = value[i];
    if (quote) {
      if (char === quote && !isEscaped(value, i)) quote = null;
    } else if ((char === "'" || char === '"' || char === '`') && !isEscaped(value, i)) quote = char;
  }
  return quote === null;
}

function compileDynamic(parts) {
  let template = '';
  parts.chunks.forEach((chunk, index) => {
    template += chunk;
    if (index < parts.expressions.length) template += `__AURIS_ARG_${index}__`;
  });
  template = decodeBody(template);
  for (let index = 0; index < parts.expressions.length; index += 1) {
    const marker = `__AURIS_ARG_${index}__`;
    if (template.includes(`'${marker}'`)) template = template.replace(`'${marker}'`, `args[${index}]`);
    else if (template.includes(`"${marker}"`)) template = template.replace(`"${marker}"`, `args[${index}]`);
    else if (markerOutsideString(template, marker)) template = template.replace(marker, `args[${index}]`);
    else return null;
  }
  if (/^\s*args\[\d+\]\s*;?\s*$/.test(template)) return null;
  return template;
}

function syntaxValid(body) {
  try { new Function('event', 'args', body); return true; } catch { return false; }
}

for (const file of files) {
  const filePath = path.join(root, file);
  const source = fs.readFileSync(filePath, 'utf8');
  const migrated = source.replace(attributePattern, (match, eventAttribute, doubleQuoted, singleQuoted, offset) => {
    const rawBody = doubleQuoted ?? singleQuoted ?? '';
    const eventType = eventAttribute.slice(2).toLowerCase();
    let body;
    let expressions = [];
    if (rawBody.includes('+')) {
      const parts = splitDynamicBody(rawBody);
      body = parts && compileDynamic(parts);
      if (parts) expressions = parts.expressions.map(unwrapEscaper);
    } else body = decodeBody(rawBody);
    if (!body || !syntaxValid(body)) {
      skipped.push({ file, offset, eventAttribute, rawBody });
      return match;
    }
    const signature = `${eventType}\u0000${body}`;
    if (!handlers.has(signature)) handlers.set(signature, `${batch.prefix}${String(handlers.size + 1).padStart(4, '0')}`);
    migratedCount += 1;
    const args = expressions.length
      ? ` data-auris-module-args="'+encodeURIComponent(JSON.stringify([${expressions.join(',')}]))+'"`
      : '';
    return ` data-auris-module-on${eventType}="${handlers.get(signature)}"${args}`;
  });
  fs.writeFileSync(filePath, migrated);
}

if (migratedCount === 0) throw new Error('No supported module event attributes found; refusing to overwrite the registry.');

const entries = [...handlers.entries()].map(([signature, id]) => {
  const separator = signature.indexOf('\u0000');
  return `    ${JSON.stringify(id)}: function (event, args) {\n${signature.slice(separator + 1)}\n    }`;
});
const eventTypes = [...new Set([...handlers.keys()].map((signature) => signature.slice(0, signature.indexOf('\u0000'))))].sort();
const registry = `(function () {
  'use strict';
  var handlers = {
${entries.join(',\n')}
  };
  var eventTypes = ${JSON.stringify(eventTypes)};

  function dispatch(eventType, event) {
    var node = event.target && event.target.nodeType === 1 ? event.target : event.target && event.target.parentElement;
    var attribute = 'data-auris-module-on' + eventType;
    while (node && node.nodeType === 1) {
      var handlerId = node.getAttribute(attribute);
      if (handlerId && handlers[handlerId]) {
        var encodedArgs = node.getAttribute('data-auris-module-args') || '%5B%5D';
        var args = JSON.parse(decodeURIComponent(encodedArgs));
        var result = handlers[handlerId].call(node, event, args);
        if (result === false) event.preventDefault();
      }
      if (event.cancelBubble) break;
      node = node.parentElement;
    }
  }

  eventTypes.forEach(function (eventType) {
    document.addEventListener(eventType, function (event) { dispatch(eventType, event); }, eventType === 'error');
  });
})();
`;
fs.writeFileSync(registryPath, registry);
console.log(`Migrated ${migratedCount} module attributes into ${handlers.size} precompiled handlers.`);
console.log(`Skipped ${skipped.length} unsupported attributes.`);
for (const item of skipped) console.log(`SKIP ${item.file} ${item.eventAttribute}: ${item.rawBody}`);
