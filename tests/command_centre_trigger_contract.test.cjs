const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('command centre binds a top-bar trigger that is parsed after its script',()=>{
  const js=read('auris-command-centre.js'),html=read('index.html');
  assert.match(js,/DOMContentLoaded/);
  assert.match(js,/buttonBound/);
  assert.match(js,/getElementById\('auris-command-trigger'\)/);
  assert.match(html,/auris-command-centre\.js\?v=20260911-trigger-fix-1/);
  assert.match(html,/id="auris-command-trigger"/);
});
