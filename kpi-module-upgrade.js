(function(){
'use strict';

var KPI_X_MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var KPI_X_COLUMNS=[
  {key:'type',label:'Type',className:'kpi-x-col-type'},
  {key:'target',label:'Target',className:'kpi-x-col-target'},
  {key:'actual',label:'Actual / YTD',className:'kpi-x-col-actual'},
  {key:'variance',label:'Variance',className:'kpi-x-col-variance'},
  {key:'trend',label:'6-month trend',className:'kpi-x-col-trend'},
  {key:'owner',label:'Owner',className:'kpi-x-col-owner'},
  {key:'status',label:'Status',className:'kpi-x-col-status'}
];
var kpiXState={tab:'dashboard',status:'all',objective:'all',owner:'all',frequency:'all',search:'',period:'monthly'};
var kpiXLegacy={};

function kpiXColumnStorageKey(){var company=typeof ccid==='function'?ccid():(typeof prof!=='undefined'&&prof&&prof.company_id),user=typeof prof!=='undefined'&&prof&&prof.id;return 'auris360:kpi-scorecard-columns:'+(company||'company')+':'+(user||'user');}
function kpiXColumnPreferences(){var defaults={};KPI_X_COLUMNS.forEach(function(column){defaults[column.key]=true;});try{var saved=JSON.parse(localStorage.getItem(kpiXColumnStorageKey())||'{}');KPI_X_COLUMNS.forEach(function(column){if(typeof saved[column.key]==='boolean')defaults[column.key]=saved[column.key];});}catch(e){}return defaults;}
function kpiXSaveColumnPreferences(preferences){try{localStorage.setItem(kpiXColumnStorageKey(),JSON.stringify(preferences));}catch(e){if(typeof console!=='undefined')console.warn('KPI column preferences could not be saved',e);}}
function kpiXCanManage(){return typeof isMgr==='function'&&isMgr();}

function kpiXEsc(value){
  if(typeof escH==='function')return escH(value==null?'':String(value));
  return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});
}
function kpiXNum(value){var n=parseFloat(value);return isNaN(n)?null:n;}
function kpiXRound(value,digits){var p=Math.pow(10,digits==null?1:digits);return Math.round(value*p)/p;}
function kpiXOwner(k){return k.kpi_owner||k.owner||k.responsible||'Unassigned';}
function kpiXInitials(value){return String(value||'?').split(/\s+/).filter(Boolean).slice(0,2).map(function(x){return x.charAt(0).toUpperCase();}).join('')||'?';}
function kpiXSelectedYear(){var el=document.getElementById('year-sel');return parseInt(el&&el.value,10)||new Date().getFullYear();}
function kpiXReportingMonth(){var year=kpiXSelectedYear(),now=new Date();if(year<now.getFullYear())return 12;if(year>now.getFullYear())return 0;return now.getMonth()+1;}
function kpiXCompilationMonth(){var year=kpiXSelectedYear(),now=new Date();if(year<now.getFullYear())return 12;if(year>now.getFullYear())return 0;var cycles=(window.kpiConfigPublished&&window.kpiConfigPublished.cycles)||{};return cycles.current_period_excluded===false?now.getMonth()+1:now.getMonth();}
function kpiXIsDue(k,month){var frequency=String((k&&k.frequency)||'monthly').toLowerCase();if(frequency.indexOf('annual')>=0)return month===12;if(frequency.indexOf('quarter')>=0)return month%3===0;return true;}
function kpiXDueMonth(k,month){var frequency=String((k&&k.frequency)||'monthly').toLowerCase();if(frequency.indexOf('annual')>=0)return month>=12?12:0;if(frequency.indexOf('quarter')>=0)return Math.floor(month/3)*3;return month;}
function kpiXRows(indicatorId){
  var data=(typeof kpiMonthlyData!=='undefined'&&kpiMonthlyData[indicatorId])||{};
  return Object.keys(data).map(function(key){return data[key];}).sort(function(a,b){return (a.month||0)-(b.month||0);});
}
function kpiXLatestRow(indicatorId,month){
  var data=(typeof kpiMonthlyData!=='undefined'&&kpiMonthlyData[indicatorId])||{};
  if(month&&data[month])return data[month];
  for(var m=month||12;m>=1;m--)if(data[m])return data[m];
  return null;
}
function kpiXPreviousRow(indicatorId,month){
  var data=(typeof kpiMonthlyData!=='undefined'&&kpiMonthlyData[indicatorId])||{};
  for(var m=(month||12)-1;m>=1;m--)if(data[m])return data[m];
  return null;
}
function kpiXDirection(ind){
  var op=String(ind.target_operator||'gte').toLowerCase();
  if(op==='lte'||op==='lt'||op==='zero'||op==='zero_tolerance'||op==='trend_down')return {arrow:'↓',label:'Lower is better'};
  if(op==='eq'||op==='between')return {arrow:'↔',label:op==='between'?'Remain in range':'Meet exact target'};
  return {arrow:'↑',label:op==='trend_up'?'Increasing trend':'Higher is better'};
}
function kpiXTargetText(ind){
  var op=String(ind.target_operator||'gte').toLowerCase(),target=kpiXNum(ind.target_value),max=kpiXNum(ind.target_value_max);
  var unit=ind.unit||'';
  if(op==='zero'||op==='zero_tolerance')return '0'+(unit?' '+unit:'')+' (zero tolerance)';
  if(op==='between')return (target==null?'—':target)+'–'+(max==null?'—':max)+(unit?' '+unit:'');
  if(op==='trend_up')return 'Improving ↑'+(target==null?'':' from '+target)+(unit?' '+unit:'');
  if(op==='trend_down')return 'Reducing ↓'+(target==null?'':' from '+target)+(unit?' '+unit:'');
  var symbol={eq:'=',gte:'≥',lte:'≤',gt:'>',lt:'<'}[op]||'≥';
  return symbol+(target==null?'—':target)+(unit?' '+unit:'');
}
function kpiXEvaluate(ind,actual,previous){
  actual=kpiXNum(actual);previous=kpiXNum(previous);
  if(actual==null)return {status:'data_missing',score:null,variance:null};
  var op=String(ind.target_operator||'gte').toLowerCase(),target=kpiXNum(ind.target_value),max=kpiXNum(ind.target_value_max);
  var ok=false,near=false,score=0,variance=target==null?null:kpiXRound(actual-target,1);
  if(op==='zero'||op==='zero_tolerance'){
    ok=actual===0;near=false;score=ok?100:0;variance=actual;
  }else if(op==='trend_up'||op==='trend_down'){
    if(previous==null)return {status:'not_started',score:null,variance:null};
    ok=op==='trend_up'?actual>=previous:actual<=previous;
    near=!ok&&Math.abs(actual-previous)<=Math.max(Math.abs(previous)*.1,1);
    score=ok?100:near?85:Math.max(0,100-Math.abs(actual-previous)/Math.max(Math.abs(previous),1)*100);
    variance=kpiXRound(actual-previous,1);
  }else if(op==='between'){
    if(target==null||max==null)return {status:'not_started',score:null,variance:null};
    ok=actual>=Math.min(target,max)&&actual<=Math.max(target,max);
    var gap=actual<target?target-actual:actual>max?actual-max:0;
    near=!ok&&gap<=Math.max(Math.abs(max-target)*.1,1);
    score=ok?100:near?85:Math.max(0,100-gap/Math.max(Math.abs(max-target),1)*100);
  }else if(target==null){return {status:'not_started',score:null,variance:null};
  }else if(op==='eq'){
    ok=actual===target;
    near=!ok&&Math.abs(actual-target)<=Math.max(Math.abs(target)*.1,.01);
    score=ok?100:near?85:Math.max(0,100-Math.abs(actual-target)/Math.max(Math.abs(target),1)*100);
  }else if(op==='lte'||op==='lt'){
    ok=op==='lte'?actual<=target:actual<target;
    near=!ok&&actual<=target+Math.max(Math.abs(target)*.1,1);
    score=ok?100:target===0?0:Math.max(0,target/Math.max(actual,.0001)*100);
  }else{
    ok=op==='gt'?actual>target:actual>=target;
    near=!ok&&actual>=target-Math.max(Math.abs(target)*.1,1);
    score=ok?100:target===0?0:Math.max(0,actual/target*100);
  }
  score=kpiXRound(Math.min(100,Math.max(0,score)),0);
  var rules=(window.kpiConfigPublished&&window.kpiConfigPublished.targets)||{},atRisk=kpiXNum(rules.at_risk_percent);
  atRisk=atRisk==null?85:atRisk;
  var status=ok?'on_track':score>=atRisk?'at_risk':'off_track';
  if((op==='zero'||op==='zero_tolerance')&&rules.zero_tolerance_override!==false&&actual!==0)status='off_track';
  return {status:status,score:score,variance:variance};
}
function kpiXIndicatorSnapshot(ind,month){
  var row=((typeof kpiMonthlyData!=='undefined'&&kpiMonthlyData[ind.id])||{})[month];
  if(!row)return {row:null,status:month>kpiXReportingMonth()?'not_due':month>kpiXCompilationMonth()?'in_progress':'data_missing',score:null,actual:null,variance:null};
  var previous=kpiXPreviousRow(ind.id,month),actual=row.actual;
  var result=kpiXEvaluate(ind,actual,previous&&previous.actual);
  result.row=row;result.actual=kpiXNum(actual);return result;
}
function kpiXKpiSnapshot(k,month){
  var indicators=(typeof kpiIndicators!=='undefined'?kpiIndicators:[]).filter(function(ind){return String(ind.kpi_id)===String(k.id);});
  if(!indicators.length)return {status:'not_started',score:null,indicators:[]};
  var dueMonth=kpiXDueMonth(k,month);
  if(!dueMonth)return {status:'not_due',score:null,indicators:indicators.map(function(ind){return {indicator:ind,status:'not_due',score:null,row:null,actual:null,variance:null};})};
  var snapshots=indicators.map(function(ind){var snap=kpiXIndicatorSnapshot(ind,dueMonth);snap.indicator=ind;return snap;});
  var statuses=snapshots.map(function(x){return x.status;}),rules=(window.kpiConfigPublished&&window.kpiConfigPublished.targets)||{},calcs=(window.kpiConfigPublished&&window.kpiConfigPublished.calculations)||{};
  var status=statuses.indexOf('off_track')>=0?'off_track':statuses.indexOf('data_missing')>=0?'data_missing':statuses.indexOf('at_risk')>=0?'at_risk':statuses.indexOf('in_progress')>=0?'in_progress':statuses.every(function(x){return x==='not_due';})?'not_due':statuses.every(function(x){return x==='not_started';})?'not_started':'on_track';
  var scores=snapshots.map(function(x){return x.score;}).filter(function(x){return x!=null;});
  var score=scores.length?(calcs.aggregation==='worst'?Math.min.apply(null,scores):scores.reduce(function(a,b){return a+b;},0)/scores.length):null;
  if(rules.critical_override===false&&score!=null&&statuses.indexOf('data_missing')<0){var on=kpiXNum(rules.on_track_percent);on=on==null?95:on;var risk=kpiXNum(rules.at_risk_percent);risk=risk==null?85:risk;status=score>=on?'on_track':score>=risk?'at_risk':'off_track';}
  return {status:status,score:score==null?null:kpiXRound(score,0),indicators:snapshots};
}
function kpiXCompute(month){
  if(month==null)month=kpiXCompilationMonth();
  (typeof kpiKPIs!=='undefined'?kpiKPIs:[]).forEach(function(k){var snap=kpiXKpiSnapshot(k,month);k._kpiX=snap;k._computed_status=snap.status;});
}
function kpiXStatusLabel(status){return {on_track:'On Track',at_risk:'At Risk',off_track:'Off Track',data_missing:'Data Missing',in_progress:'In Progress',not_started:'Not Started',not_due:'Not Due'}[status]||'Not Started';}
function kpiXStatusHtml(status){
  var icon={on_track:'ti-circle-check',at_risk:'ti-alert-triangle',off_track:'ti-circle-x',data_missing:'ti-help-circle',in_progress:'ti-progress',not_started:'ti-clock',not_due:'ti-calendar-time'}[status]||'ti-clock';
  return '<span class="kpi-x-status '+kpiXEsc(status)+'"><i class="ti '+icon+'"></i>'+kpiXEsc(kpiXStatusLabel(status))+'</span>';
}
function kpiXMetrics(){
  kpiXCompute();
  var kpis=typeof kpiKPIs!=='undefined'?kpiKPIs:[],total=kpis.length;
  var count=function(status){return kpis.filter(function(k){return k._computed_status===status;}).length;};
  var scores=kpis.map(function(k){return k._kpiX&&k._kpiX.score;}).filter(function(x){return x!=null;});
  return {total:total,on_track:count('on_track'),at_risk:count('at_risk'),off_track:count('off_track'),data_missing:count('data_missing'),achievement:scores.length?kpiXRound(scores.reduce(function(a,b){return a+b;},0)/scores.length,0):0};
}
function kpiXVarianceText(ind,snapshot){
  if(!snapshot||snapshot.actual==null)return '—';
  var op=String(ind.target_operator||'gte'),target=kpiXNum(ind.target_value),unit=ind.unit||'';
  if(op==='trend_up'||op==='trend_down')return (snapshot.variance>0?'+':'')+snapshot.variance+(unit?' '+unit:'');
  if(op==='between')return snapshot.status==='on_track'?'In range':'Outside range';
  if(target==null)return '—';
  var value=kpiXRound(snapshot.actual-target,1);
  return (value>0?'+':'')+value+(unit?' '+unit:'');
}
function kpiXSpark(ind){
  var vals=[];for(var m=1;m<=12;m++){var row=((kpiMonthlyData[ind.id]||{})[m]);vals.push(row&&kpiXNum(row.actual));}
  var clean=vals.filter(function(v){return v!=null;});if(clean.length<2)return '<span style="color:#94a3b8">—</span>';
  var min=Math.min.apply(null,clean),max=Math.max.apply(null,clean),range=Math.max(max-min,1),points=[];
  vals.forEach(function(v,i){if(v!=null)points.push((3+i*6.1).toFixed(1)+','+(21-(v-min)/range*17).toFixed(1));});
  var last=clean[clean.length-1],prev=clean[clean.length-2],color=last>=prev?'#0f9f70':'#dc2626';
  return '<svg class="kpi-x-spark" viewBox="0 0 74 24"><polyline points="'+points.join(' ')+'" fill="none" stroke="'+color+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
function kpiXFilteredKpis(){
  var rows=(typeof kpiKPIs!=='undefined'?kpiKPIs:[]).slice();
  return rows.filter(function(k){
    if(kpiXState.status!=='all'&&k._computed_status!==kpiXState.status)return false;
    if(kpiXState.objective!=='all'&&String(k.objective_id)!==String(kpiXState.objective))return false;
    if(kpiXState.owner!=='all'&&kpiXOwner(k)!==kpiXState.owner)return false;
    if(kpiXState.frequency!=='all'&&String(k.frequency||'monthly').toLowerCase()!==kpiXState.frequency)return false;
    if(kpiXState.search&&String((k.code||'')+' '+(k.name||'')+' '+kpiXOwner(k)).toLowerCase().indexOf(kpiXState.search)<0)return false;
    return true;
  });
}
function kpiXRefreshFilters(){
  var objective=document.getElementById('kpi-x-objective'),owner=document.getElementById('kpi-x-owner');
  if(objective){objective.innerHTML='<option value="all">All Objectives</option>'+kpiObjectives.map(function(o){return '<option value="'+kpiXEsc(o.id)+'">'+kpiXEsc((o.code||'')+' '+o.name)+'</option>';}).join('');objective.value=kpiXState.objective;}
  if(owner){var owners=[];kpiKPIs.forEach(function(k){var value=kpiXOwner(k);if(owners.indexOf(value)<0)owners.push(value);});owner.innerHTML='<option value="all">All KPI Owners</option>'+owners.sort().map(function(x){return '<option>'+kpiXEsc(x)+'</option>';}).join('');owner.value=kpiXState.owner;}
}
function kpiXMetricCard(label,value,sub,status,icon){return '<button type="button" class="kpi-x-metric" data-status="'+status+'" data-auris-module-onclick="d0001" data-auris-module-args="'+encodeURIComponent(JSON.stringify([status]))+'"><span class="kpi-x-metric-icon"><i class="ti '+icon+'"></i></span><span class="kpi-x-metric-label">'+kpiXEsc(label)+'</span><strong class="kpi-x-metric-value">'+kpiXEsc(value)+'</strong><span class="kpi-x-metric-sub">'+kpiXEsc(sub)+'</span></button>';}
function kpiXTrendSvg(){
  var monthScores=[],compilationMonth=kpiXCompilationMonth();
  for(var month=1;month<=12;month++){
    var scores=[];if(month<=compilationMonth)kpiIndicators.forEach(function(ind){var snap=kpiXIndicatorSnapshot(ind,month);if(snap.score!=null)scores.push(snap.score);});
    monthScores.push(scores.length?kpiXRound(scores.reduce(function(a,b){return a+b;},0)/scores.length,0):null);
  }
  var points=[];monthScores.forEach(function(v,i){if(v!=null)points.push((22+i*39).toFixed(1)+','+(152-v*1.16).toFixed(1));});
  return '<svg class="kpi-x-trend" viewBox="0 0 470 180" preserveAspectRatio="none"><g stroke="#e2e8f0" stroke-width="1"><line x1="22" y1="152" x2="452" y2="152"/><line x1="22" y1="94" x2="452" y2="94"/><line x1="22" y1="36" x2="452" y2="36"/><line x1="22" y1="47.6" x2="452" y2="47.6" stroke="#2563eb" stroke-dasharray="5 4"/></g><polyline points="'+points.join(' ')+'" fill="none" stroke="#0f8a64" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'+monthScores.map(function(v,i){return v==null?'':'<circle cx="'+(22+i*39).toFixed(1)+'" cy="'+(152-v*1.16).toFixed(1)+'" r="3" fill="#0f8a64"><title>'+KPI_X_MONTHS[i]+': '+v+'%</title></circle>';}).join('')+'<g fill="#64748b" font-size="9" text-anchor="middle">'+KPI_X_MONTHS.map(function(m,i){return '<text x="'+(22+i*39).toFixed(1)+'" y="174">'+m+'</text>';}).join('')+'</g></svg>';
}
function kpiXRenderDashboard(){
  var box=document.getElementById('kpi-x-dashboard');if(!box)return;
  var metrics=kpiXMetrics(),attention=kpiKPIs.filter(function(k){return ['off_track','at_risk','data_missing'].indexOf(k._computed_status)>=0;}).sort(function(a,b){return ({off_track:0,data_missing:1,at_risk:2}[a._computed_status])-({off_track:0,data_missing:1,at_risk:2}[b._computed_status]);});
  var missing=metrics.data_missing,exceptions=metrics.at_risk+metrics.off_track;
  var objectiveRows=kpiObjectives.map(function(obj){var rows=kpiKPIs.filter(function(k){return k.objective_id===obj.id&&k._kpiX&&k._kpiX.score!=null;}),score=rows.length?kpiXRound(rows.reduce(function(s,k){return s+k._kpiX.score;},0)/rows.length,0):0,color=score>=95?'#0f8a64':score>=85?'#f59e0b':'#dc2626';return '<div class="kpi-x-objective-row" data-auris-module-onclick="d0002" data-auris-module-args="'+encodeURIComponent(JSON.stringify([kpiXEsc(obj.id)]))+'" style="cursor:pointer"><strong>'+kpiXEsc(obj.name)+'</strong><span class="kpi-x-bar"><i style="width:'+score+'%;background:'+color+'"></i></span><strong>'+score+'%</strong></div>';}).join('');
  var priority=attention.slice(0,6).map(function(k,i){return '<div class="kpi-x-priority-row" data-auris-module-onclick="d0003" data-auris-module-args="'+encodeURIComponent(JSON.stringify([kpiXEsc(k.id)]))+'"><span class="kpi-x-priority-rank">'+(i+1)+'</span><span><strong>'+kpiXEsc(k.name)+'</strong><small style="display:block;color:#64748b">'+kpiXEsc(kpiXOwner(k))+'</small></span>'+kpiXStatusHtml(k._computed_status)+'</div>';}).join('')||'<div class="kpi-x-empty">No KPI currently requires attention.</div>';
  box.innerHTML='<div id="kpi-metrics" class="kpi-x-metrics">'+
    kpiXMetricCard('Overall Achievement',metrics.achievement+'%','Calculated from reported indicators','all','ti-target-arrow')+
    kpiXMetricCard('On Track',metrics.on_track,'KPIs meeting target','on_track','ti-trending-up')+
    kpiXMetricCard('At Risk',metrics.at_risk,'Within the warning band','at_risk','ti-alert-triangle')+
    kpiXMetricCard('Off Track',metrics.off_track,'Corrective action required','off_track','ti-circle-x')+
    kpiXMetricCard('Data Missing',metrics.data_missing,'Required period not reported','data_missing','ti-help-circle')+'</div>'+
    '<div class="kpi-x-alert"><i class="ti ti-alert-triangle" style="font-size:19px"></i><span><strong>'+exceptions+' KPI'+(exceptions===1?'':'s')+' require attention</strong> &nbsp;•&nbsp; '+missing+' missing submission'+(missing===1?'':'s')+' &nbsp;•&nbsp; Parent status uses the worst indicator result</span><button class="kpi-x-btn" data-auris-module-onclick="d0004">Review Exceptions <i class="ti ti-arrow-right"></i></button></div>'+
    '<div class="kpi-x-grid"><section class="kpi-x-panel"><div class="kpi-x-panel-title">Overall Performance Trend <span class="kpi-x-panel-sub">Actual achievement · target 90%</span></div>'+kpiXTrendSvg()+'</section><section class="kpi-x-panel"><div class="kpi-x-panel-title">Performance by Objective</div>'+objectiveRows+'</section><section class="kpi-x-panel"><div class="kpi-x-panel-title">Priority Attention</div><div class="kpi-x-priority">'+priority+'</div></section></div>'+
    '<div class="kpi-x-grid two"><section class="kpi-x-panel"><div class="kpi-x-panel-title">Management Interpretation <button class="kpi-x-btn" style="height:29px" data-auris-module-onclick="d0005">Open scorecard</button></div><div style="font-size:12px;line-height:1.6;color:#475569">'+(metrics.off_track?'<strong style="color:#b91c1c">'+metrics.off_track+' KPI'+(metrics.off_track===1?' is':'s are')+' off track.</strong> Corrective action and root-cause explanation should be prioritised. ':metrics.at_risk?'<strong style="color:#a15800">No KPI is off track, but '+metrics.at_risk+' need early intervention.</strong> ':'<strong style="color:#087252">Reported KPIs are under control.</strong> ')+(metrics.data_missing?'Management confidence is reduced by '+metrics.data_missing+' missing result'+(metrics.data_missing===1?'':'s')+'.':'All required results for the reporting period are available.')+'</div></section><section class="kpi-x-panel"><div class="kpi-x-panel-title">Data Quality</div><div class="kpi-x-quality"><div><strong>'+(metrics.total-missing)+'/'+metrics.total+'</strong><span>Updated</span></div><div><strong style="color:#dc2626">'+missing+'</strong><span>Missing</span></div><div><strong>'+metrics.achievement+'%</strong><span>Achievement</span></div></div></section></div>';
}
function kpiXRenderScorecard(){
  var container=document.getElementById('kpi-objectives-container');if(!container)return;
  kpiXCompute();var filtered=kpiXFilteredKpis(),preferences=kpiXColumnPreferences(),columns=KPI_X_COLUMNS.filter(function(column){return preferences[column.key];}),columnCount=columns.length+1;
  var chooser='<div class="kpi-x-table-toolbar"><span><strong>'+filtered.length+'</strong> KPI'+(filtered.length===1?'':'s')+' shown</span><div class="kpi-x-column-control"><button type="button" class="kpi-x-column-button" data-kpi-column-toggle aria-haspopup="true" aria-expanded="false" aria-label="Choose scorecard columns" title="Choose scorecard columns"><i class="ti ti-adjustments-horizontal"></i></button><div class="kpi-x-column-menu" data-kpi-column-menu hidden><strong>Visible columns</strong><small>Objective / KPI / Indicator is always shown</small>'+KPI_X_COLUMNS.map(function(column){return '<label><input type="checkbox" data-kpi-column="'+column.key+'"'+(preferences[column.key]?' checked':'')+'><span>'+kpiXEsc(column.label)+'</span></label>';}).join('')+'</div></div></div>';
  var html=chooser+'<div class="kpi-x-table-wrap"><table class="kpi-x-table"><colgroup><col class="kpi-x-col-name">'+columns.map(function(column){return '<col class="'+column.className+'">';}).join('')+'</colgroup><thead><tr><th>Objective / KPI / Indicator</th>'+columns.map(function(column){return '<th data-kpi-col="'+column.key+'">'+kpiXEsc(column.label)+'</th>';}).join('')+'</tr></thead><tbody>';
  function cells(values){return columns.map(function(column){return '<td data-kpi-col="'+column.key+'">'+values[column.key]+'</td>';}).join('');}
  kpiObjectives.forEach(function(obj){
    var objKpis=filtered.filter(function(k){return String(k.objective_id)===String(obj.id);});if(!objKpis.length)return;
    var objScores=objKpis.map(function(k){return k._kpiX.score;}).filter(function(x){return x!=null;}),objScore=objScores.length?kpiXRound(objScores.reduce(function(a,b){return a+b;},0)/objScores.length,0):0;
    html+='<tr class="objective"><td colspan="'+columnCount+'"><div class="kpi-x-objective-heading"><span><span class="kpi-x-hierarchy-code">'+kpiXEsc(obj.code||'')+'</span>'+kpiXEsc(obj.name)+' <span class="kpi-x-objective-score">'+objScore+'%</span></span>'+(kpiXCanManage()?'<button type="button" class="kpi-x-row-edit" data-kpi-edit-objective="'+kpiXEsc(obj.id)+'" aria-label="Edit objective '+kpiXEsc(obj.name)+'" title="Edit objective"><i class="ti ti-pencil"></i></button>':'')+'</div></td></tr>';
    objKpis.forEach(function(k){
      var status=k._computed_status,inds=kpiIndicators.filter(function(ind){return String(ind.kpi_id)===String(k.id);});
      html+='<tr class="kpi-row" data-auris-module-onclick="d0003" data-auris-module-args="'+encodeURIComponent(JSON.stringify([kpiXEsc(k.id)]))+'"><td><div class="kpi-x-hierarchy kpi"><span class="kpi-x-hierarchy-code">'+kpiXEsc(k.code||'')+'</span><strong>'+kpiXEsc(k.name)+'</strong></div></td>'+cells({type:'<span class="kpi-x-type">KPI</span><small>'+kpiXEsc(k.frequency||'Monthly')+'</small>',target:'—',actual:k._kpiX.score==null?'—':'<strong>'+k._kpiX.score+'%</strong><small>Achievement</small>',variance:'—',trend:'—',owner:'<span class="kpi-x-owner">'+kpiXInitials(kpiXOwner(k))+'</span>'+kpiXEsc(kpiXOwner(k)),status:kpiXStatusHtml(status)})+'</tr>';
      inds.forEach(function(ind){
        var compilationMonth=kpiXCompilationMonth(),dueMonth=kpiXDueMonth(k,compilationMonth),snap=dueMonth?kpiXIndicatorSnapshot(ind,dueMonth):{status:'not_due',actual:null,variance:null},latest=kpiXLatestRow(ind.id,dueMonth||compilationMonth),ytd=latest&&latest.ytd!=null?latest.ytd:(latest&&latest.actual),classification=ind.indicator_type||ind.classification||ind.type||'Indicator';
        html+='<tr class="kpi-x-indicator-row" data-auris-module-onclick="d0003" data-auris-module-args="'+encodeURIComponent(JSON.stringify([kpiXEsc(k.id)]))+'"><td><div class="kpi-x-hierarchy indicator"><span class="kpi-x-hierarchy-code">'+kpiXEsc(ind.code||'•')+'</span><span>'+kpiXEsc(ind.name)+'</span></div></td>'+cells({type:'<span class="kpi-x-type">'+kpiXEsc(classification)+'</span>',target:'<strong>'+kpiXEsc(kpiXTargetText(ind))+'</strong>',actual:snap.actual==null?kpiXEsc(kpiXStatusLabel(snap.status)):'<strong>'+kpiXEsc(kpiXRound(snap.actual,2))+'</strong><small>YTD '+kpiXEsc(ytd==null?'—':kpiXRound(ytd,2))+'</small>',variance:kpiXEsc(kpiXVarianceText(ind,snap)),trend:kpiXSpark(ind),owner:kpiXEsc(kpiXOwner(k)),status:kpiXStatusHtml(snap.status)})+'</tr>';
      });
    });
  });
  html+='</tbody></table></div>';
  container.innerHTML=filtered.length?html:!kpiObjectives.length?'<div class="kpi-x-empty"><strong>No objectives set up for '+kpiXEsc(kpiXSelectedYear())+'.</strong><span>Create the first company objective before adding a KPI.</span>'+(kpiXCanManage()?'<button class="kpi-x-btn primary" data-auris-module-onclick="d0077"><i class="ti ti-plus"></i>New Objective</button>':'<small>Ask an HSE manager or administrator to create an objective.</small>')+'</div>':'<div class="kpi-x-empty">No KPI matches the selected filters.</div>';
  var toggle=container.querySelector('[data-kpi-column-toggle]'),menu=container.querySelector('[data-kpi-column-menu]');
  if(toggle&&menu)toggle.addEventListener('click',function(event){event.stopPropagation();menu.hidden=!menu.hidden;toggle.setAttribute('aria-expanded',String(!menu.hidden));});
  container.querySelectorAll('[data-kpi-column]').forEach(function(input){input.addEventListener('change',function(){preferences[input.getAttribute('data-kpi-column')]=input.checked;kpiXSaveColumnPreferences(preferences);kpiXRenderScorecard();});});
  container.querySelectorAll('[data-kpi-edit-objective]').forEach(function(button){button.addEventListener('click',function(event){event.preventDefault();event.stopPropagation();kpiXEditObjective(button.getAttribute('data-kpi-edit-objective'));});});
}
function kpiXAggregateRows(ind,months){
  var rows=months.map(function(m){return ((kpiMonthlyData[ind.id]||{})[m]);}).filter(Boolean);if(!rows.length)return null;
  var vals=rows.map(function(r){return kpiXNum(r.actual);}).filter(function(v){return v!=null;});if(!vals.length)return null;
  var method=ind.ytd_method||'sum',value=method==='average'?vals.reduce(function(a,b){return a+b;},0)/vals.length:method==='last'?vals[vals.length-1]:method==='max'?Math.max.apply(null,vals):method==='min'?Math.min.apply(null,vals):vals.reduce(function(a,b){return a+b;},0);
  return {actual:kpiXRound(value,2),month:months[months.length-1]};
}
function kpiXRenderMonthly(){
  var table=document.getElementById('kpi-monthly-table'),body=document.getElementById('kpi-monthly-body');if(!table||!body)return;kpiXCompute();
  var period=kpiXState.period,groups=period==='quarterly'?[[1,2,3],[4,5,6],[7,8,9],[10,11,12]]:period==='annual'?[KPI_X_MONTHS.map(function(_,i){return i+1;})]:KPI_X_MONTHS.map(function(_,i){return [i+1];}),labels=period==='quarterly'?['Q1','Q2','Q3','Q4']:period==='annual'?['Annual']:KPI_X_MONTHS;
  table.querySelector('thead').innerHTML='<tr><th class="kpi-x-sticky-1">Code</th><th class="kpi-x-sticky-2">KPI</th><th class="kpi-x-sticky-3">Measurement Indicator</th><th>Unit</th><th>Direction</th><th>Target</th>'+labels.map(function(x){return '<th style="text-align:center">'+x+'</th>';}).join('')+'<th>YTD</th><th>Variance</th><th>Trend</th><th>Status</th><th>Actions</th></tr>';
  var html='',monthNow=kpiXReportingMonth(),compilationMonth=kpiXCompilationMonth();
  kpiObjectives.forEach(function(obj){var rows=kpiXFilteredKpis().filter(function(k){return String(k.objective_id)===String(obj.id);});if(!rows.length)return;html+='<tr><td colspan="'+(11+groups.length)+'" style="background:#eff8f5!important;color:#087252;font-weight:800">'+kpiXEsc((obj.code||'')+'. '+obj.name)+'</td></tr>';rows.forEach(function(k){var inds=kpiIndicators.filter(function(ind){return String(ind.kpi_id)===String(k.id);});inds.forEach(function(ind,index){var current=compilationMonth?kpiXIndicatorSnapshot(ind,compilationMonth):{status:'not_due',actual:null,variance:null},direction=kpiXDirection(ind);html+='<tr data-kpi-id="'+kpiXEsc(k.id)+'"><td class="kpi-x-sticky-1">'+(index===0?kpiXEsc(k.code||''):'')+'</td><td class="kpi-x-sticky-2">'+(index===0?'<strong>'+kpiXEsc(k.name)+'</strong>':'')+'</td><td class="kpi-x-sticky-3">'+kpiXEsc(ind.name)+'</td><td>'+kpiXEsc(ind.unit||'count')+'</td><td>'+direction.arrow+'</td><td><strong>'+kpiXEsc(kpiXTargetText(ind))+'</strong></td>';
      groups.forEach(function(months){var lastMonth=months[months.length-1],future=months[0]>monthNow,open=!future&&lastMonth>compilationMonth,applicable=period!=='monthly'||kpiXIsDue(k,lastMonth),row=applicable?(period==='monthly'?((kpiMonthlyData[ind.id]||{})[lastMonth]):kpiXAggregateRows(ind,months)):null,evaluation=!applicable?{status:'not_due'}:row?kpiXEvaluate(ind,row.actual,(kpiXPreviousRow(ind.id,months[0])||{}).actual):{status:future?'not_due':open?'in_progress':'data_missing'};var text=!applicable?'N/A':future?'Not Due':row?kpiXRound(row.actual,2):open?'In Progress':'No Data';html+='<td class="kpi-x-cell '+evaluation.status+'" '+(applicable&&!future&&kpiCanEdit()?'onclick="kpiOpenEntry(\''+kpiXEsc(ind.id)+'\',\''+kpiXEsc(k.id)+'\','+lastMonth+')"':'')+'>'+kpiXEsc(text)+'</td>';});
      var latest=kpiXLatestRow(ind.id,compilationMonth),ytd=latest&&latest.ytd!=null?latest.ytd:(latest&&latest.actual);html+='<td><strong>'+(ytd==null?'—':kpiXEsc(kpiXRound(ytd,2)))+'</strong></td><td>'+kpiXEsc(kpiXVarianceText(ind,current))+'</td><td>'+kpiXSpark(ind)+'</td><td>'+kpiXStatusHtml(current.status)+'</td><td><button class="kpi-x-icon-btn" data-auris-module-onclick="d0003" data-auris-module-args="'+encodeURIComponent(JSON.stringify([kpiXEsc(k.id)]))+'"><i class="ti ti-dots"></i></button></td></tr>';});});});
  body.innerHTML=html||'<tr><td colspan="20" class="kpi-x-empty">No KPI data is available.</td></tr>';
  kpiXRenderCycleBanner();
}
function kpiXRenderCycleBanner(){
  var host=document.getElementById('kpi-x-cycle');if(!host)return;var month=kpiXReportingMonth()||1,dueIndicators=kpiIndicators.filter(function(ind){var k=kpiKPIs.find(function(item){return String(item.id)===String(ind.kpi_id);});return kpiXIsDue(k,month);}),total=dueIndicators.length,complete=dueIndicators.filter(function(ind){return !!((kpiMonthlyData[ind.id]||{})[month]);}).length,pct=total?Math.round(complete/total*100):100,missing=Math.max(0,total-complete);
  host.innerHTML='<i class="ti ti-info-circle"></i><strong>'+KPI_X_MONTHS[month-1]+' '+kpiXSelectedYear()+' reporting cycle</strong><span>'+complete+' of '+total+' indicators completed</span><span>• '+missing+' pending</span><span class="kpi-x-cycle-progress"><i style="width:'+pct+'%"></i></span><strong>'+pct+'%</strong><button class="kpi-x-btn" style="height:29px;margin-left:auto" data-auris-module-onclick="d0006">Review overdue</button>';
}
function kpiXRenderActions(){
  var host=document.getElementById('kpi-x-actions-view');if(!host)return;kpiXCompute();var affected=kpiKPIs.filter(function(k){return ['at_risk','off_track'].indexOf(k._computed_status)>=0;});host.innerHTML='<div class="kpi-x-panel"><div class="kpi-x-panel-title">KPI Recovery & Improvement Actions <span class="kpi-x-panel-sub">Uses the existing Master Action Plan workflow</span></div>'+ (affected.length?affected.map(function(k){return '<div class="kpi-x-priority-row"><span class="kpi-x-priority-rank"><i class="ti ti-alert-triangle"></i></span><span><strong>'+kpiXEsc(k.name)+'</strong><small style="display:block;color:#64748b">Owner: '+kpiXEsc(kpiXOwner(k))+' · '+kpiXStatusLabel(k._computed_status)+'</small></span><button class="kpi-x-btn primary" style="height:31px" data-auris-module-onclick="d0007" data-auris-module-args="'+encodeURIComponent(JSON.stringify([kpiXEsc(k.id)]))+'"><i class="ti ti-plus"></i>Create Action</button></div>';}).join(''):'<div class="kpi-x-empty">No KPI currently requires a recovery action.</div>')+'</div>';
}
function kpiXRenderReports(){
  var host=document.getElementById('kpi-x-reports-view');if(!host)return;var m=kpiXMetrics();host.innerHTML='<div class="kpi-x-grid two"><section class="kpi-x-panel"><div class="kpi-x-panel-title">Management Performance Report</div><p style="font-size:12px;color:#475569;line-height:1.6">Generate the existing printable scorecard or export the complete KPI register with current results, variance, ownership and status.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="kpi-x-btn primary" data-auris-module-onclick="d0008"><i class="ti ti-printer"></i>Print Report</button><button class="kpi-x-btn" data-auris-module-onclick="d0009"><i class="ti ti-download"></i>Export CSV</button></div></section><section class="kpi-x-panel"><div class="kpi-x-panel-title">Year Summary</div><div class="kpi-x-quality"><div><strong>'+m.achievement+'%</strong><span>Achievement</span></div><div><strong>'+m.on_track+'</strong><span>On Track</span></div><div><strong style="color:#dc2626">'+m.off_track+'</strong><span>Off Track</span></div></div></section></div>';
}
function kpiXRenderConfig(){
  if(typeof window.kpiConfigRender==='function'){window.kpiConfigRender();return;}
  var host=document.getElementById('kpi-x-config-view');if(!host)return;host.innerHTML='<div class="kpi-x-config"><aside class="kpi-x-panel kpi-x-config-nav"><button class="active"><i class="ti ti-adjustments"></i> Targets & Status Rules</button><button><i class="ti ti-calendar"></i> Reporting Cycles</button><button><i class="ti ti-database"></i> Data Sources</button><button><i class="ti ti-users"></i> Workflow & Approvals</button><button><i class="ti ti-bell"></i> Notifications</button><button><i class="ti ti-lock"></i> Permissions</button></aside><section class="kpi-x-panel"><div class="kpi-x-panel-title">Targets & Status Rules</div><p style="font-size:11px;color:#64748b">Rules are evaluated per indicator. A critical failure cannot be hidden by averaging: the parent KPI inherits the worst indicator status.</p>'+[
    ['Equal to / Zero tolerance','Actual must equal the target. Any non-zero result against a zero target is Off Track.','=', 'Off Track override'],['Greater than or equal','Actual at or above target is On Track; within 10% is At Risk.','≥','Standard'],['Less than or equal','Actual at or below target is On Track; within 10% above is At Risk.','≤','Standard'],['Between','Supported when a maximum threshold is available in the data model.','↔','Schema dependent'],['Improving / reducing trend','Compares the current period with the previous reported period.','↗','Trend based']].map(function(r){return '<div class="kpi-x-rule"><strong>'+r[0]+'</strong><span>'+r[1]+'</span><span style="text-align:center"><b>'+r[2]+'</b><small style="display:block;color:#64748b">'+r[3]+'</small></span></div>';}).join('')+'<div style="margin-top:14px;padding:10px;border:1px solid #fed7aa;background:#fff7ed;border-radius:8px;font-size:11px;color:#9a4d05"><strong>Important:</strong> Between-range thresholds and durable submission/approval locks require database fields that are not present in the current deployed schema. The interface does not pretend those controls are persisted.</div></section><aside class="kpi-x-panel"><div class="kpi-x-panel-title">Rule Preview</div><div class="kpi-x-kv"><span>Example KPI</span><span>Lost Time Injuries</span></div><div class="kpi-x-kv"><span>Direction</span><span>↓ Lower is better</span></div><div class="kpi-x-kv"><span>Target</span><span>0 · zero tolerance</span></div><div class="kpi-x-kv"><span>Actual</span><span>1</span></div><div style="margin-top:16px;text-align:center">'+kpiXStatusHtml('off_track')+'</div></aside></div>';
}
function kpiXRefreshCreationActions(){var allowed=typeof isMgr==='function'&&isMgr(),objective=document.getElementById('kpi-x-new-objective'),kpi=document.getElementById('kpi-x-new-kpi'),importPdf=document.getElementById('kpi-x-import-pdf');if(objective)objective.hidden=!allowed;if(importPdf)importPdf.hidden=!allowed;if(kpi){kpi.disabled=!allowed||!kpiObjectives.length;kpi.title=!allowed?'Only authorised managers and administrators can create KPIs.':!kpiObjectives.length?'Create an objective before adding a KPI.':'Create KPI';}}
function kpiXRefreshHeader(){var label=document.getElementById('kpi-co-label');if(label)label.textContent='Company performance';kpiXRefreshCreationActions();}
function kpiXOpenNewObjective(){if(!(typeof isMgr==='function'&&isMgr())){if(typeof toast==='function')toast('Only authorised managers and administrators can create objectives.',false);return;}if(typeof openObjModal!=='function'){if(typeof toast==='function')toast('The objective editor is unavailable. Refresh the page and try again.',false);return;}openObjModal(null);var year=document.getElementById('obj-year');if(year)year.value=String(kpiXSelectedYear());}
function kpiXOpenNewKpi(){if(!(typeof isMgr==='function'&&isMgr())){if(typeof toast==='function')toast('Only authorised managers and administrators can create KPIs.',false);return;}if(!kpiObjectives.length){if(typeof toast==='function')toast('Create an objective before adding a KPI.',false);kpiXOpenNewObjective();return;}openKpiAddModal();}
function kpiXEditObjective(objectiveId){if(!kpiXCanManage()){if(typeof toast==='function')toast('Only authorised managers and administrators can edit objectives.',false);return;}if(typeof openObjModal!=='function'){if(typeof toast==='function')toast('The objective editor is unavailable. Refresh the page and try again.',false);return;}openObjModal(objectiveId);}
function kpiXEditKpi(kpiId){if(!kpiXCanManage()){if(typeof toast==='function')toast('Only authorised managers and administrators can edit KPIs.',false);return;}var k=kpiKPIs.find(function(item){return String(item.id)===String(kpiId);});if(!k||typeof openKpiAddModal!=='function'){if(typeof toast==='function')toast('The KPI editor is unavailable. Refresh the page and try again.',false);return;}var drawer=document.getElementById('kpi-x-drawer');if(drawer)drawer.remove();openKpiAddModal(k.id,k.objective_id);}
function kpiXRenderAll(){kpiXRefreshHeader();kpiXRefreshFilters();kpiXRenderDashboard();kpiXRenderScorecard();kpiXRenderMonthly();kpiXRenderActions();kpiXRenderReports();kpiXRenderConfig();}
function kpiXSwitchTab(tab){
  kpiXState.tab=tab;sessionStorage.setItem('auris-kpi-active-tab',tab);document.querySelectorAll('#page-kpi .kpi-x-view').forEach(function(view){var active=view.getAttribute('data-kpi-view')===tab;view.hidden=!active;view.style.display=active?'block':'none';});document.querySelectorAll('#page-kpi .kpi-tab').forEach(function(btn){btn.classList.toggle('active',btn.getAttribute('data-tab')===tab);});var title=document.querySelector('#page-kpi .kpi-x-title'),label={dashboard:'Dashboard',scorecard:'KPI Scorecard',monthly:'Monthly Follow-up',actions:'Action Plans',reports:'Reports',configuration:'Configuration'}[tab]||'KPI Scorecard';if(title)title.textContent='Objectives & KPIs / '+label;var filters=document.getElementById('kpi-x-filters'),importPdf=document.getElementById('kpi-x-import-pdf'),newObjective=document.getElementById('kpi-x-new-objective'),newKpi=document.getElementById('kpi-x-new-kpi'),submit=document.getElementById('kpi-x-submit-month'),exportButton=document.getElementById('kpi-x-export'),showCreate=['dashboard','scorecard'].indexOf(tab)>=0;if(filters)filters.style.display=['scorecard','monthly'].indexOf(tab)>=0?'grid':'none';if(importPdf)importPdf.style.display=showCreate?'':'none';if(newObjective)newObjective.style.display=showCreate?'':'none';if(newKpi)newKpi.style.display=showCreate?'':'none';if(submit){submit.style.display=tab==='monthly'?'':'none';submit.innerHTML='<i class="ti ti-circle-check"></i>Submit '+KPI_X_MONTHS[(kpiXReportingMonth()||1)-1];}if(exportButton)exportButton.style.display=['dashboard','scorecard','reports'].indexOf(tab)>=0?'':'none';kpiXRefreshHeader();
  if(tab==='dashboard')kpiXRenderDashboard();else if(tab==='scorecard')kpiXRenderScorecard();else if(tab==='monthly')kpiXRenderMonthly();else if(tab==='actions')kpiXRenderActions();else if(tab==='reports')kpiXRenderReports();else if(tab==='configuration')kpiXRenderConfig();
}
function kpiXInstall(){
  var page=document.getElementById('page-kpi');if(!page||page.dataset.kpiXInstalled)return;page.dataset.kpiXInstalled='1';page.classList.add('kpi-x-page');
  var header=page.querySelector('.kpi-page-header'),tabs=page.querySelector('.kpi-tab')&&page.querySelector('.kpi-tab').parentElement,metrics=document.getElementById('kpi-metrics'),overview=document.getElementById('kpi-tab-overview'),monthly=document.getElementById('kpi-tab-monthly');if(!header||!tabs||!overview||!monthly)return;
  var selectedYear=(document.getElementById('year-sel')&&document.getElementById('year-sel').value)||String(new Date().getFullYear());
  header.className='kpi-x-header';header.innerHTML='<div><div class="kpi-x-title">Objectives & KPIs</div><div class="kpi-x-company" id="kpi-co-label"></div></div><div class="kpi-x-actions"><select id="year-sel" aria-label="Reporting year" data-auris-module-onchange="d0010" style="height:38px;border:1px solid #d9e1ea;border-radius:9px;padding:0 10px;background:#fff"><option>2024</option><option>2025</option><option>2026</option><option>2027</option><option>2028</option></select><button id="kpi-x-import-pdf" class="kpi-x-btn" type="button"><i class="ti ti-file-upload"></i>Import PDF</button><button id="kpi-x-new-objective" class="kpi-x-btn" data-auris-module-onclick="d0077"><i class="ti ti-target-arrow"></i>New Objective</button><button id="kpi-x-new-kpi" class="kpi-x-btn primary" data-auris-module-onclick="d0011"><i class="ti ti-plus"></i>New KPI</button><button id="kpi-x-submit-month" class="kpi-x-btn" data-auris-module-onclick="d0012"><i class="ti ti-circle-check"></i>Submit Month</button><button id="kpi-x-export" class="kpi-x-btn" data-auris-module-onclick="d0009"><i class="ti ti-download"></i>Export Report</button></div>';document.getElementById('year-sel').value=selectedYear;
  var filter=document.createElement('div');filter.id='kpi-x-filters';filter.className='kpi-x-filters';filter.setAttribute('aria-label','KPI filters');filter.innerHTML='<div class="kpi-x-field"><label>Search</label><input id="kpi-x-search" placeholder="Search KPIs..." data-auris-module-oninput="d0013"></div><div class="kpi-x-field"><label>Objective</label><select id="kpi-x-objective" data-auris-module-onchange="d0014"><option value="all">All Objectives</option></select></div><div class="kpi-x-field"><label>KPI Owner</label><select id="kpi-x-owner" data-auris-module-onchange="d0015"><option value="all">All KPI Owners</option></select></div><div class="kpi-x-field"><label>Status</label><select id="kpi-x-status" data-auris-module-onchange="d0016"><option value="all">All Statuses</option><option value="on_track">On Track</option><option value="at_risk">At Risk</option><option value="off_track">Off Track</option><option value="data_missing">Data Missing</option></select></div><div class="kpi-x-field"><label>Frequency</label><select id="kpi-x-frequency" data-auris-module-onchange="d0017"><option value="all">All Frequencies</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option></select></div><button class="kpi-x-btn" data-auris-module-onclick="d0018"><i class="ti ti-refresh"></i>Reset</button>';
  tabs.className='kpi-x-tabs';tabs.innerHTML=[['dashboard','Dashboard'],['scorecard','KPI Scorecard'],['monthly','Monthly Follow-up'],['actions','Action Plans'],['reports','Reports'],['configuration','Configuration']].map(function(item){return '<button class="kpi-tab" data-tab="'+item[0]+'" data-auris-module-onclick="d0019" data-auris-module-args="'+encodeURIComponent(JSON.stringify([item[0]]))+'">'+item[1]+'</button>';}).join('');
  if(metrics)metrics.remove();
  var dashboard=document.createElement('div');dashboard.id='kpi-x-dashboard';dashboard.className='kpi-x-view';dashboard.setAttribute('data-kpi-view','dashboard');tabs.insertAdjacentElement('afterend',dashboard);
  tabs.insertAdjacentElement('afterend',filter);
  overview.classList.add('kpi-x-view');overview.setAttribute('data-kpi-view','scorecard');monthly.classList.add('kpi-x-view');monthly.setAttribute('data-kpi-view','monthly');
  var monthlyCard=monthly.querySelector('.card');if(monthlyCard){var oldHead=monthlyCard.firstElementChild;if(oldHead)oldHead.remove();var cycle=document.createElement('div');cycle.id='kpi-x-cycle';cycle.className='kpi-x-cycle';monthlyCard.insertAdjacentElement('beforebegin',cycle);var toolbar=document.createElement('div');toolbar.className='kpi-x-month-toolbar';toolbar.innerHTML='<div><strong>Monthly Data Entry & Validation — <span id="kpi-monthly-year">'+kpiXSelectedYear()+'</span></strong><small style="display:block;color:#64748b;margin-top:2px">The current month is In Progress; only overdue prior periods are Data Missing.</small></div><div class="kpi-x-period"><button class="active" data-period="monthly" data-auris-module-onclick="d0020">Monthly</button><button data-period="quarterly" data-auris-module-onclick="d0021">Quarterly</button><button data-period="annual" data-auris-module-onclick="d0022">Annual</button></div>';monthlyCard.insertAdjacentElement('afterbegin',toolbar);var workflow=document.createElement('div');workflow.className='kpi-x-workflow';workflow.innerHTML='<span class="active"><i class="ti ti-shield-check"></i>Governed per KPI</span><span>Open a KPI to submit, verify, approve or lock its definition.</span>';monthlyCard.appendChild(workflow);}
  [['kpi-x-actions-view','actions'],['kpi-x-reports-view','reports'],['kpi-x-config-view','configuration']].forEach(function(item){var el=document.createElement('div');el.id=item[0];el.className='kpi-x-view';el.setAttribute('data-kpi-view',item[1]);monthly.insertAdjacentElement('afterend',el);});
  kpiXEnhanceEntryModal();kpiXEnhanceKpiModal();var savedTab=sessionStorage.getItem('auris-kpi-active-tab');kpiXSwitchTab(['dashboard','scorecard','monthly','actions','reports','configuration'].indexOf(savedTab)>=0?savedTab:'scorecard');
}
function kpiXEnhanceEntryModal(){
  var modal=document.getElementById('kpi-entry-modal'),comment=document.getElementById('entry-comment');if(!modal||!comment||document.getElementById('entry-root-cause'))return;var label=comment.parentElement&&comment.parentElement.querySelector('label');if(label)label.textContent='Performance explanation';comment.placeholder='Explain the result and factors affecting performance...';comment.parentElement.insertAdjacentHTML('afterend','<div class="kpi-x-exception-fields"><div><label class="form3label">Root cause</label><textarea id="entry-root-cause" placeholder="What caused this result?"></textarea></div><div><label class="form3label">Evidence reference</label><input id="entry-evidence" placeholder="Document, inspection, incident or action reference"></div></div><div class="kpi-x-preview" id="kpi-x-entry-preview"><div>Target<strong>—</strong></div><div>Variance<strong>—</strong></div><div>Status<strong>—</strong></div></div>');
}
function kpiXEnhanceKpiModal(){
  var modal=document.getElementById('kpi-edit-modal'),status=document.getElementById('kpi-status');if(!modal||!status)return;
  status.disabled=true;status.title='Status is calculated from indicator results';var label=status.parentElement&&status.parentElement.querySelector('label');if(label)label.textContent='Calculated status';
  if(!document.getElementById('kpi-description')){
    var row=status.closest('.form3row')||status.parentElement;
    row.insertAdjacentHTML('afterend','<section class="kpi-x-editor-meta" aria-label="KPI details and governance"><label class="full">Description<textarea id="kpi-description" maxlength="4000" placeholder="Purpose, scope and expected outcome"></textarea></label><label>Data provider<select id="kpi-data-provider"><option value="">Select person...</option></select></label><label>Data source<select id="kpi-data-source" required><option value="">Select data source...</option><option value="Manual">Manual entry</option><option value="AURIS module">AURIS module</option><option value="Evidence / document">Evidence / document</option></select></label><label>Reviewer<select id="kpi-reviewer"><option value="">Select person...</option></select></label><label>Approver<select id="kpi-approver"><option value="">Select person...</option></select></label><label class="full">Approval state<input id="kpi-approval-status" value="draft" readonly aria-readonly="true"><small>Read-only here. Submission, review and approval will be controlled by the governed KPI workflow.</small></label><div id="kpi-x-editor-draft-note" class="kpi-x-editor-draft-note full" hidden></div></section>');
  }
  if(!modal.dataset.kpiDraftBound){
    modal.dataset.kpiDraftBound='true';
    modal.addEventListener('input',kpiXCaptureEditorDraft);
    modal.addEventListener('change',kpiXCaptureEditorDraft);
    modal.addEventListener('click',function(){setTimeout(kpiXCaptureEditorDraft,0);});
  }
}
function kpiXEditorDraftKey(kpiId){
  var company='company',user='user';try{company=typeof ccid==='function'?(ccid()||company):(prof&&prof.company_id)||company;}catch(e){}try{user=(prof&&prof.id)||user;}catch(e){}
  return 'auris-kpi-editor-draft:'+company+':'+user+':'+kpiXSelectedYear()+':'+(kpiId||'new');
}
function kpiXCaptureEditorDraft(){
  var modal=document.getElementById('kpi-edit-modal');if(!modal||modal.style.display==='none')return;
  var fieldIds=['kpi-obj-sel','kpi-code','kpi-name','kpi-description','kpi-freq','kpi-resp','kpi-data-provider','kpi-data-source','kpi-reviewer','kpi-approver'];
  var fields={};fieldIds.forEach(function(id){var el=document.getElementById(id);if(el)fields[id]=el.value;});
  var indicators=Array.from(document.querySelectorAll('#kpi-indicators-list [data-ind-row]')).map(function(row){function value(selector){var el=row.querySelector(selector);return el?el.value:'';}return {name:value('.ind-name-input'),target:value('.ind-target-input'),operator:value('.ind-op-input'),unit:value('.ind-unit-input'),ytd:value('.ind-ytd-input')};});
  try{sessionStorage.setItem(kpiXEditorDraftKey(typeof kpiEditKpiId!=='undefined'?kpiEditKpiId:null),JSON.stringify({savedAt:Date.now(),fields:fields,indicators:indicators}));}catch(e){}
  var note=document.getElementById('kpi-x-editor-draft-note');if(note){note.hidden=false;note.textContent='Unsaved changes are retained in this browser until the KPI is saved.';}
}
function kpiXRestoreEditorDraft(kpiId){
  var raw;try{raw=sessionStorage.getItem(kpiXEditorDraftKey(kpiId));}catch(e){return;}if(!raw)return;
  try{
    var draft=JSON.parse(raw);if(!draft.savedAt||Date.now()-draft.savedAt>86400000){kpiXClearEditorDraft(kpiId);return;}
    Object.keys(draft.fields||{}).forEach(function(id){var el=document.getElementById(id);if(el)el.value=draft.fields[id];});
    if(Array.isArray(draft.indicators)&&draft.indicators.length){var list=document.getElementById('kpi-indicators-list');if(list)list.innerHTML='';draft.indicators.forEach(function(ind){kpiAddIndicatorRow(ind.name,ind.target,ind.operator,ind.unit,ind.ytd);});}
    var note=document.getElementById('kpi-x-editor-draft-note');if(note){note.hidden=false;note.textContent='Recovered unsaved changes from this browser. Review them before saving.';}
  }catch(e){kpiXClearEditorDraft(kpiId);}
}
function kpiXClearEditorDraft(kpiId){try{sessionStorage.removeItem(kpiXEditorDraftKey(kpiId));}catch(e){}}
function kpiXOpenDrawerLegacy(kpiId){
  var k=kpiKPIs.find(function(x){return String(x.id)===String(kpiId);});if(!k)return;var old=document.getElementById('kpi-x-drawer');if(old)old.remove();var month=kpiXReportingMonth(),dueMonth=kpiXDueMonth(k,month),snapshot=kpiXKpiSnapshot(k,month),inds=kpiIndicators.filter(function(ind){return ind.kpi_id===k.id;});var drawer=document.createElement('div');drawer.id='kpi-x-drawer';drawer.className='kpi-x-drawer';drawer.onclick=function(e){if(e.target===drawer)drawer.remove();};drawer.innerHTML='<section class="kpi-x-drawer-card"><header class="kpi-x-drawer-head"><div><small style="color:#0f8a64;font-weight:800">'+kpiXEsc(k.code||'KPI')+'</small><h3>'+kpiXEsc(k.name)+'</h3><div style="margin-top:7px">'+kpiXStatusHtml(snapshot.status)+'</div></div><button class="kpi-x-icon-btn" data-auris-module-onclick="d0023"><i class="ti ti-x"></i></button></header><div class="kpi-x-drawer-body"><h4>Details</h4><div class="kpi-x-kv"><span>Description</span><span>'+kpiXEsc(k.description||k.purpose||'No description provided')+'</span></div><div class="kpi-x-kv"><span>KPI Owner</span><span>'+kpiXEsc(kpiXOwner(k))+'</span></div><div class="kpi-x-kv"><span>Data provider</span><span>'+kpiXEsc(k.data_owner||k.data_provider||'Not assigned')+'</span></div><div class="kpi-x-kv"><span>Frequency</span><span>'+kpiXEsc(k.frequency||'Monthly')+'</span></div><div class="kpi-x-kv"><span>Data source</span><span>'+kpiXEsc(k.data_source||'Manual / linked module not configured')+'</span></div><h4>Measurement Indicators</h4>'+inds.map(function(ind){var snap=dueMonth?kpiXIndicatorSnapshot(ind,dueMonth):{status:'not_due',actual:null};return '<div style="padding:10px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px"><strong style="font-size:12px">'+kpiXEsc(ind.name)+'</strong><div class="kpi-x-kv"><span>Target</span><span>'+kpiXEsc(kpiXTargetText(ind))+'</span></div><div class="kpi-x-kv"><span>Current result</span><span>'+(snap.actual==null?kpiXStatusLabel(snap.status):kpiXEsc(snap.actual+' '+(ind.unit||'')))+'</span></div><div class="kpi-x-kv"><span>Status</span><span>'+kpiXStatusLabel(snap.status)+'</span></div>'+kpiXSpark(ind)+'</div>';}).join('')+'<h4>Governance</h4><div class="kpi-x-kv"><span>Reviewer</span><span>'+kpiXEsc(k.reviewer||'Not assigned')+'</span></div><div class="kpi-x-kv"><span>Approver</span><span>'+kpiXEsc(k.approver||'Not assigned')+'</span></div><div class="kpi-x-kv"><span>Approval state</span><span>'+kpiXEsc(k.approval_status||'Draft')+'</span></div></div><footer class="kpi-x-drawer-actions"><button class="kpi-x-btn primary" data-auris-module-onclick="d0024" data-auris-module-args="'+encodeURIComponent(JSON.stringify([kpiXEsc(k.id)]))+'"><i class="ti ti-chart-bar"></i>Open Monthly Data</button>'+(['at_risk','off_track'].indexOf(snapshot.status)>=0?'<button class="kpi-x-btn" data-auris-module-onclick="d0007" data-auris-module-args="'+encodeURIComponent(JSON.stringify([kpiXEsc(k.id)]))+'"><i class="ti ti-plus"></i>Create Action</button>':'')+'</footer></section>';document.body.appendChild(drawer);
}
function kpiXOpenDrawer(kpiId){
  var k=kpiKPIs.find(function(item){return String(item.id)===String(kpiId);});if(!k)return;
  var old=document.getElementById('kpi-x-drawer');if(old)old.remove();
  var month=kpiXReportingMonth(),dueMonth=kpiXDueMonth(k,month),snapshot=kpiXKpiSnapshot(k,month),inds=kpiIndicators.filter(function(ind){return String(ind.kpi_id)===String(k.id);}),drawer=document.createElement('div');
  drawer.id='kpi-x-drawer';drawer.className='kpi-x-drawer';
  drawer.innerHTML='<section class="kpi-x-drawer-card" role="dialog" aria-modal="true" aria-label="KPI details"><header class="kpi-x-drawer-head"><div><small style="color:#0f8a64;font-weight:800">'+kpiXEsc(k.code||'KPI')+'</small><h3>'+kpiXEsc(k.name)+'</h3><div style="margin-top:7px">'+kpiXStatusHtml(snapshot.status)+'</div></div><button type="button" class="kpi-x-icon-btn" data-kpi-drawer-close aria-label="Close KPI details"><i class="ti ti-x"></i></button></header><div class="kpi-x-drawer-body"><h4>Details</h4><div class="kpi-x-kv"><span>Description</span><span>'+kpiXEsc(k.description||k.purpose||'No description provided')+'</span></div><div class="kpi-x-kv"><span>KPI Owner</span><span>'+kpiXEsc(kpiXOwner(k))+'</span></div><div class="kpi-x-kv"><span>Data provider</span><span>'+kpiXEsc(k.data_owner||k.data_provider||'Not assigned')+'</span></div><div class="kpi-x-kv"><span>Frequency</span><span>'+kpiXEsc(k.frequency||'Monthly')+'</span></div><div class="kpi-x-kv"><span>Data source</span><span>'+kpiXEsc(k.data_source||'Manual / linked module not configured')+'</span></div><h4>Measurement Indicators</h4>'+inds.map(function(ind){var snap=dueMonth?kpiXIndicatorSnapshot(ind,dueMonth):{status:'not_due',actual:null};return '<div class="kpi-x-indicator-card"><strong>'+kpiXEsc(ind.name)+'</strong><div class="kpi-x-kv"><span>Target</span><span>'+kpiXEsc(kpiXTargetText(ind))+'</span></div><div class="kpi-x-kv"><span>Current result</span><span>'+(snap.actual==null?kpiXStatusLabel(snap.status):kpiXEsc(snap.actual+' '+(ind.unit||'')))+'</span></div><div class="kpi-x-kv"><span>Status</span><span>'+kpiXStatusLabel(snap.status)+'</span></div>'+kpiXSpark(ind)+'</div>';}).join('')+'<h4>Governance</h4><div class="kpi-x-kv"><span>Reviewer</span><span>'+kpiXEsc(k.reviewer||'Not assigned')+'</span></div><div class="kpi-x-kv"><span>Approver</span><span>'+kpiXEsc(k.approver||'Not assigned')+'</span></div><div class="kpi-x-kv"><span>Approval state</span><span>'+kpiXEsc(k.approval_status||'Draft')+'</span></div></div><footer class="kpi-x-drawer-actions">'+(kpiXCanManage()?'<button type="button" class="kpi-x-btn" data-kpi-edit-kpi="'+kpiXEsc(k.id)+'"><i class="ti ti-pencil"></i>Edit KPI</button>':'')+'<button class="kpi-x-btn primary" data-auris-module-onclick="d0024" data-auris-module-args="'+encodeURIComponent(JSON.stringify([kpiXEsc(k.id)]))+'"><i class="ti ti-chart-bar"></i>Open Monthly Data</button>'+(['at_risk','off_track'].indexOf(snapshot.status)>=0?'<button class="kpi-x-btn" data-auris-module-onclick="d0007" data-auris-module-args="'+encodeURIComponent(JSON.stringify([kpiXEsc(k.id)]))+'"><i class="ti ti-plus"></i>Create Action</button>':'')+'</footer></section>';
  drawer.addEventListener('click',function(event){var close=event.target.closest('[data-kpi-drawer-close]'),edit=event.target.closest('[data-kpi-edit-kpi]');if(close){drawer.remove();return;}if(edit){event.preventDefault();event.stopPropagation();kpiXEditKpi(edit.getAttribute('data-kpi-edit-kpi'));}});
  document.body.appendChild(drawer);
}
function kpiXCreateAction(kpiId){
  var k=kpiKPIs.find(function(x){return String(x.id)===String(kpiId);}),drawer=document.getElementById('kpi-x-drawer');if(drawer)drawer.remove();var existing=document.getElementById('kpi-x-action-modal');if(existing)existing.remove();var due=new Date();due.setDate(due.getDate()+30);var modal=document.createElement('div');modal.id='kpi-x-action-modal';modal.className='kpi-x-drawer';modal.innerHTML='<section class="kpi-x-action-card"><header class="kpi-x-drawer-head"><div><small>KPI RECOVERY ACTION</small><h3>Create action</h3><p>'+(k?kpiXEsc((k.code||'')+' · '+k.name):kpiXEsc(kpiId))+'</p></div><button type="button" class="kpi-x-icon-btn" data-kpi-action-close><i class="ti ti-x"></i></button></header><div class="kpi-x-drawer-body"><div class="kpi-x-action-form"><label>Action title<input id="kpi-x-action-title" value="'+kpiXEsc('Recover KPI '+(k?((k.code||'')+' - '+k.name):kpiId))+'"></label><label>Priority<select id="kpi-x-action-priority"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><label class="full">Required action<textarea id="kpi-x-action-description" placeholder="Describe the corrective or improvement action required"></textarea></label><label>Owner<input id="kpi-x-action-owner" value="'+kpiXEsc(k?kpiXOwner(k):'')+'"></label><label>Target date<input id="kpi-x-action-due" type="date" value="'+due.toISOString().slice(0,10)+'"></label></div><div class="kpi-x-action-note"><i class="ti ti-link"></i>This action will be saved in the Master Action Plan and linked to the KPI, while you remain in Objectives &amp; KPIs.</div></div><footer class="kpi-x-drawer-actions"><button type="button" class="kpi-x-btn" data-kpi-action-close><i class="ti ti-arrow-left"></i>Back</button><button type="button" class="kpi-x-btn primary" data-kpi-action-save><i class="ti ti-device-floppy"></i>Save action</button></footer></section>';modal.addEventListener('click',function(e){if(e.target===modal||e.target.closest('[data-kpi-action-close]'))modal.remove();var save=e.target.closest('[data-kpi-action-save]');if(save)kpiXSaveAction(kpiId,modal,save);});document.body.appendChild(modal);
}
async function kpiXSaveAction(kpiId,modal,save){var k=kpiKPIs.find(function(x){return String(x.id)===String(kpiId);}),title=document.getElementById('kpi-x-action-title').value.trim(),description=document.getElementById('kpi-x-action-description').value.trim(),due=document.getElementById('kpi-x-action-due').value,owner=document.getElementById('kpi-x-action-owner').value.trim();if(!title||!description||!due){if(typeof toast==='function')toast('Title, required action and target date are required',false);return;}save.disabled=true;save.innerHTML='<i class="ti ti-loader-2"></i>Saving...';try{var yr=new Date().getFullYear(),ref=typeof nextCompanyRef==='function'?await nextCompanyRef('action_tracker','action_ref','MAP-KPI-'+yr+'-'):'MAP-KPI-'+yr+'-'+String(Date.now()).slice(-6),body={company_id:typeof ccid==='function'?ccid():(prof&&prof.company_id),action_ref:ref,title:title,description:description,action_type:'corrective',priority:document.getElementById('kpi-x-action-priority').value,status:'open',source_type:'kpi',source_module:'kpi',source_table:'kpis',source_id:String(kpiId),source_ref:k?((k.code||'')+' - '+k.name):String(kpiId),start_date:new Date().toISOString().slice(0,10),target_date:due,assigned_to_name:owner||null,responsible:owner||null,requires_verification:true,created_by:prof&&prof.id,updated_at:new Date().toISOString()},out=await api('/action_tracker',{m:'POST',p:'return=representation',b:body}),saved=out&&out[0];if(!saved)throw new Error('The action service returned no record');if(typeof relationshipCreate==='function')try{await relationshipCreate({module:'kpi',table:'kpis',id:String(kpiId),ref:body.source_ref},{module:'action',table:'action_tracker',id:String(saved.id),ref:saved.action_ref||ref},'action_for',{company_id:body.company_id});}catch(linkError){console.warn('KPI relationship link pending',linkError);}modal.remove();kpiXRenderActions();if(typeof toast==='function')toast('Action '+(saved.action_ref||ref)+' created and linked to the KPI');}catch(e){save.disabled=false;save.innerHTML='<i class="ti ti-device-floppy"></i>Save action';if(typeof toast==='function')toast('Action not saved: '+(e.message||e),false);}}
function kpiXGoMonthly(kpiId){var drawer=document.getElementById('kpi-x-drawer');if(drawer)drawer.remove();kpiXSwitchTab('monthly');setTimeout(function(){var row=document.querySelector('[data-kpi-id="'+CSS.escape(String(kpiId))+'"]');if(row)row.scrollIntoView({behavior:'smooth',block:'center'});},80);}
function kpiXFilterStatus(status){kpiXState.status=status||'all';var select=document.getElementById('kpi-x-status');if(select)select.value=kpiXState.status;kpiXSwitchTab(status==='all'?'dashboard':'scorecard');kpiXRenderScorecard();}
function kpiXFilterObjective(id){kpiXState.objective=id||'all';var select=document.getElementById('kpi-x-objective');if(select)select.value=kpiXState.objective;kpiXSwitchTab('scorecard');}
function kpiXSetObjective(value){kpiXState.objective=value;kpiXRenderScorecard();}
function kpiXSetOwner(value){kpiXState.owner=value;kpiXRenderScorecard();}
function kpiXSetFrequency(value){kpiXState.frequency=value;kpiXRenderScorecard();}
function kpiXSetSearch(value){kpiXState.search=String(value||'').trim().toLowerCase();kpiXRenderScorecard();}
function kpiXResetFilters(){kpiXState.status='all';kpiXState.objective='all';kpiXState.owner='all';kpiXState.frequency='all';kpiXState.search='';['kpi-x-search','kpi-x-status','kpi-x-objective','kpi-x-owner','kpi-x-frequency'].forEach(function(id){var el=document.getElementById(id);if(el)el.value=id==='kpi-x-search'?'':'all';});kpiXRenderAll();}
function kpiXSetPeriod(period,button){kpiXState.period=period;document.querySelectorAll('.kpi-x-period button').forEach(function(x){x.classList.toggle('active',x===button);});kpiXRenderMonthly();}
function kpiXReviewExceptions(){kpiXState.status=kpiXMetrics().off_track?'off_track':'at_risk';kpiXSwitchTab('scorecard');kpiXRenderScorecard();}
function kpiXReviewMissing(){kpiXState.status='data_missing';kpiXSwitchTab('scorecard');kpiXRenderScorecard();}
async function kpiXSubmitMonth(){var month=kpiXReportingMonth(),missing=kpiIndicators.filter(function(ind){var k=kpiKPIs.find(function(item){return item.id===ind.kpi_id;});return kpiXIsDue(k,month)&&!((kpiMonthlyData[ind.id]||{})[month]);});if(missing.length){if(typeof toast==='function')toast(missing.length+' required KPI result'+(missing.length===1?' is':'s are')+' missing. Complete them before submission.',false);kpiXReviewMissing();return;}if(typeof appConfirmAction==='function'){var ok=await appConfirmAction({title:'Submission readiness confirmed',message:'All required KPI values are complete for '+KPI_X_MONTHS[month-1]+' '+kpiXSelectedYear()+'.',detail:'A durable Submitted → Verified → Approved → Locked workflow requires the governance database migration. This check will not falsely lock the current records.',confirmText:'Acknowledge',cancelText:'Back'});if(!ok)return;}if(typeof auditLogEvent==='function')auditLogEvent('review','kpi','KPI month reviewed for submission',{year:kpiXSelectedYear(),month:month});if(typeof toast==='function')toast('Month is complete and ready for the approval workflow.');}
function kpiXExportCsv(){
  kpiXCompute();var rows=[['Objective','KPI Code','KPI','Indicator','Direction','Unit','Target','Current Actual','Variance','KPI Owner','Frequency','Status']];var month=kpiXReportingMonth();kpiObjectives.forEach(function(obj){kpiKPIs.filter(function(k){return k.objective_id===obj.id;}).forEach(function(k){kpiIndicators.filter(function(ind){return ind.kpi_id===k.id;}).forEach(function(ind){var snap=kpiXIndicatorSnapshot(ind,month);rows.push([obj.name,k.code||'',k.name,ind.name,kpiXDirection(ind).label,ind.unit||'count',kpiXTargetText(ind),snap.actual==null?'':snap.actual,kpiXVarianceText(ind,snap),kpiXOwner(k),k.frequency||'monthly',kpiXStatusLabel(snap.status)]);});});});var csv=rows.map(function(row){return row.map(function(value){return '"'+String(value==null?'':value).replace(/"/g,'""')+'"';}).join(',');}).join('\r\n');var blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='AURIS360-KPI-Scorecard-'+kpiXSelectedYear()+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},500);
}
function kpiXUpdateEntryPreview(){
  var ind=kpiIndicators.find(function(x){return x.id===kpiEntryIndicatorId;}),actual=document.getElementById('entry-actual'),preview=document.getElementById('kpi-x-entry-preview');if(!ind||!actual||!preview)return;var previous=kpiXPreviousRow(ind.id,kpiEntryMonth),result=kpiXEvaluate(ind,actual.value,previous&&previous.actual);preview.innerHTML='<div>Target<strong>'+kpiXEsc(kpiXTargetText(ind))+'</strong></div><div>Variance<strong>'+kpiXEsc(kpiXVarianceText(ind,{actual:kpiXNum(actual.value),variance:result.variance,status:result.status}))+'</strong></div><div>Status<strong>'+kpiXStatusHtml(result.status)+'</strong></div>';
}
function kpiXParseComment(value){var text=String(value||''),root='',evidence='',explanation=text;var rootMatch=text.match(/Root cause:\s*([^\n]+)/i),evidenceMatch=text.match(/Evidence:\s*([^\n]+)/i);if(rootMatch)root=rootMatch[1].trim();if(evidenceMatch)evidence=evidenceMatch[1].trim();explanation=text.replace(/\n?Root cause:[^\n]*/i,'').replace(/\n?Evidence:[^\n]*/i,'').trim();return {explanation:explanation,root:root,evidence:evidence};}
function kpiXInstallHooks(){
  if(typeof window.kpiLoadAll==='function'){kpiXLegacy.loadAll=window.kpiLoadAll;window.kpiLoadAll=async function(){await kpiXLegacy.loadAll.apply(this,arguments);if(typeof window.kpiConfigLoad==='function')await window.kpiConfigLoad();kpiXCompute();kpiXRenderAll();};}
  if(typeof window.kpiUpdateMetrics==='function'){kpiXLegacy.updateMetrics=window.kpiUpdateMetrics;window.kpiUpdateMetrics=function(){kpiXCompute();kpiXRefreshFilters();kpiXRenderDashboard();kpiXRenderActions();kpiXRenderReports();kpiXRenderConfig();};}
  if(typeof window.kpiRenderOverview==='function'){kpiXLegacy.renderOverview=window.kpiRenderOverview;window.kpiRenderOverview=kpiXRenderScorecard;}
  if(typeof window.kpiRenderMonthly==='function'){kpiXLegacy.renderMonthly=window.kpiRenderMonthly;window.kpiRenderMonthly=kpiXRenderMonthly;}
  if(typeof window.kpiFmtTarget==='function'){kpiXLegacy.fmtTarget=window.kpiFmtTarget;window.kpiFmtTarget=kpiXTargetText;}
  if(typeof window.kpiGetProgress==='function'){kpiXLegacy.getProgress=window.kpiGetProgress;window.kpiGetProgress=function(ind,actual){return kpiXEvaluate(ind,actual,null).score;};}
  if(typeof window.kpiOpenEntry==='function'){kpiXLegacy.openEntry=window.kpiOpenEntry;window.kpiOpenEntry=function(){var result=kpiXLegacy.openEntry.apply(this,arguments);var parsed=kpiXParseComment(document.getElementById('entry-comment').value),root=document.getElementById('entry-root-cause'),evidence=document.getElementById('entry-evidence');document.getElementById('entry-comment').value=parsed.explanation;if(root)root.value=parsed.root;if(evidence)evidence.value=parsed.evidence;var actual=document.getElementById('entry-actual');if(actual)actual.addEventListener('input',kpiXUpdateEntryPreview);kpiXUpdateEntryPreview();return result;};}
  if(typeof window.kpiSaveEntry==='function'){kpiXLegacy.saveEntry=window.kpiSaveEntry;window.kpiSaveEntry=async function(){var ind=kpiIndicators.find(function(x){return x.id===kpiEntryIndicatorId;}),actual=document.getElementById('entry-actual'),comment=document.getElementById('entry-comment'),root=document.getElementById('entry-root-cause'),evidence=document.getElementById('entry-evidence'),previous=ind&&kpiXPreviousRow(ind.id,kpiEntryMonth),status=ind&&actual?kpiXEvaluate(ind,actual.value,previous&&previous.actual).status:'not_started';if(['at_risk','off_track'].indexOf(status)>=0&&(!comment.value.trim()||!root.value.trim())){if(typeof toast==='function')toast('Performance explanation and root cause are required for an At Risk or Off Track result.',false);return;}var original=comment.value;comment.value=original.trim()+(root&&root.value.trim()?'\nRoot cause: '+root.value.trim():'')+(evidence&&evidence.value.trim()?'\nEvidence: '+evidence.value.trim():'');var indicatorId=kpiEntryIndicatorId,kpi=kpiKPIs.find(function(x){return kpiIndicators.some(function(i){return i.kpi_id===x.id&&i.id===indicatorId;});});await kpiXLegacy.saveEntry.apply(this,arguments);if(kpi&&typeof api==='function'){var refreshed=kpiKPIs.find(function(x){return x.id===kpi.id;})||kpi;var derived=kpiXKpiSnapshot(refreshed,kpiXReportingMonth()).status;if(['not_started','on_track','at_risk','off_track'].indexOf(derived)>=0&&refreshed.status!==derived){try{await api('/kpis_v2?id=eq.'+refreshed.id,{m:'PATCH',p:'return=minimal',b:{status:derived,updated_at:new Date().toISOString()}});refreshed.status=derived;}catch(e){console.warn('KPI status sync failed',e);}}}kpiXRenderAll();};}
  if(typeof window.kpiSaveKPI==='function'){kpiXLegacy.saveKpi=window.kpiSaveKPI;window.kpiSaveKPI=async function(){var editing=typeof kpiEditKpiId!=='undefined'?kpiEditKpiId:null;var result=await kpiXLegacy.saveKpi.apply(this,arguments),modal=document.getElementById('kpi-edit-modal');if(modal&&modal.style.display==='none')kpiXClearEditorDraft(editing);return result;};}
  if(typeof window.kpiAddIndicatorRow==='function'){kpiXLegacy.addIndicatorRow=window.kpiAddIndicatorRow;window.kpiAddIndicatorRow=function(){var result=kpiXLegacy.addIndicatorRow.apply(this,arguments);var rows=document.querySelectorAll('.ind-op-input'),select=rows.length?rows[rows.length-1]:null;if(select&&!select.querySelector('option[value="zero"]'))select.insertAdjacentHTML('beforeend','<option value="zero">= 0 · zero tolerance</option><option value="trend_up">↑ improving trend</option><option value="trend_down">↓ reducing trend</option>');return result;};}
  if(typeof window.openKpiAddModal==='function'){kpiXLegacy.openKpiAddModal=window.openKpiAddModal;window.openKpiAddModal=function(){var args=arguments;kpiXEnhanceKpiModal();var result=kpiXLegacy.openKpiAddModal.apply(this,args);setTimeout(function(){document.querySelectorAll('.ind-op-input').forEach(function(select){if(!select.querySelector('option[value="zero"]'))select.insertAdjacentHTML('beforeend','<option value="zero">= 0 · zero tolerance</option><option value="trend_up">↑ improving trend</option><option value="trend_down">↓ reducing trend</option>');});kpiXEnhanceKpiModal();var kpiId=args[0],status=document.getElementById('kpi-status'),k=kpiKPIs.find(function(item){return String(item.id)===String(kpiId);});if(status&&k){var derived=kpiXKpiSnapshot(k,kpiXReportingMonth()).status;status.value=['data_missing','in_progress','not_due'].indexOf(derived)>=0?'not_started':derived;}kpiXRestoreEditorDraft(kpiId);},0);return result;};}
}

window.kpiXSwitchTab=kpiXSwitchTab;window.kpiXFilterStatus=kpiXFilterStatus;window.kpiXFilterObjective=kpiXFilterObjective;window.kpiXSetObjective=kpiXSetObjective;window.kpiXSetOwner=kpiXSetOwner;window.kpiXSetFrequency=kpiXSetFrequency;window.kpiXSetSearch=kpiXSetSearch;window.kpiXResetFilters=kpiXResetFilters;window.kpiXSetPeriod=kpiXSetPeriod;window.kpiXReviewExceptions=kpiXReviewExceptions;window.kpiXReviewMissing=kpiXReviewMissing;window.kpiXSubmitMonth=kpiXSubmitMonth;window.kpiXExportCsv=kpiXExportCsv;window.kpiXOpenDrawer=kpiXOpenDrawer;window.kpiXCreateAction=kpiXCreateAction;window.kpiXGoMonthly=kpiXGoMonthly;window.kpiXOpenNewObjective=kpiXOpenNewObjective;window.kpiXOpenNewKpi=kpiXOpenNewKpi;window.kpiXEditObjective=kpiXEditObjective;window.kpiXEditKpi=kpiXEditKpi;

function kpiXBoot(){
  if(typeof window.kpiObjectives==='undefined')window.kpiObjectives=[];
  if(typeof window.kpiKPIs==='undefined')window.kpiKPIs=[];
  if(typeof window.kpiIndicators==='undefined')window.kpiIndicators=[];
  if(typeof window.kpiMonthlyData==='undefined')window.kpiMonthlyData={};
  kpiXInstall();kpiXInstallHooks();document.addEventListener('click',function(event){var menu=document.querySelector('[data-kpi-column-menu]'),control=event.target.closest&&event.target.closest('.kpi-x-column-control');if(menu&&!menu.hidden&&!control){menu.hidden=true;var toggle=document.querySelector('[data-kpi-column-toggle]');if(toggle)toggle.setAttribute('aria-expanded','false');}});
  var label=document.getElementById('kpi-co-label');if(label)label.textContent='Company performance';
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',kpiXBoot);else kpiXBoot();
})();
