(function(root){
'use strict';

var modules = [
  {key:'dashboard',name:'HSE Control Centre',shortName:'Home',icon:'ti-layout-dashboard',color:'#185FA5',category:'Home',legacySection:'Main',order:10,platform:true,companyScoped:false,loader:'loadDash',dependencies:[]},
  {key:'executive',name:'Executive Dashboard',shortName:'Executive',icon:'ti-chart-bar',color:'#5B21B6',category:'Home',legacySection:'Main',order:20,platform:true,companyScoped:false,loader:'loadExecutive',dependencies:['dashboard']},
  {key:'ai-insights',name:'AI Insights',shortName:'AI Insights',icon:'ti-brain',color:'#5B21B6',category:'Home',legacySection:'Main',order:30,platform:true,companyScoped:false,loader:'genFullAI',dependencies:['dashboard']},
  {key:'events',name:'Incident Management',shortName:'Incidents',icon:'ti-alert-triangle',color:'#DC2626',category:'Operations',legacySection:'HSE Modules',order:100,companyScoped:true,loader:'loadEvents',dependencies:['people','actions'],layout:{defaultView:'dashboard',views:['dashboard','register','kanban','form','reports','activities','configuration']},lifecycle:{managed:true},workflow:{entity:'incident',initial:'draft',terminal:['closed','cancelled'],states:['draft','submitted','triage','under_investigation','verification','management_review','closed','cancelled'],transitions:[['draft','submitted'],['draft','cancelled'],['submitted','triage'],['submitted','cancelled'],['triage','under_investigation'],['triage','cancelled'],['under_investigation','verification'],['verification','under_investigation'],['verification','management_review'],['management_review','under_investigation'],['management_review','closed']]}},
  {key:'investigation',name:'Incident Investigation',shortName:'Investigations',icon:'ti-search',color:'#B91C1C',category:'Operations',legacySection:'HSE Modules',order:105,companyScoped:false,hidden:true,loader:'loadInvs',dependencies:['events','actions']},
  {key:'observation',name:'BBS Observations',shortName:'Observations',icon:'ti-eye',color:'#9A3412',category:'Operations',legacySection:'HSE Modules',order:110,companyScoped:true,loader:'loadObservationModule',dependencies:['people','actions']},
  {key:'engagement',name:'Safety Engagement',shortName:'Engagement',icon:'ti-heart-handshake',color:'#9A3412',category:'Operations',legacySection:'HSE Modules',order:115,companyScoped:false,hidden:true,loader:'loadSafetyEngagement',dependencies:['observation','people']},
  {key:'inspection',name:'Audits & Inspections',shortName:'Inspections',icon:'ti-clipboard-check',color:'#1D9E75',category:'Operations',legacySection:'HSE Modules',order:120,companyScoped:true,loader:'loadInspectionModule',dependencies:['actions']},
  {key:'permit',name:'Permit to Work',shortName:'Permits',icon:'ti-file-certificate',color:'#854F0B',category:'Operations',legacySection:'HSE Modules',order:130,companyScoped:true,loader:'loadPermits',dependencies:['risk','swms','people']},
  {key:'workschedule',name:'Work Schedule',shortName:'Schedule',icon:'ti-calendar-event',color:'#065F46',category:'Operations',legacySection:'HSE Modules',order:140,companyScoped:true,loader:'loadWorkSchedule',dependencies:['people']},
  {key:'contractor',name:'Contractor Management',shortName:'Contractors',icon:'ti-helmet',color:'#0891B2',category:'Operations',legacySection:'HSE Modules',order:150,companyScoped:true,loader:'loadContractors',dependencies:['people','documents']},
  {key:'tools',name:'Tools & Equipment',shortName:'Tools',icon:'ti-tools',color:'#374151',category:'Operations',legacySection:'HSE Modules',order:160,companyScoped:true,loader:'loadTools',dependencies:['inspection']},
  {key:'fleet',name:'Fleet Management',shortName:'Fleet',icon:'ti-car',color:'#185FA5',category:'Operations',legacySection:'HSE Modules',order:170,companyScoped:true,loader:'loadFleet',dependencies:['people','inspection']},
  {key:'meetings',name:'HSE Meetings',shortName:'Meetings',icon:'ti-notes',color:'#185FA5',category:'Operations',legacySection:'HSE Modules',order:180,companyScoped:true,loader:'loadMtgs',dependencies:['people','actions']},
  {key:'risk',name:'Risk Assessment',shortName:'Risk',icon:'ti-shield-check',color:'#C2410C',category:'Risk & Controls',legacySection:'HSE Modules',order:200,companyScoped:true,loader:'loadRA',dependencies:['people','actions']},
  {key:'actions',name:'Master Action Plan',shortName:'Actions',icon:'ti-list-check',color:'#DC2626',category:'Risk & Controls',legacySection:'Management',order:210,companyScoped:true,loader:'loadActions',dependencies:['people']},
  {key:'moc',name:'Management of Change',shortName:'MOC',icon:'ti-arrows-exchange',color:'#0F6E56',category:'Risk & Controls',legacySection:'Management',order:220,companyScoped:true,loader:'loadMOC',dependencies:['risk','actions','documents']},
  {key:'chemical',name:'Chemical Control',shortName:'Chemicals',icon:'ti-flask',color:'#7C3AED',category:'Risk & Controls',legacySection:'HSE Modules',order:230,companyScoped:true,loader:'loadChemical',dependencies:['risk','documents']},
  {key:'atex',name:'ATEX Areas',shortName:'ATEX',icon:'ti-flame',color:'#C2410C',category:'Risk & Controls',legacySection:'HSE Modules',order:240,companyScoped:true,loader:'loadATEX',dependencies:['risk','sitemap']},
  {key:'fire',name:'Fire Certificates',shortName:'Fire Certs',icon:'ti-flame',color:'#B91C1C',category:'Risk & Controls',legacySection:'HSE Modules',order:250,companyScoped:true,loader:'loadFire',dependencies:['documents']},
  {key:'emergency',name:'Emergency Management',shortName:'Emergency',icon:'ti-ambulance',color:'#DC2626',category:'Risk & Controls',legacySection:'HSE Modules',order:260,companyScoped:true,loader:'loadEmergency',dependencies:['people','sitemap']},
  {key:'sitemap',name:'Site Map',shortName:'Site Map',icon:'ti-map-2',color:'#0F6E56',category:'Risk & Controls',legacySection:'HSE Modules',order:270,companyScoped:true,loader:'loadSiteMap',dependencies:[]},
  {key:'ppe',name:'PPE Management',shortName:'PPE',icon:'ti-shield',color:'#1D9E75',category:'Risk & Controls',legacySection:'HSE Modules',order:280,companyScoped:true,loader:'loadPPE',dependencies:['people']},
  {key:'noise',name:'Occupational Noise Management',shortName:'Noise',icon:'ti-volume',color:'#EF9F27',category:'Risk & Controls',legacySection:'HSE Modules',order:290,companyScoped:true,loader:'loadNoiseModule',dependencies:['people','risk']},
  {key:'esg',name:'Environmental / ESG',shortName:'ESG',icon:'ti-leaf',color:'#065F46',category:'Risk & Controls',legacySection:'HSE Modules',order:300,companyScoped:true,loader:'loadESG',dependencies:['actions']},
  {key:'training',name:'Training & Competency',shortName:'Training',icon:'ti-certificate',color:'#5B21B6',category:'People',legacySection:'HSE Modules',order:400,companyScoped:true,loader:'loadTraining',dependencies:['people']},
  {key:'people',name:'People',shortName:'People',icon:'ti-id-badge',color:'#185FA5',category:'People',legacySection:'Management',order:410,companyScoped:true,loader:'loadPeople',dependencies:[]},
  {key:'ohealth',name:'Occupational Health',shortName:'OH&S',icon:'ti-stethoscope',color:'#065F46',category:'People',legacySection:'HSE Modules',order:420,companyScoped:true,loader:'loadOHealth',dependencies:['people']},
  {key:'documents',name:'Document Control',shortName:'Documents',icon:'ti-files',color:'#374151',category:'Governance',legacySection:'Management',order:500,companyScoped:true,loader:'loadDocs',dependencies:['people']},
  {key:'legal',name:'Legal Compliance',shortName:'Legal',icon:'ti-scale',color:'#374151',category:'Governance',legacySection:'Management',order:510,companyScoped:true,loader:'loadLegal',dependencies:['actions','documents']},
  {key:'sop',name:'SOP Generator',shortName:'SOPs',icon:'ti-file-description',color:'#374151',category:'Governance',legacySection:'Management',order:520,companyScoped:true,loader:'loadSOP',dependencies:['documents']},
  {key:'swms',name:'SWMS / Method Statements',shortName:'SWMS',icon:'ti-file-check',color:'#374151',category:'Governance',legacySection:'Management',order:530,companyScoped:true,loader:'loadSWMS',dependencies:['risk','documents']},
  {key:'kpi',name:'Objectives & KPIs',shortName:'KPIs',icon:'ti-target',color:'#185FA5',category:'Governance',legacySection:'HSE Modules',order:540,companyScoped:true,loader:'kpiLoadAll',dependencies:['dashboard']},
  {key:'approvals',name:'Approval Centre',shortName:'Approvals',icon:'ti-circle-check',color:'#1D9E75',category:'Administration',legacySection:'Management',order:600,platform:true,companyScoped:false,loader:'loadApprovals',dependencies:[]},
  {key:'audit',name:'Audit Trail',shortName:'Audit Trail',icon:'ti-history',color:'#374151',category:'Administration',legacySection:'Management',order:610,platform:true,companyScoped:false,loader:'loadAudit',dependencies:[]},
  {key:'users',name:'Users & Roles',shortName:'Users',icon:'ti-users',color:'#5B21B6',category:'Administration',legacySection:'Management',order:620,platform:true,companyScoped:false,loader:'loadUsers',dependencies:['people']},
  {key:'integrations',name:'Integrations',shortName:'Integrations',icon:'ti-plug',color:'#0891B2',category:'Administration',legacySection:'Management',order:630,platform:true,companyScoped:false,loader:'loadIntegrations',dependencies:[]},
  {key:'admin',name:'Companies',shortName:'Companies',icon:'ti-building',color:'#185FA5',category:'Administration',legacySection:'Management',order:640,platform:true,companyScoped:false,loader:'loadAdmin',dependencies:[]},
  {key:'settings',name:'Settings',shortName:'Settings',icon:'ti-settings',color:'#374151',category:'Administration',legacySection:'Management',order:650,platform:true,companyScoped:false,loader:'loadSettings',dependencies:[]}
];

var byKey=Object.create(null);
function freezeLayout(layout){
  layout=layout||{};
  var views=(layout.views||['workspace']).slice();
  var defaultView=layout.defaultView||views[0]||'workspace';
  if(views.indexOf(defaultView)===-1)throw new Error('Default module view must be declared: '+defaultView);
  return Object.freeze({defaultView:defaultView,views:Object.freeze(views)});
}
function freezeWorkflow(workflow,moduleKey){
  if(!workflow)return null;
  var states=(workflow.states||[]).slice(),known=Object.create(null);
  states.forEach(function(state){if(!state||known[state])throw new Error('Invalid workflow state '+state+' declared by '+moduleKey);known[state]=true;});
  if(!known[workflow.initial])throw new Error('Unknown initial workflow state '+workflow.initial+' declared by '+moduleKey);
  var transitions=(workflow.transitions||[]).map(function(transition){
    var pair=Array.isArray(transition)?transition.slice(0,2):[transition.from,transition.to];
    if(!known[pair[0]]||!known[pair[1]])throw new Error('Unknown workflow transition '+pair.join(' -> ')+' declared by '+moduleKey);
    return Object.freeze(pair);
  });
  var terminal=(workflow.terminal||[]).slice();
  terminal.forEach(function(state){if(!known[state])throw new Error('Unknown terminal workflow state '+state+' declared by '+moduleKey);});
  return Object.freeze({entity:workflow.entity||moduleKey,initial:workflow.initial,terminal:Object.freeze(terminal),states:Object.freeze(states),transitions:Object.freeze(transitions)});
}
modules.forEach(function(module){
  if(!module.key||byKey[module.key])throw new Error('Invalid or duplicate AURIS module key: '+module.key);
  module.version=module.version||'2.0.0';
  module.dependencies=Object.freeze((module.dependencies||[]).slice());
  module.layout=freezeLayout(module.layout);
  module.lifecycle=Object.freeze(Object.assign({managed:false},module.lifecycle||{}));
  module.workflow=freezeWorkflow(module.workflow,module.key);
  byKey[module.key]=Object.freeze(module);
});
modules.forEach(function(module){module.dependencies.forEach(function(dependency){if(!byKey[dependency])throw new Error('Unknown dependency '+dependency+' declared by '+module.key);});});
modules=Object.freeze(modules.slice().sort(function(a,b){return a.order-b.order;}));

function list(options){
  options=options||{};
  return modules.filter(function(module){
    if(options.companyScoped===true&&!module.companyScoped)return false;
    if(options.platform===true&&!module.platform)return false;
    return true;
  });
}
function get(key){return byKey[key]||null;}
function keys(options){return list(options).map(function(module){return module.key;});}
function categories(){var out=[];modules.forEach(function(module){if(out.indexOf(module.category)===-1)out.push(module.category);});return out;}
function dependenciesOf(key){var module=get(key);return module?module.dependencies.slice():[];}
function dependencyClosure(keys){
  var selected=Object.create(null),visiting=Object.create(null);
  function visit(key){
    var module=get(key);if(!module||selected[key])return;
    if(visiting[key])throw new Error('Circular AURIS module dependency: '+key);
    visiting[key]=true;module.dependencies.forEach(visit);visiting[key]=false;selected[key]=true;
  }
  (Array.isArray(keys)?keys:[keys]).forEach(visit);
  return modules.filter(function(module){return selected[module.key];}).map(function(module){return module.key;});
}
function missingDependencies(key,enabledKeys){
  var enabled=Object.create(null);(enabledKeys||[]).forEach(function(item){enabled[item]=true;});
  return dependencyClosure(dependenciesOf(key)).filter(function(dependency){return !enabled[dependency];});
}
function dependantsOf(key,options){
  options=options||{};var found=[];
  modules.forEach(function(module){
    var dependencies=options.recursive?dependencyClosure(module.dependencies):module.dependencies;
    if(dependencies.indexOf(key)!==-1)found.push(module.key);
  });
  return found;
}
function workflowOf(key){return get(key)?get(key).workflow:null;}
function nextStates(key,state){
  var workflow=workflowOf(key);if(!workflow)return[];
  return workflow.transitions.filter(function(pair){return pair[0]===state;}).map(function(pair){return pair[1];});
}
function canTransition(key,from,to){return nextStates(key,from).indexOf(to)!==-1;}

root.AurisModuleRegistry=Object.freeze({version:'2.0.0',get:get,list:list,keys:keys,categories:categories,dependenciesOf:dependenciesOf,dependencyClosure:dependencyClosure,missingDependencies:missingDependencies,dependantsOf:dependantsOf,workflowOf:workflowOf,nextStates:nextStates,canTransition:canTransition});
})(typeof window!=='undefined'?window:globalThis);
