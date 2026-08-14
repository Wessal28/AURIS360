const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const corePath = path.join(root, 'auris-core.js');
const registryPath = path.join(root, 'auris-runtime-event-handlers.js');
const source = fs.readFileSync(corePath, 'utf8');
const attributePattern = /\s(on[a-z]+)=(?:"([^"]*)"|'([^']*)')/gi;
const handlers = new Map();
const skipped = [];
let migratedCount = 0;

function isEscaped(value, index) {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && value[i] === '\\'; i -= 1) slashes += 1;
  return slashes % 2 === 1;
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
      if (body[plus] === '+') {
        start = i;
        expressionStart = plus + 1;
        break;
      }
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
      if ((char === "'" || char === '"' || char === '`') && !isEscaped(body, i)) {
        quote = char;
        continue;
      }
      if (char === '(' || char === '[' || char === '{') depth += 1;
      else if (char === ')' || char === ']' || char === '}') depth -= 1;
      else if (char === '+' && depth === 0) {
        let next = i + 1;
        while (/\s/.test(body[next] || '')) next += 1;
        if (body[next] === "'" && !isEscaped(body, next)) {
          end = i;
          continuationStart = next + 1;
          break;
        }
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

function unwrapEscaper(expression) {
  let value = expression.trim();
  let match = value.match(/^(?:escH|escH2|dashJs)\(([\s\S]*)\)$/);
  while (match) {
    value = match[1].trim();
    match = value.match(/^(?:escH|escH2|dashJs)\(([\s\S]*)\)$/);
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
    } else if ((char === "'" || char === '"' || char === '`') && !isEscaped(value, i)) {
      quote = char;
    }
  }
  return quote === null;
}

function compileTemplate(parts) {
  let template = '';
  parts.chunks.forEach((chunk, index) => {
    template += chunk;
    if (index < parts.expressions.length) template += `__AURIS_ARG_${index}__`;
  });
  template = decodeBody(template);
  for (let index = 0; index < parts.expressions.length; index += 1) {
    const marker = `__AURIS_ARG_${index}__`;
    const quotedSingle = `'${marker}'`;
    const quotedDouble = `"${marker}"`;
    if (template.includes(quotedSingle)) template = template.replace(quotedSingle, `args[${index}]`);
    else if (template.includes(quotedDouble)) template = template.replace(quotedDouble, `args[${index}]`);
    else if (markerOutsideString(template, marker)) template = template.replace(marker, `args[${index}]`);
    else return null;
  }
  if (/^\s*args\[\d+\]\s*;?\s*$/.test(template)) return null;
  try {
    // Build-time syntax validation only. The shipped application never evaluates handler strings.
    new Function('event', 'args', template);
  } catch {
    return null;
  }
  return template;
}

const migrated = source.replace(attributePattern, (match, eventAttribute, doubleQuoted, singleQuoted, offset) => {
  const rawBody = doubleQuoted ?? singleQuoted ?? '';
  if (!rawBody.includes('+')) return match;
  const parts = splitDynamicBody(rawBody);
  const compiledBody = parts && compileTemplate(parts);
  if (!parts || !compiledBody) {
    skipped.push({ offset, eventAttribute, rawBody });
    return match;
  }
  const eventType = eventAttribute.slice(2).toLowerCase();
  const signature = `${eventType}\u0000${compiledBody}`;
  if (!handlers.has(signature)) handlers.set(signature, `r${String(handlers.size + 1).padStart(4, '0')}`);
  const expressions = parts.expressions.map(unwrapEscaper);
  migratedCount += 1;
  return ` data-auris-runtime-on${eventType}="${handlers.get(signature)}" data-auris-runtime-args="'+encodeURIComponent(JSON.stringify([${expressions.join(',')}]))+'"`;
});

if (migratedCount === 0) {
  throw new Error('No supported runtime-argument event attributes found; refusing to overwrite the registry.');
}

const entries = [...handlers.entries()].map(([signature, id]) => {
  const separator = signature.indexOf('\u0000');
  const body = signature.slice(separator + 1);
  return `    ${JSON.stringify(id)}: function (event, args) {\n${body}\n    }`;
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
    var handlerAttribute = 'data-auris-runtime-on' + eventType;
    while (node && node.nodeType === 1) {
      var handlerId = node.getAttribute(handlerAttribute);
      if (handlerId && handlers[handlerId]) {
        var encodedArgs = node.getAttribute('data-auris-runtime-args') || '%5B%5D';
        var args = JSON.parse(decodeURIComponent(encodedArgs));
        var result = handlers[handlerId].call(node, event, args);
        if (result === false) event.preventDefault();
      }
      if (event.cancelBubble) break;
      node = node.parentElement;
    }
  }

  eventTypes.forEach(function (eventType) {
    document.addEventListener(eventType, function (event) {
      dispatch(eventType, event);
    });
  });
})();
`;

fs.writeFileSync(corePath, migrated);
fs.writeFileSync(registryPath, registry);
console.log(`Migrated ${migratedCount} runtime-argument attributes into ${handlers.size} precompiled handlers.`);
console.log(`Skipped ${skipped.length} unsupported dynamic-code attributes.`);
for (const item of skipped) console.log(`SKIP ${item.eventAttribute}: ${item.rawBody}`);
