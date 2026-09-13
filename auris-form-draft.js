/* Shared, tab-scoped form recovery. Persistence is optional; failures stay visible. */
(function(root){
'use strict';
var copy=function(value){return JSON.parse(JSON.stringify(value));};
var same=function(a,b){return JSON.stringify(a)===JSON.stringify(b);};
function create(options){
  var context=copy(options.context),baseline=copy(options.baseline),candidate=null,error='',outcome='draft';
  var now=options.now||Date.now;
  function remove(){try{options.storage.removeItem(options.key);error='';return true;}catch(e){error='Browser draft storage is unavailable.';return false;}}
  try{
    var raw=options.storage.getItem(options.key);
    if(raw){
      var saved=JSON.parse(raw);
      if(saved.version===1&&same(saved.context,context)&&saved.savedAt<=now()&&now()-saved.savedAt<86400000&&options.valid(saved.value))candidate=saved;
      else if(options.legacy){candidate=options.legacy(saved);}
      if(!candidate)remove();
    }
  }catch(e){error='Browser draft storage is unavailable.';}
  function dirty(value){return !same(value,baseline);}
  function capture(value){
    if(candidate||outcome!=='draft')return false;
    if(!dirty(value))return remove();
    try{options.storage.setItem(options.key,JSON.stringify({version:1,context:context,baseline:baseline,value:copy(value),savedAt:now(),outcome:outcome}));error='';return true;}
    catch(e){error='Changes are only in this open form; browser draft storage is unavailable.';return false;}
  }
  function blocked(){return !!candidate&&(candidate.outcome!=='draft'||(candidate.baseline&&!same(candidate.baseline,baseline)));}
  function restore(){if(!candidate||blocked())return null;var value=copy(candidate.value);candidate=null;return value;}
  function discard(){candidate=null;outcome='draft';return remove();}
  function protect(value){
    candidate=null;outcome='unconfirmed';
    try{options.storage.setItem(options.key,JSON.stringify({version:1,context:context,baseline:baseline,value:copy(value),savedAt:now(),outcome:outcome}));error='';}
    catch(e){
      // Never leave a restorable pre-write draft behind after an uncertain server write.
      try{options.storage.removeItem(options.key);}catch(removeError){throw new Error('Draft recovery could not be protected. Keep this form open and restore browser storage before saving.');}
      error='Browser draft storage is unavailable. Keep this form open until you have checked the saved record.';
    }
  }
  return {dirty:dirty,capture:capture,candidate:function(){return candidate?copy(candidate):null;},blocked:blocked,restore:restore,discard:discard,protect:protect,error:function(){return error;},baseline:function(){return copy(baseline);}};
}
root.AurisFormDraft=Object.freeze({version:'1.0.0',create:create});
})(typeof window!=='undefined'?window:globalThis);
