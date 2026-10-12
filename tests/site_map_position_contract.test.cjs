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
