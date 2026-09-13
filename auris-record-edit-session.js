(function(root){
'use strict';
// A small persistence boundary shared by record editors. No DOM, storage or globals from a module.
var copy=function(value){return JSON.parse(JSON.stringify(value));};
var equal=function(a,b){return JSON.stringify(a==null?null:a)===JSON.stringify(b==null?null:b);};
function create(options){
  var baseline=copy(options.record||{}),context=copy(options.context()),busy=false,pending=null;
  function assertCurrent(){
    if(!equal(context,options.context())||!context.companyId||!context.userId)throw new Error('Your account, role or company changed. Reopen this record.');
    if(options.online&& !options.online())throw new Error('Reconnect before saving. Your changes are still in the editor.');
  }
  function path(){return '/'+options.table+'?id=eq.'+encodeURIComponent(baseline.id)+'&company_id=eq.'+encodeURIComponent(context.companyId);}
  function exact(rows){
    if(!Array.isArray(rows)||rows.length!==1||String(rows[0].id)!==String(baseline.id)||String(rows[0].company_id)!==String(context.companyId))throw new Error('The server did not confirm this record. Reopen it before retrying.');
    return rows[0];
  }
  async function read(){var rows=await options.request(path()+'&select=*&limit=1');assertCurrent();return rows;}
  async function save(input){
    if(busy)throw new Error('A save is already in progress.');
    assertCurrent();busy=true;
    try{
      var body=copy(input),created=!baseline.id;
      delete body.id;delete body.company_id;delete body.created_by;delete body.updated_at;delete body.created_at;
      var submitted=copy(body);
      if(created){baseline.id=options.uuid();baseline.company_id=context.companyId;pending={kind:'create',body:null};}
      // Resolve an uncertain response before retrying. A retained id makes create retries safe.
      if(pending&&pending.body){
        var recovered=await read();
        if(recovered.length){
          var row=exact(recovered);
          if(Object.keys(pending.body).every(function(key){return key==='updated_at'||equal(row[key],pending.body[key]);})){
            var attempted=pending.input||pending.body,delta={};
            Object.keys(body).forEach(function(key){
              if(equal(body[key],attempted[key]))return;
              if(!equal(row[key],attempted[key]))throw new Error('This record changed after the previous save. Your draft is retained. Discard and reload to review it.');
              delta[key]=body[key];
            });
            baseline=copy(row);pending=null;
            if(!Object.keys(delta).length)return {record:copy(row),recovered:true};
            body=delta;
          }
          if(pending&&pending.kind==='create')throw new Error('This action was created, but now contains different values. Reopen it before continuing.');
        }
      }
      created=!!pending&&pending.kind==='create';
      if(!created){
        var fresh=exact(await read());
        if(!equal(fresh.updated_at,baseline.updated_at)||!equal(fresh.status,baseline.status)||Object.keys(body).some(function(key){return !equal(fresh[key],baseline[key]);}))throw new Error('This record changed since you opened it. Your draft is retained. Discard and reload to review the latest version.');
        Object.keys(body).forEach(function(key){if(equal(body[key],baseline[key]))delete body[key];});
        if(!Object.keys(body).length){pending=null;return {record:copy(fresh),unchanged:true};}
      }
      body.updated_at=options.now();
      if(created){body.id=baseline.id;body.company_id=context.companyId;body.created_by=context.userId;}
      pending={kind:created?'create':'update',body:copy(body),input:submitted};
      assertCurrent();
      var url=created?'/'+options.table:path()+'&updated_at='+(baseline.updated_at?'eq.'+encodeURIComponent(baseline.updated_at):'is.null')+'&status='+(baseline.status?'eq.'+encodeURIComponent(baseline.status):'is.null');
      var result=await options.request(url,{m:created?'POST':'PATCH',p:'return=representation',b:body});
      assertCurrent();
      var saved=exact(result);
      // Do not accept an RLS-filtered empty response or a successful response that dropped fields.
      if(Object.keys(body).some(function(key){return key!=='updated_at'&&!equal(saved[key],body[key]);}))throw new Error('The server returned different values. Your draft is retained; reload to verify the save.');
      baseline=copy(saved);pending=null;return {record:copy(saved),created:created};
    }finally{busy=false;}
  }
  return {save:save,record:function(){return pending&&pending.kind==='create'?copy(options.record||{}):copy(baseline);},assertCurrent:assertCurrent,isBusy:function(){return busy;}};
}
root.AurisRecordEditSession=Object.freeze({version:'1.0.0',create:create});
})(typeof window!=='undefined'?window:globalThis);
