const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const core=fs.readFileSync(path.join(root,'auris-core.js'),'utf8');

function runFunction(name,next,values){
  const fields=new Map(Object.entries(values).map(([id,value])=>[id,{value:String(value),textContent:'',innerHTML:'',style:{}}]));
  const document={getElementById(id){return fields.get(id)||null;}};
  const context={document,console};
  vm.createContext(context);
  vm.runInContext(core.slice(core.indexOf('function '+name+'('),core.indexOf('function '+next+'(',core.indexOf('function '+name+'('))),context);
  context[name]();
  return fields;
}

test('blank exposure stays unassessed, while zero exposure against an OEL is a valid result',()=>{
  const blank=runFunction('expCalcRisk','expNew',{'expf-twa':'','expf-oel-twa':'','exp-risk-panel':''});
  assert.match(blank.get('exp-risk-panel').textContent,/Unassessed/);
  const zero=runFunction('expCalcRisk','expNew',{'expf-twa':'0','expf-oel-twa':'10','exp-risk-panel':''});
  assert.match(zero.get('exp-risk-panel').innerHTML,/0%/);
});

test('spirometry needs all predicted and measured values and refreshes its derived ratio',()=>{
  const fields=runFunction('spiCalc','spiShowForm',{
    'spi-fvc-pred':4,'spi-fvc-meas':3,'spi-fev1-pred':3,'spi-fev1-meas':'',
    'spi-ratio-meas':'','spi-interpretation':'','spi-fvc-pct':'','spi-fev1-pct':'','spi-ratio-pct':''
  });
  assert.match(fields.get('spi-interpretation').textContent,/Awaiting/);
  fields.get('spi-fev1-meas').value='2.4';
  const document={getElementById(id){return fields.get(id)||null;}};
  const context={document,console};vm.createContext(context);
  vm.runInContext(core.slice(core.indexOf('function spiCalc('),core.indexOf('function spiShowForm(')),context);
  context.spiCalc();
  assert.equal(fields.get('spi-ratio-meas').value,'80.0');
  fields.get('spi-fev1-meas').value='1.5';context.spiCalc();
  assert.equal(fields.get('spi-ratio-meas').value,'50.0');
});
