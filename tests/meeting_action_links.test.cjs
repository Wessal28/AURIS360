const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('meeting-reliability.js','utf8');
class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.events={};this.attributes={};this.textContent='';this.classList={add:name=>{this.className=[this.className||'',name].join(' ').trim();}};}
  appendChild(child){child.parentNode=this;this.children.push(child);return child;}
  setAttribute(name,value){this.attributes[name]=value;}
  addEventListener(name,handler){this.events[name]=handler;}
  replaceWith(child){const index=this.parentNode.children.indexOf(this);child.parentNode=this.parentNode;this.parentNode.children.splice(index,1,child);}
  closest(){return null;}
}
function harness(recommendations,actions,request){
  let company='company-a',user='user-a';const calls=[],requests=[];
  const rows=recommendations.map(rec=>{const row=new Element('tr'),cell=new Element('td');cell.textContent=rec.desc;row.appendChild(cell);row.querySelector=selector=>selector==='td'?cell:null;return row;});
  const table=new Element('table');table.querySelectorAll=selector=>selector==='tbody tr'?rows:[];
  const heading=new Element('h3');heading.textContent='Actions and recommendations';heading.nextElementSibling={querySelector:selector=>selector==='table'?table:null};
  const modal={isConnected:true,querySelectorAll:selector=>selector==='h3'?[heading]:[]};
  const c={Intl,Date,Map,Set,document:{addEventListener(){},createElement:tag=>new Element(tag)},prof:{id:user},ccid:()=>company,mtgSplitRecommendationPayload:payload=>({recs:payload}),deepLinkRecordUrl:record=>'https://auris.test/?goto=actions&record='+record.id+'&company='+record.company_id,open:(...args)=>{calls.push(args);return {};},api:async url=>{requests.push(url);return request?request(url):actions;},toast(){}};c.window=c;vm.createContext(c);vm.runInContext(source,c);
  const minutes={id:'minutes-a',company_id:company,recommendations};
  return {c,rows,modal,requests,calls,minutes,attach:()=>c.mtgAttachActions(minutes,modal,'company-a','user-a'),changeCompany:value=>company=value,changeUser:value=>{user=value;c.prof.id=value;},link:index=>rows[index].children[0].children.find(child=>child.tagName==='A')};
}
const action=(id,extra={})=>({id,company_id:'company-a',source_module:'meeting',source_id:'minutes-a',action_ref:'MAP-'+id,description:'Recorded action',responsible:'Owner',target_date:'2026-11-01',status:'in_progress',...extra});
function event(target){return {target,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};}

test('action references are integrated into the matching minutes rows and double-click opens exact MAP records',async()=>{
  const recs=[{desc:'Recorded action',resp:'Owner',date:'2026-11-01',key:'key-first',action_id:'first',status:'open'},{desc:'Recorded action',resp:'Owner',date:'2026-11-01',key:'key-second',status:'open'}];
  const h=harness(recs,[action('foreign',{company_id:'company-b',meeting_recommendation_key:'key-first'}),action('wrong-source',{source_id:'minutes-b',meeting_recommendation_key:'key-first'}),action('second',{meeting_recommendation_key:'key-second'}),action('first',{meeting_recommendation_key:'key-first'})]);
  await h.attach();
  assert.match(h.requests[0],/\?select=\*&/);assert.match(h.requests[0],/company_id=eq\.company-a/);assert.match(h.requests[0],/source_id=eq\.minutes-a/);
  for(const [i,id] of [[0,'first'],[1,'second']]){
    const link=h.link(i);assert.ok(link);assert.equal(link.href,'https://auris.test/?goto=actions&record='+id+'&company=company-a');assert.equal(link.attributes['aria-label'],'Open Master Action Plan record MAP-'+id);assert.equal(link.target,'_blank');
    assert.equal(h.rows[i].children[0].textContent,'Recorded action');assert.equal(recs[i].status,'open','The recorded minutes status must remain unchanged');
    const click=event(link);link.events.click(click);assert.equal(click.defaultPrevented,false);
    h.rows[i].events.dblclick(event(h.rows[i]));assert.equal(h.calls.at(-1)[0],link.href);
    const count=h.calls.length;h.rows[i].events.dblclick(event({closest:()=>link}));assert.equal(h.calls.length,count,'Double-clicking the link must not also trigger the row action');
  }
});

test('legacy links require a unique full match and never fall back from missing or conflicting persisted identities',async()=>{
  const recs=[{desc:'Unique legacy',resp:'Owner',date:'2026-11-01'},{desc:'Duplicate',resp:'Owner',date:'2026-11-01'},{desc:'Duplicate',resp:'Owner',date:'2026-11-02'},{desc:'Missing action',action_id:'missing',resp:'Owner',date:'2026-11-01'},{desc:'Conflicting key',action_id:'conflict',key:'correct-key'},{desc:'Ambiguous',resp:'Owner',date:'2026-11-01'}];
  const h=harness(recs,[action('legacy',{description:'Unique legacy'}),action('wrong-owner',{description:'Unique legacy',responsible:'Other'}),action('duplicate',{description:'Duplicate'}),action('unrelated',{description:'Missing action'}),action('conflict',{description:'Conflicting key',meeting_recommendation_key:'different-key'}),action('amb-1',{description:'Ambiguous'}),action('amb-2',{description:'Ambiguous'})]);
  await h.attach();assert.equal(h.link(0).textContent,'MAP-legacy');
  for(let i=1;i<recs.length;i++){assert.equal(h.link(i),undefined);assert.match(h.rows[i].children[0].children[0].textContent,/No verified Master Action Plan link/);assert.equal(h.rows[i].events.dblclick,undefined);}
});

test('older action rows without the optional recommendation-key column still support verified links',async()=>{
  const h=harness([{desc:'Legacy action',resp:'Owner',date:'2026-11-01'},{desc:'Persisted action',action_id:'stored',key:'persisted-key'}],[action('legacy',{description:'Legacy action'}),action('stored',{description:'Persisted action'})],url=>{
    assert.match(url,/\?select=\*&/);assert.doesNotMatch(url,/select=[^&]*meeting_recommendation_key/);
    return [action('legacy',{description:'Legacy action'}),action('stored',{description:'Persisted action'})];
  });
  await h.attach();assert.equal(h.link(0).textContent,'MAP-legacy');assert.equal(h.link(1).textContent,'MAP-stored');
});

test('company, account and disconnected-modal changes prevent stale response rendering and navigation',async()=>{
  const recs=[{desc:'Recorded action',key:'key-first'}];
  for(const change of [h=>h.changeCompany('company-b'),h=>h.changeUser('user-b'),h=>{h.modal.isConnected=false;}]){
    let resolve;const pending=new Promise(done=>{resolve=done;}),h=harness(recs,[],()=>pending),ready=h.attach();change(h);resolve([action('first',{meeting_recommendation_key:'key-first'})]);await ready;assert.equal(h.link(0),undefined);
    const opened=harness(recs,[action('first',{meeting_recommendation_key:'key-first'})]);await opened.attach();change(opened);const click=event(opened.link(0));opened.link(0).events.click(click);assert.equal(click.defaultPrevented,true);opened.rows[0].events.dblclick(event(opened.rows[0]));assert.equal(opened.calls.length,0);
  }
});

test('failed action lookup retains the recorded action and provides a recoverable availability message',async()=>{
  const h=harness([{desc:'Retain this action',status:'closed'}],[],()=>{throw Error('offline');});await h.attach();assert.equal(h.rows[0].children[0].textContent,'Retain this action');assert.match(h.rows[0].children[0].children[0].textContent,/currently unavailable.*unchanged/);assert.equal(h.link(0),undefined);
});
