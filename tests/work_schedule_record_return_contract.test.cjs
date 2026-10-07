const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'auris-core.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'auris-audits-inspections-static.css'), 'utf8');

test('work detail supports every linked inspection, risk assessment and permit', () => {
  assert.match(core, /\['tbt','prestart','site','ra','ptw'\]\.includes\(kind\)\?'multiple size="3"/);
  assert.match(core, /linked\('ra',x\.ra_ref,data\[3\]/);
  assert.match(core, /linked\('ptw',x\.permit_ref,data\[4\]/);
  assert.match(core, /\['tbt','prestart','site','ra','ptw','event'\]\.forEach\(wsRenderLinkedSummary\)/);
  assert.match(core, /work_schedule_links\?on_conflict=work_order_id,link_type,record_id/);
  assert.match(core, /Optional work schedule multi-record links are not installed; direct relationship saved/);
  assert.match(core, /work_schedule\?id=eq[\s\S]*work_schedule_links\?on_conflict/);
});

test('forms opened from a work order link back and return to that work', () => {
  for (const kind of ['prestart', 'site', 'ra', 'ptw']) {
    assert.match(core, new RegExp(`wsSetRecordReturnContext\\('${kind}'`));
    assert.match(core, new RegExp(`wsReturnToWork\\('${kind}'\\)`));
  }
  assert.match(core, /wsAttachSavedRecord\('prestart'/);
  assert.match(core, /wsAttachSavedRecord\('site'/);
  assert.match(core, /wsAttachSavedRecord\('ra'/);
  assert.match(core, /wsAttachSavedRecord\('ptw'/);
  assert.match(core, /showPage\('workschedule'/);
});

test('pre-start checklist uses compact, readable controls', () => {
  assert.match(css, /#ps-checklist-body legend\{[^}]*font-size:13px/);
  assert.match(css, /\.ps-check-answers label\{[^}]*min-height:36px[^}]*font-size:12px/);
  assert.match(css, /#ps-checklist-body textarea\{[^}]*min-height:52px[^}]*font-size:12px/);
});

test('work detail selects every saved inspection by record ID and loads older linked records', async () => {
  const start = core.indexOf('function wsLinkedOptionHtml(');
  const end = core.indexOf('// ===== IMS_JS.JS =====', start);
  const section = core.slice(start, end);
  const elements = Object.fromEntries(['tbt','prestart','site','ra','ptw','event'].map(kind => ['ws-link-'+kind,{innerHTML:''}]));
  const requests=[];
  const currentId='11111111-1111-4111-8111-111111111111',olderId='22222222-2222-4222-8222-222222222222';
  const context={document:{getElementById:id=>elements[id]||null},ccid:()=> 'co-a',cf:()=> '&company_id=eq.co-a',wsRestEqValue:encodeURIComponent,escH:value=>String(value),wsRenderLinkedSummary:()=>{},api:async url=>{
    requests.push(url);
    if(url.startsWith('/work_schedule_links?'))return [
      {company_id:'co-a',work_order_id:'wo-1',link_type:'prestart',record_id:currentId,record_ref:'PS-NEW'},
      {company_id:'co-a',work_order_id:'wo-1',link_type:'prestart',record_id:olderId,record_ref:'PS-OLD'},
      {company_id:'co-b',work_order_id:'wo-1',link_type:'site',record_id:'private',record_ref:'PRIVATE'}
    ];
    if(url.includes('inspection_type=eq.prestart'))return [{id:currentId,reference_no:'PS-NEW',inspection_type:'prestart'}];
    if(url.includes('id=eq.'+olderId))return [{id:olderId,reference_no:'PS-OLD',inspection_type:'prestart'}];
    return [];
  }};
  vm.createContext(context);vm.runInContext(section,context);
  await context.wsLoadLinkedRecordOptions({id:'wo-1'});
  assert.match(elements['ws-link-prestart'].innerHTML, /value="11111111-1111-4111-8111-111111111111"[^>]*selected/);
  assert.match(elements['ws-link-prestart'].innerHTML, /value="22222222-2222-4222-8222-222222222222"[^>]*selected/);
  assert.ok(requests.some(url=>url.includes('id=eq.'+olderId)));
  assert.doesNotMatch(elements['ws-link-site'].innerHTML,/PRIVATE/);
});
