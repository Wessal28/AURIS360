(function(root){
'use strict';
function number(value){return value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):null;}
function bands(profile){
  var rows=profile&&profile.bands_json;
  if(!Array.isArray(rows)||!rows.length)return 'Configure classification bands before publishing the profile.';
  for(var i=0;i<rows.length;i++){
    var b=rows[i],min=b.min==null?-Infinity:number(b.min),max=b.max==null?Infinity:number(b.max);
    if(!['below_action','above_action','above_limit'].includes(b.code)||min===null||max===null||min>=max||(!i&&min!==-Infinity)||(i&&min!==Number(rows[i-1].max))||(i===rows.length-1&&max!==Infinity)||(i<rows.length-1&&max===Infinity))return 'Bands must cover every result once, in order, using min-inclusive and max-exclusive boundaries.';
  }
  return '';
}
function compatible(m){return ['area_task','personal','personal_dosimetry'].includes(m.measurement_type)&&['accepted','approved'].includes(m.status)&&['acceptable','accepted','limited'].includes(m.data_quality_status)&&['LAEQ','LAEQ,T'].includes(String(m.descriptor||'').toUpperCase().replace(/\s/g,''))&&['DBA','DB(A)'].includes(String(m.unit||'').toUpperCase().replace(/\s/g,''))&&number(m.raw_value)!==null&&number(m.valid_duration_minutes)>0;}
function calculate(profile,measurements){
  var ref=number(profile&&profile.reference_duration_hours);
  if(!ref||ref<=0||!measurements.length||measurements.some(function(m){return !compatible(m);}))return null;
  // Scale the energy sum by its largest level to avoid overflow at large inputs.
  var peak=Math.max.apply(null,measurements.map(function(m){return Number(m.raw_value);})),hours=measurements.reduce(function(n,m){return n+Number(m.valid_duration_minutes)/60;},0),energy=measurements.reduce(function(n,m){return n+Number(m.valid_duration_minutes)/60*Math.pow(10,(Number(m.raw_value)-peak)/10);},0);
  var level=peak+10*Math.log10(energy/hours),result=peak+10*Math.log10(energy/ref),classification='profile_pending';
  if(!bands(profile)){var b=profile.bands_json.find(function(b){return result>=(b.min==null?-Infinity:Number(b.min))&&result<(b.max==null?Infinity:Number(b.max));});classification=b?b.code:classification;}
  return {source_level:Number(level.toFixed(6)),duration_hours:hours,result_value:Number(result.toFixed(2)),reference_duration_hours:ref,classification:classification};
}
function escape(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function friendly(value){var known={profile_pending:'Profile not confirmed',LEX_REF_DURATION:'Exposure normalised to the profile reference duration',NOISE_ENERGY_SUM:'Energy sum of linked LAeq measurements',below_action:'Below configured action level',above_action:'At or above configured action level',above_limit:'At or above configured limit'};return known[value]||String(value==null?'Not recorded':value).replace(/_/g,' ').replace(/^\w/,function(c){return c.toUpperCase();});}
function reportHtml(report){var snapshot=report.report_snapshot||{},sources=snapshot.sources||[],draft=!['approved','issued'].includes(report.status);return '<article class="noise-report"><h1>'+escape(report.name||'Noise report')+'</h1><p><strong>'+(draft?'DRAFT — not approved for issue':escape(friendly(report.status)))+'</strong> · '+escape(report.code)+' · version '+escape(report.version_no||1)+'</p><p>Data as of '+escape(snapshot.data_as_of||report.data_as_of||'Not recorded')+' · Generated '+escape(report.generated_at||'Not generated')+'</p><p>'+escape(report.scope||'')+'</p><p>Distribution: '+escape(report.distribution_rules||'Company access; confirm distribution before issue')+'</p>'+sources.map(function(s){return '<section><h2>'+escape(s.reference)+' · version '+escape(s.version_no)+'</h2><dl>'+Object.keys(s.summary||{}).map(function(key){var v=s.summary[key];return v==null?'':'<dt>'+escape(friendly(key))+'</dt><dd>'+escape(typeof v==='object'?JSON.stringify(v):friendly(v))+'</dd>';}).join('')+'</dl></section>';}).join('')+(!sources.length?'<p>No generated evidence. Save the draft, select approved source records, then Generate preview.</p>':'')+'<p>Calculations use the recorded company profile. This report retains the selected source versions and does not infer clinical fitness or a legal approval.</p></article>';}
root.NoiseAssurance=Object.freeze({number:number,bands:bands,compatible:compatible,calculate:calculate,friendly:friendly,reportHtml:reportHtml});
})(typeof window!=='undefined'?window:globalThis);
