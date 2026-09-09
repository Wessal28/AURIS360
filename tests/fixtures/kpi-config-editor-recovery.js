// Local synthetic renderer-failure controls. Never loaded by the application.
(()=>{
 const originalRender=window.kpiConfigRender,originalApi=window.api;
 let calls=0,baseline=null;
 window.api=(...args)=>{calls++;return originalApi(...args);};
 const panel=document.createElement('div'),status=document.createElement('p');
 status.id='fixture-recovery-status';status.setAttribute('role','status');
 function inspect(){
  status.textContent=baseline?'Since simulated failure: '+(calls-baseline.calls)+' service calls; '+(fixtureWrites-baseline.writes)+' writes; published configuration '+(JSON.stringify(window.kpiConfigPublished)===baseline.published?'unchanged':'CHANGED')+'; monthly records '+(JSON.stringify(window.kpiMonthlyData)===baseline.monthly?'unchanged':'CHANGED'):'Ready to simulate a renderer failure after editing a draft.';
 }
 function simulate(mode){
  if(!baseline)baseline={calls,writes:fixtureWrites,published:JSON.stringify(window.kpiConfigPublished),monthly:JSON.stringify(window.kpiMonthlyData)};
  window.kpiConfigRender=mode==='missing'?undefined:()=>{throw new Error('Synthetic renderer failure');};
  window.kpiXSwitchTab('configuration');inspect();
 }
 for(const [name,action] of [
  ['Simulate missing editor',()=>simulate('missing')],
  ['Simulate failing editor',()=>simulate('failure')],
  ['Restore renderer',()=>{window.kpiConfigRender=originalRender;inspect();}],
  ['Inspect recovery evidence',inspect]
 ]){const button=document.createElement('button');button.type='button';button.textContent=name;button.addEventListener('click',action);panel.append(button);}
 panel.append(status);document.querySelector('.fixture-banner').append(panel);inspect();
})();
