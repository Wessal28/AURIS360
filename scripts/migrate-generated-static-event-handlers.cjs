const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const corePath = path.join(root, 'auris-core.js');
const registryPath = path.join(root, 'auris-generated-event-handlers.js');
const source = fs.readFileSync(corePath, 'utf8');
const attributePattern = /\s(on[a-z]+)=(?:"([^"]*)"|'([^']*)')/gi;
const candidates = [...source.matchAll(attributePattern)].filter((match) => {
  const body = match[2] ?? match[3] ?? '';
  return !body.includes('+');
});

if (candidates.length === 0) {
  throw new Error('No generated static event attributes found. The migration has already been applied; refusing to overwrite the registry.');
}

const handlers = new Map();

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

const migrated = source.replace(attributePattern, (match, eventAttribute, doubleQuoted, singleQuoted) => {
  const rawBody = doubleQuoted ?? singleQuoted ?? '';
  if (rawBody.includes('+')) return match;
  const eventType = eventAttribute.slice(2).toLowerCase();
  const body = decodeBody(rawBody);
  const signature = `${eventType}\u0000${body}`;
  if (!handlers.has(signature)) handlers.set(signature, `g${String(handlers.size + 1).padStart(4, '0')}`);
  return ` data-auris-generated-on${eventType}="${handlers.get(signature)}"`;
});

const entries = [...handlers.entries()].map(([signature, id]) => {
  const separator = signature.indexOf('\u0000');
  const body = signature.slice(separator + 1);
  return `    ${JSON.stringify(id)}: function (event) {\n${body}\n    }`;
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
    var attribute = 'data-auris-generated-on' + eventType;
    while (node && node.nodeType === 1) {
      var handlerId = node.getAttribute(attribute);
      if (handlerId && handlers[handlerId]) {
        var result = handlers[handlerId].call(node, event);
        if (result === false) event.preventDefault();
      }
      if (event.cancelBubble) break;
      node = node.parentElement;
    }
  }

  eventTypes.forEach(function (eventType) {
    document.addEventListener(eventType, function (event) {
      dispatch(eventType, event);
    }, eventType === 'error');
  });
})();
`;

fs.writeFileSync(corePath, migrated);
fs.writeFileSync(registryPath, registry);
console.log(`Migrated ${candidates.length} generated attributes into ${handlers.size} precompiled handlers.`);
