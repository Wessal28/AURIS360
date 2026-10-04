const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const core=fs.readFileSync('auris-core.js','utf8');
const start=core.indexOf('function raReadOnlyReportHTML(');
const end=core.indexOf('\nfunction raOpenReadOnly(',start);
assert.ok(start>0&&end>start);
const context=vm.createContext({
  RA_TYPE_CFG:{task:{label:'Task-based'}},
  escH:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
  raSummariseRows:row=>({rows:row.rows,initialLevel:'High',initialScore:12,residualLevel:'Low',residualScore:2}),
  raRiskBadge:(level,score)=>'<strong>'+level+' '+score+'</strong>'
});
vm.runInContext(core.slice(start,end),context);

test('risk report shows saved hazards and controls as read-only escaped content',()=>{
  const html=context.raReadOnlyReportHTML({ra_type_v2:'task',ra_ref:'TRA-1',title:'Working at height',rows:[{task:'Inspect roof',hazard:'Fall <script>alert(1)</script>',harm:'Serious injury',controls:'Guardrails',rr:12,rl:'High',further_controls:'Anchor points',res_rr:2,res_rl:'Low',action_by:'Site supervisor',target_date:'2026-10-31'}]});
  assert.match(html,/TRA-1/);
  assert.match(html,/Guardrails/);
  assert.match(html,/Anchor points/);
  assert.match(html,/Site supervisor/);
  assert.match(html,/Fall &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<input|<textarea|<select|<script>/);
});

test('all risk register open paths use the viewer; only its guarded edit button enters the editor',()=>{
  const upgrade=fs.readFileSync('risk-assessment-upgrade.js','utf8');
  const runtime=fs.readFileSync('auris-runtime-event-handlers.js','utf8');
  const dashboard=fs.readFileSync('auris-module-event-handlers-batch-2.js','utf8');
  assert.match(upgrade,/openRecord:function\(id,current\)[^\n]+window\.raOpenReadOnly\(id\)/);
  assert.match(runtime,/"r0064": function \(event, args\) \{\s*event\.stopPropagation\(\);raOpenReadOnly\(args\[0\]\)/);
  assert.match(dashboard,/"c0027": function \(event, args\) \{\s*raOpenReadOnly\(args\[0\]\)/);
  assert.match(core,/if\(String\(ccid\(\)\)!==String\(row\.company_id\)\|\|!isMgr\(\)\|\|!controlledRecordCanEdit\(row\)\)/);
});
