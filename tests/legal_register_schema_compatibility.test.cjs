const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const core=fs.readFileSync('auris-core.js','utf8');
function between(start,end){return core.slice(core.indexOf(start),core.indexOf(end,core.indexOf(start)));}
const source=between('async function apiAllRows(path){','// Shared reciprocal relationship service')
  +between('async function legalLoadChanges(){','function legalChgBack()')
  +between('async function lcaLoad(){','function lcaCalcScore()')
  +between('function ohIsArchivedText(v){','\n',core.indexOf('function ohIsArchivedText(v){'));
function runtime(table,rows){
  let company='company-a',rendered=0;
  const requests=[],elements={'lc-table':{innerHTML:''},'lca-list':{innerHTML:''},'lr-m3assessments':{textContent:''}};
  const scope={prof:{id:'reviewer-a'},lcAllData:[],lcaAllData:[],document:{getElementById:id=>elements[id]},
    cf:()=> '&company_id=eq.'+company,isMgr:()=>false,escH:v=>String(v||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])),
    setupFriendlyMessage:(label,message)=>label+': '+message,legalRenderChanges:()=>rendered++,
    api:async(path,options)=>{
      requests.push({path,options});
      assert.equal(options,undefined,'Legal register reads must not mutate records');
      const url=new URL(path,'https://fictional.invalid');assert.equal(url.pathname,'/'+table);
      if(url.searchParams.has('archived_at'))throw Error('column '+table+'.archived_at does not exist');
      assert.equal(url.searchParams.get('company_id'),'eq.'+company);
      const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||500);
      return structuredClone(rows.slice(offset,offset+limit));
    }};
  vm.runInNewContext(source,scope);
  return {scope,requests,elements,load:()=>scope[table==='legal_changes'?'legalLoadChanges':'lcaLoad'](),cache:()=>scope[table==='legal_changes'?'lcAllData':'lcaAllData'],setCompany:id=>company=id,rendered:()=>rendered};
}
for(const table of ['legal_changes','compliance_assessments']){
  const marker=table==='legal_changes'?'comments':'findings';
  test(table+' opens a legacy schema without archived_at and retains archive markers',async()=>{
    const h=runtime(table,[{id:'active',title:'Retained legacy record',status:'draft',company_id:'company-a'},{id:'old',status:table==='compliance_assessments'?'archived':'draft',[marker]:'[Archived 2026-10-19] Retained history',company_id:'company-a'}]);
    await h.load();assert.deepEqual(Array.from(h.cache(),r=>r.id),['active']);
    assert.equal(h.requests.length,1);assert.doesNotMatch(h.requests[0].path,/archived_at/);
    if(table==='compliance_assessments'){assert.equal(h.elements['lr-m3assessments'].textContent,1);assert.match(h.elements['lca-list'].innerHTML,/Retained legacy record/);}
    else assert.equal(h.rendered(),1);
  });
  test(table+' keeps archived upgraded rows out of displayed records and counts',async()=>{
    const h=runtime(table,[{id:'active',title:'Visible record',archived_at:null,company_id:'company-a'},{id:'archived',title:'Hidden archived record',archived_at:'2026-10-19T10:00:00Z',company_id:'company-a'}]);
    await h.load();assert.deepEqual(Array.from(h.cache(),r=>r.id),['active']);
    if(table==='compliance_assessments'){assert.equal(h.elements['lr-m3assessments'].textContent,1);assert.doesNotMatch(h.elements['lca-list'].innerHTML,/Hidden archived record/);}
  });
  test(table+' reads beyond a page of archive history without dropping active records',async()=>{
    const archived=Array.from({length:500},(_,i)=>({id:'archived-'+i,archived_at:'2026-10-19T10:00:00Z',company_id:'company-a'}));
    const h=runtime(table,archived.concat([{id:'active',title:'Active second page',company_id:'company-a'}]));
    await h.load();assert.deepEqual(Array.from(h.cache(),r=>r.id),['active']);assert.equal(h.requests.length,2);assert.match(h.requests[1].path,/offset=500/);
  });
  test(table+' retains a recoverable error and can be reloaded after read failure',async()=>{
    const h=runtime(table,[{id:'active',title:'Recovered record',company_id:'company-a'}]),read=h.scope.api;
    h.scope.api=async()=>{throw Error('Fictional connection interruption');};await h.load();
    const host=h.elements[table==='legal_changes'?'lc-table':'lca-list'];assert.match(host.innerHTML,/Fictional connection interruption/);
    h.scope.api=read;await h.load();assert.deepEqual(Array.from(h.cache(),r=>r.id),['active']);assert.doesNotMatch(host.innerHTML,/Fictional connection interruption/);
  });
  test(table+' ignores a late response or error after the viewed company changes',async()=>{
    const h=runtime(table,[]);h.scope.api=async()=>{h.setCompany('company-b');return [{id:'old-company',title:'Must not render',company_id:'company-a'}];};
    await h.load();assert.equal(h.cache().length,0);assert.equal(h.rendered(),0);assert.doesNotMatch(h.elements['lca-list'].innerHTML,/Must not render/);
    h.scope.api=async()=>{h.setCompany('company-c');throw Error('Old company error');};await h.load();
    assert.doesNotMatch(h.elements[table==='legal_changes'?'lc-table':'lca-list'].innerHTML,/Old company error/);
  });
}
