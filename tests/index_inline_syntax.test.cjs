const fs = require('fs');

const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
if (!scripts.length) throw new Error('No inline application scripts found');
for (let index = 0; index < scripts.length; index += 1) {
  try {
    new Function(scripts[index]);
  } catch (error) {
    throw new Error(`Inline script ${index + 1} failed syntax validation: ${error.message}`);
  }
}
console.log(`Inline application syntax passed (${scripts.length} script block${scripts.length === 1 ? '' : 's'}).`);
