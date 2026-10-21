const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=file=>fs.readFileSync(file,'utf8');
function runtime(){
  let selected=[{value:'chem-1'}];const fields={chem3search:{value:'Solvent'},'chem3risk-filter':{value:'high'},'chem3status-filter':{value:'active'},'chem3attention-filter':{value:'review_overdue'}},events={};
  const c={URL,Date,prof:{id:'reviewer',role:'manager'},ccid:()=> 'co-a',activeRole:()=> 'manager',document:{getElementById:id=>fields[id]||null,querySelectorAll:selector=>selector==='.ccu-emergency-select:checked'?selected:[],addEventListener:(name,handler)=>events[name]=handler}};c.window=c;
  vm.createContext(c);vm.runInContext(read('chemical-control-upgrade.js').replace(/\}\)\(\);\s*$/,'window.__test={C,renderHome,renderApprovals,renderInventory,renderReviews};})();'),c);
  c.chemData=[{id:'chem-1',product_name:'Solvent <A>',status:'active'},{id:'chem-2',product_name:'Cleaner B',status:'active'}];
  Object.assign(c.__test.C,{sds:[{id:'sds-1',chemical_id:'chem-1',validation_status:'pending'}],uses:[{id:'use-1',chemical_id:'chem-1',reference:'CUA-001',task_name:'Cleaning',location_name:'Workshop',status:'proposed'}],events:[{id:'event-1',chemical_id:'chem-1',reference:'CIE-001',event_type:'receipt',quantity:2,unit:'litres',condition_status:'acceptable'}]});
  return {c,fields,events,setSelected:value=>selected=value};
}
function buttons(html){return Array.from(html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g),match=>({attributes:match[1],body:match[2]}));}
function attribute(button,name){return button.attributes.match(new RegExp('(?:^|\\s)'+name+'="([^"]*)"'))?.[1]||'';}

test('chemical list row controls are icon-only with specific accessible labels and preserved route identities',()=>{
  const {c}=runtime(),ui=c.__test;
  const use=buttons(ui.renderApprovals()).find(button=>attribute(button,'data-use-id')==='use-1');assert.equal(attribute(use,'aria-label'),'View use approval CUA-001');assert.equal(attribute(use,'title'),'View use approval CUA-001');assert.equal(use.body,'<i class="ti ti-eye" aria-hidden="true"></i>');
  const inventory=buttons(ui.renderInventory()).find(button=>attribute(button,'data-auris-module-onclick')==='c0046');assert.equal(attribute(inventory,'aria-label'),'View inventory event CIE-001');assert.deepEqual(JSON.parse(decodeURIComponent(attribute(inventory,'data-auris-module-args'))),['event-1']);assert.equal(inventory.body,'<i class="ti ti-eye" aria-hidden="true"></i>');
  const reviews=buttons(ui.renderReviews()).filter(button=>attribute(button,'data-auris-module-onclick'));
  assert.equal(reviews.length,3);assert.deepEqual(reviews.map(button=>JSON.parse(decodeURIComponent(attribute(button,'data-auris-module-args')))[0]),['chem-1','chem-2','use-1']);
  for(const button of reviews){assert.equal(attribute(button,'type'),'button');assert.ok(attribute(button,'title'));assert.equal(attribute(button,'aria-label'),attribute(button,'title'));assert.match(button.body,/^<i class="ti ti-(?:file-search|pencil)" aria-hidden="true"><\/i>$/);}
  assert.match(attribute(reviews[0],'aria-label'),/Solvent &lt;A&gt;/);
  const priority=buttons(ui.renderHome()).find(button=>attribute(button,'aria-label')==='Open SDS review queue');assert.equal(priority.body,'<i class="ti ti-chevron-right" aria-hidden="true"></i>');
});

test('compact review/inventory icons still dispatch existing exact-record module handlers',()=>{
  const {c,events}=runtime(),calls=[];c.ccuSwitch=tab=>calls.push(['tab',tab]);c.ccuOpenUse=id=>calls.push(['use',id]);c.ccuOpenInventory=id=>calls.push(['inventory',id]);c.ccuEditChemical=id=>calls.push(['chemical',id]);
  vm.runInContext(read('auris-module-event-handlers-batch-2.js'),c);
  const controls=buttons(c.__test.renderInventory()).concat(buttons(c.__test.renderReviews())).filter(button=>attribute(button,'data-auris-module-onclick')&&attribute(button,'data-auris-module-args'));
  for(const control of controls){const node={nodeType:1,parentElement:null,getAttribute:name=>attribute(control,name)};events.click({target:node,preventDefault(){}});}
  assert.deepEqual(calls,[['inventory','event-1'],['chemical','chem-1'],['chemical','chem-2'],['use','use-1']]);
});

test('chemical report-state getter returns selection and current scope only, without cached record evidence or mutation',()=>{
  const {c,fields,setSelected}=runtime();c.__test.C.tab='reviews';const state=c.AurisChemicalReportState();assert.equal(state.tab,'reviews');assert.equal(state.context.company,'co-a');assert.equal(state.context.user,'reviewer');assert.equal(state.context.role,'manager');assert.equal(state.filters.search,'Solvent');assert.equal(state.filters.risk,'high');assert.deepEqual(Array.from(state.selectedEmergencyIds),['chem-1']);assert.equal(state.sds,undefined);assert.equal(state.uses,undefined);assert.equal(state.events,undefined);
  state.tab='register';state.filters.search='Changed copy';state.selectedEmergencyIds.push('not-selected');assert.equal(c.AurisChemicalReportState().tab,'reviews');assert.equal(fields.chem3search.value,'Solvent');assert.deepEqual(Array.from(c.AurisChemicalReportState().selectedEmergencyIds),['chem-1']);setSelected([{value:'chem-2'}]);assert.deepEqual(Array.from(c.AurisChemicalReportState().selectedEmergencyIds),['chem-2']);
});
