(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.AurisKpiYearComparison=api;
})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  function norm(value){return String(value==null?'':value).trim().replace(/\s+/g,' ').toLowerCase();}
  function number(value){if(value===null||value===undefined||String(value).trim()==='')return null;var n=Number(value);return Number.isFinite(n)?n:null;}
  function round(value){return Math.round(value*100)/100;}
  function key(kpi,indicator){return [norm(kpi.code)||'name:'+norm(kpi.name),norm(indicator.name),norm(indicator.unit),norm(indicator.ytd_method||'sum')].join('|');}
  function aggregate(rows,method,cutoff){
    var values=(rows||[]).filter(function(row){var month=Number(row.month);return month>=1&&month<=cutoff&&month<=12&&number(row.actual)!==null;}).sort(function(a,b){return Number(a.month)-Number(b.month);});
    if(!values.length)return null;
    var nums=values.map(function(row){return number(row.actual);});
    if(method==='last')return nums[nums.length-1];
    if(method==='average')return round(nums.reduce(function(a,b){return a+b;},0)/nums.length);
    if(method==='max')return Math.max.apply(null,nums);
    if(method==='min')return Math.min.apply(null,nums);
    return round(nums.reduce(function(a,b){return a+b;},0));
  }
  function illustrative(kpi,rows){return /illustrative|unverified/i.test(String(kpi.description||'')+' '+String(kpi.lifecycle_reason||''))||(rows||[]).some(function(row){return /illustrative|unverified/i.test(String(row.comment||''));});}
  function index(year,kpis,indicators,monthly){
    var byKpi=new Map(),byIndicator=new Map(),result=new Map();
    (kpis||[]).forEach(function(kpi){if(Number(kpi.year)===year&&norm(kpi.status)!=='archived')byKpi.set(String(kpi.id),kpi);});
    (monthly||[]).forEach(function(row){if(Number(row.year)!==year)return;var id=String(row.indicator_id||'');if(!byIndicator.has(id))byIndicator.set(id,[]);byIndicator.get(id).push(row);});
    (indicators||[]).forEach(function(indicator){var kpi=byKpi.get(String(indicator.kpi_id));if(!kpi)return;var id=key(kpi,indicator);if(result.has(id)){result.set(id,null);return;}result.set(id,{kpi:kpi,indicator:indicator,rows:byIndicator.get(String(indicator.id))||[]});});
    return result;
  }
  function direction(operator,delta){
    if(delta===0)return 'unchanged';
    var op=norm(operator);
    if(['gte','gt','trend_up'].includes(op))return delta>0?'improved':'declined';
    if(['lte','lt','trend_down','zero','zero_tolerance'].includes(op))return delta<0?'improved':'declined';
    return 'changed';
  }
  function build(input){
    var year=Number(input.year),cutoff=Math.max(0,Math.min(12,Number(input.cutoff)||0)),current=input.current||{},history=input.history||{},years=[year-1,year-2];
    var maps={};years.forEach(function(y){maps[y]=index(y,history.kpis,history.indicators,history.monthly);});
    var currentRows=current.monthly||{},rows=[];
    (current.kpis||[]).forEach(function(kpi){
      (current.indicators||[]).filter(function(ind){return String(ind.kpi_id)===String(kpi.id);}).forEach(function(ind){
        var own=Array.isArray(currentRows)?currentRows.filter(function(row){return String(row.indicator_id)===String(ind.id);}):Object.values(currentRows[ind.id]||{}),currentValue=aggregate(own,ind.ytd_method,cutoff),currentIllustrative=illustrative(kpi,own),prior={};
        years.forEach(function(y){var match=maps[y].get(key(kpi,ind));prior[y]=match?{value:aggregate(match.rows,match.indicator.ytd_method,cutoff),illustrative:illustrative(match.kpi,match.rows),matched:true}:{value:null,illustrative:false,matched:false};});
        var previous=prior[year-1],delta=currentValue!=null&&previous.value!=null?round(currentValue-previous.value):null,percent=delta!=null&&previous.value!==0?round(delta/Math.abs(previous.value)*100):null;
        rows.push({code:kpi.code||'',kpi:kpi.name||'',indicator:ind.name||'',unit:ind.unit||'',method:ind.ytd_method||'sum',current:currentValue,currentIllustrative:currentIllustrative,prior:prior,delta:delta,percent:percent,direction:delta==null?'no_comparison':currentIllustrative||previous.illustrative?'illustrative':direction(ind.target_operator,delta)});
      });
    });
    return {year:year,cutoff:cutoff,years:years,rows:rows,comparable:rows.filter(function(row){return row.delta!=null;}).length,illustrative:rows.some(function(row){return row.currentIllustrative||years.some(function(y){return row.prior[y].illustrative;});})};
  }
  return {build:build,aggregate:aggregate,key:key};
});
