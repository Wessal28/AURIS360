const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');

function runtime(){
  const state={company:'company-a',user:'reviewer',role:'inspector',denied:''},requests=[],previews=[],windows=[];
  const tables={inspections:[
    {id:'selected',company_id:'company-a',reference_no:'INSP-ONE',inspection_type:'workplace',inspection_date:'2026-11-28',inspector:'Saved Inspector',site:'Saved site',status:'draft',score_good:1,score_insuf:0,items:[{item:'Saved guard wording',result:'good',observation:'Retained observation'}],action_items:[{description:'Retained action',responsible:'Saved owner',target_date:'2026-12-01'}]},
    {id:'another',company_id:'company-a',reference_no:'DO-NOT-PRINT-REGISTER',inspection_type:'workplace'},
    {id:'audit',company_id:'company-a',reference_no:'AUD-ONE',inspection_type:'internal_audit',items:[]},
    {id:'prestart',company_id:'company-a',reference_no:'PS-ONE',inspection_type:'prestart',items:[]},
    {id:'foreign',company_id:'company-b',reference_no:'FOREIGN-DATA',inspection_type:'workplace'}
  ],audit_findings:[
    {id:'finding-one',company_id:'company-a',inspection_id:'selected',finding_ref:'F-ONE',description:'Only this inspection finding'},
    {id:'finding-other',company_id:'company-a',inspection_id:'another',finding_ref:'F-OTHER',description:'UNRELATED FINDING'}
  ]};
  const c={console,URL,URLSearchParams,Map,Set,document:{getElementById:()=>null},prof:{id:'reviewer',role:'inspector'}};
  function check(captured,module,section){
    assert.equal(module,'inspection');
    if(captured.company!==state.company||captured.user!==state.user||captured.role!==state.role)throw Error('Your account, role or company changed.');
    if(state.denied===section||state.denied==='module')throw Error('This report section is unavailable.');
  }
  c.AurisModuleReports={support(){},context(module){assert.equal(module,'inspection');const captured={company:state.company,user:state.user,role:state.role};check(captured,module);return captured;},check,
    reserve(){const window={closed:false,close(){this.closed=true;}};windows.push(window);return window;},
    async read(table,captured,module,section,id){check(captured,module,section);requests.push({table,id,company:captured.company,section});if(runtime.readHook)runtime.readHook(state);check(captured,module,section);const rows=(tables[table]||[]).filter(row=>row.company_id===captured.company&&(!id||row.id===id));if(id&&rows.length!==1)throw Error('The saved record is unavailable in this company.');return structuredClone(rows);},
    async preview(options){check(options.context,options.moduleKey,options.section);options.guard?.();previews.push(options);return options;}
  };
  c.window=c;vm.createContext(c);
  for(const file of ['module-print-catalogue.js','operational-print-catalogue.js','inspection-print-reports.js'])vm.runInContext(fs.readFileSync(file,'utf8'),c);
  return {api:c.AurisInspectionReports,state,requests,previews,windows,tables};
}

test('one inspection print uses the exact saved ID, full saved details and related findings without the register',async()=>{
  const h=runtime(),report=await h.api.print('selected',{type:'workplace'});
  assert.equal(h.requests[0].table,'inspections');assert.equal(h.requests[0].id,'selected');assert.equal(h.requests[0].company,'company-a');
  assert.equal(report.section,'workplace');assert.equal(report.paper,'A4');assert.match(report.sourceLabel,/Exact saved record/);
  for(const text of ['INSP-ONE','Saved Inspector','Saved guard wording','Retained observation','Retained action','Only this inspection finding'])assert.match(report.html,new RegExp(text));
  assert.doesNotMatch(report.html,/DO-NOT-PRINT-REGISTER|UNRELATED FINDING|FOREIGN-DATA/);
  assert.equal(h.previews.length,1);assert.equal(h.windows.length,1);assert.equal(h.windows[0].closed,false);
});

test('audit and pre-start records use their own access sections and do not invent readiness',async()=>{
  const h=runtime();assert.equal(h.api.section('internal_audit'),'audit');assert.equal(h.api.section('iso_audit'),'audit');
  assert.equal((await h.api.print('audit',{type:'internal_audit'})).section,'audit');
  const prestart=await h.api.print('prestart',{type:'prestart'});assert.equal(prestart.section,'prestart');assert.doesNotMatch(prestart.html,/>Go<|100%/);
});

test('unsaved and foreign record requests fail without producing a report',async()=>{
  const h=runtime();await assert.rejects(h.api.print('',{type:'workplace'}),/Save and open one inspection/);assert.equal(h.requests.length,0);
  await assert.rejects(h.api.print('foreign',{type:'workplace'}),/unavailable/);assert.equal(h.previews.length,0);assert.equal(h.windows[0].closed,true);
});

test('current section restrictions and company changes are checked before printing',async()=>{
  const h=runtime();h.state.denied='workplace';await assert.rejects(h.api.print('selected',{type:'workplace'}),/unavailable/);assert.equal(h.requests.length,0);
  const other=runtime();runtime.readHook=state=>{state.company='company-b';};
  try{await assert.rejects(other.api.print('selected',{type:'workplace'}),/changed/);assert.equal(other.previews.length,0);assert.equal(other.windows[0].closed,true);}finally{runtime.readHook=null;}
});

test('an exact-report request cannot use the findings register and a provided window closes on cancellation',async()=>{
  const h=runtime(),window={closed:false,close(){this.closed=true;}};
  await assert.rejects(h.api.print('selected',{section:'findings',preparedWindow:window}),/Choose an audit or inspection/);assert.equal(window.closed,true);assert.equal(h.requests.length,0);
  await assert.rejects(h.api.print('selected',{type:'workplace',guard(){throw Error('View closed');}}),/View closed/);assert.equal(h.previews.length,0);
});
