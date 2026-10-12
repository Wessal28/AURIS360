const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const core=fs.readFileSync(path.join(__dirname,'..','auris-core.js'),'utf8');
const safety=vm.runInNewContext(
  core.slice(core.indexOf('const PTW_TYPE_CFG='),core.indexOf('// -- ENTRY POINT',core.indexOf('const PTW_TYPE_CFG=')))+
  core.slice(core.indexOf('function ptwClassifyGasTest('),core.indexOf('function ptwUpdateGasResultPreview(',core.indexOf('function ptwClassifyGasTest(')))+
  ';({type:ptwCanonicalType,storedType:ptwStoredType,people:ptwReadableList,approvals:ptwApprovalComplete,readiness:ptwReadinessIssues,gas:ptwClassifyGasTest})'
);

test('legacy electrical and height permits map to the same current type and permitted storage value',()=>{
  assert.equal(safety.type('electrical'),'electrical_isolation');
  assert.equal(safety.type('working_at_height'),'work_at_height');
  assert.equal(safety.storedType('electrical_isolation'),'electrical');
  assert.equal(safety.storedType('loto'),'general');
});

test('unentered gas readings never pass and unsafe or borderline readings retain their result',()=>{
  assert.equal(safety.gas({}),'pending');
  assert.equal(safety.gas({o2:'20.9',lel:''}),'pending');
  assert.equal(safety.gas({o2:'18',lel:'0'}),'fail');
  assert.equal(safety.gas({o2:'20.9',lel:'8'}),'borderline');
  assert.equal(safety.gas({o2:'20.9',lel:'0'}),'pass');
});

test('approval and readiness cannot imply safe activation from a status label alone',()=>{
  const permit={status:'approved',permit_type:'electrical',approval_level_required:2,approval_l1_status:'approved',approval_l2_status:'pending',ra_ref:'RA-1',risk_assessment_id:'ra-id',precautions_checklist:[{item:'Verify isolation',checked:false}],isolations:[{status:'isolated'}]};
  assert.equal(safety.approvals(permit),false);
  const issues=Array.from(safety.readiness(permit));
  assert.ok(issues.some(x=>x.includes('approval')));
  assert.ok(issues.some(x=>x.includes('precautions')));
  assert.ok(issues.some(x=>x.includes('verified isolation')));
});

test('people and PPE fields render stored objects as names',()=>{
  assert.equal(safety.people([{first_name:'Gerard',last_name:'Salomon'},{name:'Veekash'}]),'Gerard Salomon, Veekash');
  assert.equal(safety.people(['Helmet','Gloves']),'Helmet, Gloves');
});
