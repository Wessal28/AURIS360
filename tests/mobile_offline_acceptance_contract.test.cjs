const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function functionSource(name) {
  const start = html.indexOf(`function ${name}(`);
  assert(start >= 0, `function ${name} is missing`);
  const brace = html.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < html.length; index += 1) {
    if (html[index] === '{') depth += 1;
    if (html[index] === '}') {
      depth -= 1;
      if (depth === 0) return html.slice(start, index + 1);
    }
  }
  throw new Error(`function ${name} is incomplete`);
}

// Installable, same-origin PWA shell.
assert.strictEqual(manifest.start_url, '/');
assert.strictEqual(manifest.scope, '/');
assert.strictEqual(manifest.display, 'standalone');
assert(manifest.icons.some((icon) => icon.sizes === '192x192' && /maskable/.test(icon.purpose)));
assert(manifest.icons.some((icon) => icon.sizes === '512x512' && /maskable/.test(icon.purpose)));
assert.match(sw, /networkFirstNavigation/);
assert.match(sw, /cache\.match\(['"]\/index\.html['"]\)/);
assert.match(sw, /isPrivateOrApiRequest[\s\S]*supabase\.co[\s\S]*\/auth\/[\s\S]*\/api\//);

// Only the two supported field workflows advertise background sync.
assert.match(sw, /event\.tag === ['"]sync-incidents['"]/);
assert.match(sw, /event\.tag === ['"]sync-observations['"]/);
assert.doesNotMatch(sw, /sync-inspections/);
assert.match(sw, /type: ['"]SYNC_REQUEST['"]/);
assert.match(html, /data\.type===['"]SYNC_REQUEST['"][\s\S]*offlineSyncNow\(\)/);

// Offline drafts preserve failed work, upload evidence after the authoritative
// record exists and never cross the active tenant boundary.
assert.match(functionSource('offlineQueueAdd'), /status=['"]pending['"][\s\S]*offlineQueueWrite/);
assert.match(functionSource('offlineSyncNow'), /activeCompany=ccid\(\)/);
assert.match(functionSource('offlineDraftCanSync'), /offlineDraftCompanyId\(item\)[\s\S]*companyId/);
assert.match(functionSource('offlineSyncNow'), /offlineDraftCanSync\(item,activeCompany\)[\s\S]*continue/);
assert.match(functionSource('offlineSyncNow'), /offlineSyncInFlight[\s\S]*finally\{offlineSyncInFlight=false;/);
assert.match(functionSource('offlineQueueWrite'), /offlineDraftDeduplicate/);
assert.match(functionSource('offlineSyncNow'), /catch\(e\)[\s\S]*status=['"]pending['"][\s\S]*last_error/);
assert.match(functionSource('offlineSyncNow'), /filter\(function\(x\)\{return x\.status!==['"]synced['"];/);
assert.match(functionSource('offlineRetryDraft'), /Switch to the company where this draft was created/);
assert.match(functionSource('offlineSyncIncident'), /offlineUploadIncidentPhotos/);
assert.match(functionSource('offlineSyncObservation'), /offlineUploadObservationPhotos/);

// Mobile navigation remains role-gated and field-reporting forms expose their
// compact mobile mode rather than a desktop-only surface.
assert.match(html, /var MOBILE_MODULES = \[/);
for (const page of ['dashboard', 'events', 'observation', 'inspection', 'risk']) {
  assert.match(html, new RegExp(`\\{k:['"]${page}['"]`), `mobile directory is missing ${page}`);
}
assert.match(functionSource('mobileApplyAccess'), /canAccessPage\(m\.k\)/);
assert.match(functionSource('imsSetFormMode'), /mobile-form3mode/);
assert.match(functionSource('obsSetFormMode'), /mobile-form3mode/);
assert.match(html, /@media\s*\(max-width:\s*768px\)/);
assert.match(html, /#mobile-bottom3nav\s*\{\s*display:\s*flex\s*!important/);

// Record-aware links are stored through authentication and use exact-record
// adapters after the responsive shell is ready.
assert.match(functionSource('deepLinkCaptureRequest'), /deepLinkReadUrl\(\).*deepLinkReadStored\(\)/);
assert.match(functionSource('deepLinkScheduleResume'), /120,500,1200,2400/);
assert.match(functionSource('deepLinkResume'), /canAccessPage\(page\)/);
assert.match(functionSource('deepLinkResume'), /mapOpenExactSource/);

console.log('Mobile/offline acceptance contract passed (PWA shell, tenant-safe field queues, mobile access and retained deep links).');
