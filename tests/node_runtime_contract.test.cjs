const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

test('production Node runtime is pinned to one supported major',()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.equal(pkg.engines.node,'24.x');
  assert.doesNotMatch(pkg.engines.node,/[><=~^*]/);
});
