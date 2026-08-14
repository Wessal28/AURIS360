const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const indexPath = path.join(root, 'index.html');
const registryPath = path.join(root, 'auris-static-event-handlers.js');
const source = fs.readFileSync(indexPath, 'utf8');
const attributePattern = /\s(on[a-z]+)=(?:"([^"]*)"|'([^']*)')/gi;
const handlers = new Map();
const originalAttributes = [...source.matchAll(attributePattern)];

if (originalAttributes.length === 0) {
  throw new Error('No static event attributes found. The migration has already been applied; refusing to overwrite the registry.');
}

function decodeAttribute(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

const migrated = source.replace(attributePattern, (match, eventAttribute, doubleQuoted, singleQuoted) => {
  const eventType = eventAttribute.slice(2).toLowerCase();
  const code = decodeAttribute(doubleQuoted ?? singleQuoted ?? '');
  const signature = `${eventType}\u0000${code}`;
  if (!handlers.has(signature)) handlers.set(signature, `h${String(handlers.size + 1).padStart(4, '0')}`);
  return ` data-auris-on${eventType}="${handlers.get(signature)}"`;
});

const entries = [...handlers.entries()].map(([signature, id]) => {
  const separator = signature.indexOf('\u0000');
  const code = signature.slice(separator + 1);
  return `    ${JSON.stringify(id)}: function (event) {\n${code}\n    }`;
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
    var attribute = 'data-auris-on' + eventType;
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
    });
  });
})();
`;

fs.writeFileSync(indexPath, migrated);
fs.writeFileSync(registryPath, registry);
console.log(`Migrated ${originalAttributes.length} attributes into ${handlers.size} registered handlers.`);
