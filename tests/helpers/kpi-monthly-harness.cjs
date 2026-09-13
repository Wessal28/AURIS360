const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function harness({realLoader=true,existing=false}={}){
  const nodes={},calls=[],notices=[],audits=[];
  const field=value=>({value:String(value??''),style:{},dataset:{},disabled:false,children:[],setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];},focus(){document.activeElement=this;},prepend(el){this.children.unshift(el);},remove(){this.removed=true;},addEventListener(){},closest(){return null;}});
  for(const id of ['entry-actual','entry-ytd','entry-comment','entry-root-cause','entry-evidence','entry-modal-title','entry-kpi-name','entry-kpi-target','entry-month-label','entry-kpi-target','kpi-clear-btn'])nodes[id]=field('');
  nodes['year-sel']=field(2025);
  const panel=field(''),modal=field('');modal.style.display='none';modal.querySelector=selector=>selector==='[data-kpi-entry-message]'?panel.children.find(el=>!el.removed):panel;modal.querySelectorAll=()=>controls;modal.contains=el=>controls.includes(el)||panel.children.includes(el);nodes['kpi-entry-modal']=modal;
  const save=field(''),cancel=field('');save.getAttribute=name=>name==='data-auris-onclick'?'h0145':null;cancel.getAttribute=name=>name==='data-auris-onclick'?'h0143':null;
  const controls=[...Object.values(nodes).filter(el=>el!==nodes['year-sel']&&el!==modal),save,cancel];
  controls.forEach(el=>{el.matches=selector=>selector.includes('h0143')&&el===cancel;});
  const document={readyState:'loading',activeElement:null,getElementById:id=>nodes[id]||null,querySelectorAll:()=>[],createElement:()=>field(''),addEventListener(){}};
  const kpi={id:'k',objective_id:'o',company_id:'a',name:'Talks',code:'1.1',frequency:'monthly',status:'not_started',year:2025,definition_revision:4,approval_status:'locked'},indicator={id:'i',kpi_id:'k',company_id:'a',source_mode:'manual',name:'Count',target_value:100,target_operator:'gte',ytd_method:'sum'};
  const c={console,Date,document,kpiKPIs:[kpi],kpiIndicators:[indicator],kpiObjectives:[{id:'o'}],kpiMonthlyData:{},confirmations:[],confirm:async()=>true,appConfirmAction:async opts=>{c.confirmations.push(opts);return c.confirm();},KpiGovernedWorkflow:{canEnterMonthly:()=>c.workflowAllowed},workflowAllowed:true,kpiEntryIndicatorId:null,kpiEntryMonth:0,kpiEntryYear:2025,KPI_MONTHS:['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],kpiConfigPublished:{},prof:{id:'user-a',company_id:'a'},company:'a',ccid:()=>c.company,isSA:()=>false,isMgr:()=>true,kpiCanEdit:()=>c.allowed,allowed:true,kpiFmtTarget:()=>100,kpiGetProgress:(ind,val)=>val,toast:(...args)=>notices.push(args),toastActionError:(...args)=>notices.push(args),auditLogEvent:(...args)=>audits.push(args),setTimeout(){},api:async(url,options)=>{calls.push({url,options});return c.response(url,options);},response:null};
  c.stored=existing?{id:'m',kpi_id:'k',indicator_id:'i',company_id:'a',year:2025,month:8,actual:50,ytd:50,comment:'Old',result_revision:3}:null;
  if(existing)c.kpiMonthlyData={i:{8:{...c.stored}}};
  c.response=async(url,options)=>{
    if(options){
      if(url!=='/rpc/mutate_kpi_monthly_result')throw Error('Unexpected non-atomic write');
      const b=options.b;
      if((c.stored?.id||null)!==b.p_expected_id||(c.stored?.result_revision??null)!==b.p_expected_revision)throw Error('AURIS_KPI_MONTHLY_CONFLICT');
      if(b.p_operation==='clear')c.stored=null;
      else {const e=b.p_entry; c.stored={id:c.stored?.id||'new-month',kpi_id:'k',indicator_id:'i',company_id:'a',year:2025,month:8,actual:e.actual,ytd:e.actual,comment:e.explanation.trim()+(e.root.trim()?'\nRoot cause: '+e.root.trim():'')+(e.evidence.trim()?'\nEvidence: '+e.evidence.trim():''),result_revision:(c.stored?.result_revision||0)+1};}
      return {operation:b.p_operation,indicator_id:'i',year:2025,month:8,result:c.stored,kpi:{...kpi},monthly:c.stored?[{...c.stored}]:[]};
    }
    if(url.startsWith('/objectives'))return [{id:'o'}];
    if(url.startsWith('/kpis_v2'))return [{...kpi}];
    if(url.startsWith('/kpi_indicators'))return [{...indicator}];
    if(url.startsWith('/kpi_monthly_data'))return c.stored?[{...c.stored}]:[];
    throw Error('Unexpected request');
  };

  c.kpiLoadAll=async()=>{if(c.loadError)throw new Error('load failed');c.kpiKPIs=[kpi];c.kpiIndicators=[indicator];c.kpiObjectives=[{id:'o'}];c.kpiMonthlyData={i:{8:c.stored}};};
  c.window=c;vm.createContext(c);
  const core=fs.readFileSync(path.join(root,'auris-core.js'),'utf8');
  vm.runInContext(core.slice(core.indexOf('function closeKpiModal(id)'),core.indexOf('async function kpiDeleteObjective')),c);
  vm.runInContext(core.slice(core.indexOf('function kpiCalcYTD(indicatorId'),core.indexOf('// -- SOP MODULE HELPERS')),c);
  if(realLoader){vm.runInContext(core.slice(core.indexOf('async function kpiLoadAll('),core.indexOf('function kpiUpdateMetrics()')),c);c.kpiRenderOverview=()=>{};c.kpiRenderMonthly=()=>{};c.kpiUpdateMetrics=()=>{};}
  const source=fs.readFileSync(path.join(root,'kpi-module-upgrade.js'),'utf8'),boot="if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',kpiXBoot);else kpiXBoot();";
  assert.ok(source.includes(boot));vm.runInContext(source.replace(boot,'kpiXInstallHooks();window.qa={renderCount:0};kpiXRenderAll=function(){window.qa.renderCount++;};'),c);
  if(realLoader){c.kpiRenderOverview=()=>{};c.kpiRenderMonthly=()=>{};c.kpiUpdateMetrics=()=>{};}
  c.kpiOpenEntry('i','k',8);nodes['entry-actual'].value='100';nodes['entry-ytd'].value='';nodes['entry-comment'].value='Explanation';nodes['entry-root-cause'].value='Cause';nodes['entry-evidence'].value='Record A';
  return {c,nodes,modal,panel,calls,notices,audits,kpi,indicator,save,cancel,controls,writes:()=>calls.filter(x=>x.options),message:()=>panel.children.find(el=>!el.removed)};
}
module.exports={harness,deferred};
