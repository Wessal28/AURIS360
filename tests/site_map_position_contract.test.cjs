const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const core=fs.readFileSync(path.join(__dirname,'..','auris-core.js'),'utf8');
function sourceBetween(start,end){
  const from=core.indexOf('function '+start+'('),to=core.indexOf('function '+end+'(',from);
  assert.ok(from>=0&&to>from);
  return core.slice(from,to);
}

test('unpositioned sites and records do not receive invented map coordinates',()=>{
  const context={siteMapState:{layout:{markers:[]},sites:[{id:'site-1',name:'Yard'}]},smSiteKey:s=>s.id,smSiteName:s=>s.name,smMatch:()=>true};
  context.smVisibleSites=()=>context.siteMapState.sites;
  context.smMarkerForSite=site=>context.siteMapState.layout.markers.find(m=>m.site_id===site.id)||null;
  vm.createContext(context);
  vm.runInContext(sourceBetween('smSitePosition','smEventPosition')+sourceBetween('smEventPosition','smRiskPosition')+sourceBetween('smRiskPosition','smCancelPlacement'),context);
  assert.equal(context.smSitePosition(context.siteMapState.sites[0],0),null);
  assert.equal(context.smEventPosition({id:'incident-1'},0),null);
  assert.equal(context.smRiskPosition({id:'risk-1'},0),null);
  context.siteMapState.layout.markers.push({site_id:'site-1',x:35,y:62});
  assert.equal(context.smSitePosition(context.siteMapState.sites[0],0).x,35);
  assert.equal(context.smRiskPosition({id:'risk-1'},0).y,62);
});

test('child layouts show only linked location descendants until Show all is selected',()=>{
  const sites=[{id:'site-1',name:'Plant'},{id:'area-1',parent_site_id:'site-1',name:'Workshop'},{id:'site-2',name:'Other site'}];
  const parent={id:'plan-parent',markers:[{site_id:'site-1',linked_plan_id:'plan-child'}]};
  const child={id:'plan-child',markers:[]};
  const context={siteMapState:{sites,plans:[parent,child],layout:child,showAllLocations:false},smSiteKey:s=>s.id,smLayoutEmpty:()=>({})};
  vm.createContext(context);
  vm.runInContext(sourceBetween('smPlanParents','smVisibleSites')+sourceBetween('smVisibleSites','smToggleAllLocations'),context);
  assert.deepEqual(Array.from(context.smVisibleSites(),s=>s.id),['site-1','area-1']);
  context.siteMapState.showAllLocations=true;
  assert.deepEqual(Array.from(context.smVisibleSites(),s=>s.id),['site-1','area-1','site-2']);
});

test('replacing a plan increments its revision and flags saved markers for review',()=>{
  const context={};vm.createContext(context);
  vm.runInContext(core.slice(core.indexOf('function smMarkPlanReplaced('),core.indexOf('async function smConfirmMarkerReview(')),context);
  const layout={plan_revision:2,markers:[{site_id:'site-1',x:20,y:30}],markers_review_required:false};
  context.smMarkPlanReplaced(layout,'previous-plan.png');
  assert.equal(layout.plan_revision,3);
  assert.equal(layout.markers_review_required,true);
  assert.equal(layout.markers_reviewed_at,null);
});

test('attention layers exclude completed actions and distinguish failed inspections',()=>{
  const context={Date};vm.createContext(context);
  vm.runInContext(sourceBetween('smOverdueAction','smFailedInspection')+sourceBetween('smFailedInspection','smText'),context);
  const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
  const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
  assert.equal(context.smOverdueAction({target_date:yesterday,status:'open'}),true);
  assert.equal(context.smOverdueAction({target_date:yesterday,status:'completed'}),false);
  assert.equal(context.smOverdueAction({target_date:tomorrow,status:'open'}),false);
  assert.equal(context.smFailedInspection({overall_result:'fail'}),true);
  assert.equal(context.smFailedInspection({status:'closed',score_insuf:2}),true);
  assert.equal(context.smFailedInspection({overall_result:'pass',score_insuf:0}),false);
});
