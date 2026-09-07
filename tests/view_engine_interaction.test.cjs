const test=require('node:test'),assert=require('node:assert/strict'),runtime=require('./helpers/view-harness.cjs');
test('columns persist, required fields remain and malformed stored columns are discarded',()=>{
  const r=runtime();r.mount();const status=r.element('[data-view-column="status"]');status.checked=false;status.fire('change');
  assert.doesNotMatch(r.host.innerHTML,/<th scope="col">Status/);r.mount();assert.doesNotMatch(r.host.innerHTML,/<th scope="col">Status/);
  assert.equal(r.element('[data-view-column="title"]').disabled,true);
  const model=r.window.AurisViewEngine.model(r.rows,r.def,{columns:['bad']},r.identity);
  assert.deepEqual(Array.from(model.state.columns),['title']);
  r.click('[data-view-reset-columns]');assert.match(r.host.innerHTML,/<th scope="col">Status/);
});
test('saved view restores mode, sort, columns and filters before owner render',()=>{
  const r=runtime();let applied;
  r.mount({filters:{search:'first'},onApplyFilters:filters=>{applied=filters;r.mount();}});
  r.change('[data-view-mode]','board');r.change('[data-view-sort]','due');r.click('[data-view-direction]');
  r.element('[data-view-name]').value='Review';r.click('[data-view-save]');
  r.change('[data-view-mode]','list');r.change('[data-view-sort]','title');
  r.change('[data-view-saved]','0');
  assert.equal(applied.search,'first');assert.equal(r.element('[data-view-mode]').value,'board');
  assert.equal(r.element('[data-view-sort]').value,'due');assert.match(r.host.innerHTML,/Descending/);
});
test('storage denial keeps controls functional and tells the user settings are temporary',()=>{
  const r=runtime();r.window.localStorage.setItem=()=>{throw Error('blocked');};r.mount();
  r.change('[data-view-mode]','card');assert.equal(r.element('[data-view-mode]').value,'card');
  assert.match(r.element('[data-view-feedback]').textContent,/until the application reloads/);
  r.mount();assert.equal(r.element('[data-view-mode]').value,'card');
});
test('preferences cannot collide across company or user identifiers',()=>{
  const r=runtime();r.identity.companyId='co/a';r.mount();r.change('[data-view-mode]','card');
  r.identity.companyId='co_a';r.mount();assert.equal(r.element('[data-view-mode]').value,'list');
  r.identity.companyId='co/a';r.identity.userId='user-b';r.mount();assert.equal(r.element('[data-view-mode]').value,'list');
});
test('stale sessions cannot trigger row actions or save settings',async()=>{
  for(const key of ['companyId','userId','role']){
    const r=runtime();let calls=0;r.mount({onAction:()=>calls++});r.identity[key]='changed';
    await r.click('[data-view-action="open"]');assert.equal(calls,0);assert.match(r.element('[data-view-feedback]').textContent,/changed/);
    r.element('[data-view-name]').value='Unsafe';r.click('[data-view-save]');assert.equal(r.values.size,0);
  }
});
test('pending actions block duplicate dispatch and errors appear inside current list',async()=>{
  const r=runtime();let reject,calls=0;r.mount({onAction:()=>{calls++;return new Promise((a,b)=>{reject=b;});}});
  const pending=r.click('[data-view-action="open"]');await r.click('[data-view-action="open"]');assert.equal(calls,1);
  reject(new Error('Could not open record'));await pending;
  assert.match(r.element('[data-view-feedback]').textContent,/Could not open record/);assert.equal(r.element('[data-view-action="open"]').disabled,false);
});
test('late failures cannot paint errors over a newer render',async()=>{
  const r=runtime();let reject;r.mount({onAction:()=>new Promise((a,b)=>{reject=b;})});
  const pending=r.click('[data-view-action="open"]');r.mount();reject(Error('Obsolete'));await pending;
  assert.equal(r.element('[data-view-feedback]').hidden,true);
});
test('unscoped rows fail closed, prototype-like group names and record text are safe',()=>{
  const r=runtime();r.rows.push({id:'foreign',company_id:'co-b',title:'Secret'},{id:'unscoped',title:'Unknown'});
  r.rows[0].status='__proto__';r.rows[0].title='<img src=x onerror=alert(1)>';r.mount();
  assert.match(r.host.innerHTML,/&lt;img/);assert.doesNotMatch(r.host.innerHTML,/<img|Secret|Unknown/);
  r.change('[data-view-mode]','board');assert.match(r.host.innerHTML,/__proto__/);
  r.identity.companyId='';assert.equal(r.mount().rows.length,0);
});
test('control re-renders retain keyboard focus and table scroll',()=>{
  const r=runtime();r.mount();r.element('.ave-table-wrap').scrollLeft=250;
  r.click('[data-view-direction]');assert.equal(r.element('.ave-table-wrap').scrollLeft,250);
  assert.equal(r.document.activeElement,r.element('[data-view-direction]'));
});
