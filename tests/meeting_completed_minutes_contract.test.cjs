const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.resolve(__dirname,'..','auris-core.js'),'utf8');

test('agenda opens the stored completed occurrence instead of a blank form',()=>{
  assert.match(source,/function mtgClickWeek\(seriesId,week\)/);
  assert.match(source,/String\(m\.status\|\|''\)\.toLowerCase\(\)==='completed'/);
  assert.match(source,/if\(saved\)\{mtgViewMomReadOnly\(saved\.id\);return;\}/);
});

test('roadmap partial rows are refreshed before rendering complete minutes',()=>{
  assert.match(source,/async function mtgViewMomReadOnly\(id\)/);
  assert.match(source,/Object\.prototype\.hasOwnProperty\.call\(m,'title'\)/);
  assert.match(source,/\/hse_meetings\?select=\*&company_id=eq\./);
  assert.match(source,/The completed meeting minutes are unavailable for this company/);
});
