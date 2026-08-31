(function(root){
'use strict';

var registry=root.AurisModuleRegistry;
if(!registry)throw new Error('AurisModuleRuntime requires AurisModuleRegistry.');

var activeKey=null;
var hooks=Object.create(null);

function emit(phase,detail,cancelable){
  if(!root.document||typeof root.CustomEvent!=='function')return true;
  return root.document.dispatchEvent(new root.CustomEvent('auris:module-'+phase,{detail:detail,cancelable:!!cancelable}));
}
function registeredHook(key,phase){return hooks[key]&&typeof hooks[key][phase]==='function'?hooks[key][phase]:null;}
function callHook(key,phase,context){var hook=registeredHook(key,phase);return hook?hook(context):undefined;}
function register(key,lifecycleHooks){
  if(!registry.get(key))throw new Error('Cannot register lifecycle hooks for unknown module: '+key);
  hooks[key]=Object.freeze(Object.assign({},lifecycleHooks||{}));
  return function(){delete hooks[key];};
}
function readiness(key,enabledKeys){
  var manifest=registry.get(key);
  if(!manifest)return {ready:false,key:key,manifest:null,missing:[],reason:'unknown_module'};
  var missing=Array.isArray(enabledKeys)?registry.missingDependencies(key,enabledKeys):[];
  return {ready:missing.length===0,key:key,manifest:manifest,missing:missing,reason:missing.length?'missing_dependencies':''};
}
function activate(key,options){
  options=options||{};
  var status=readiness(key,options.enabledKeys);
  if(!status.manifest)throw new Error('Unknown AURIS module: '+key);
  if(options.strictDependencies&&status.missing.length)throw new Error('Module '+key+' requires: '+status.missing.join(', '));
  var previous=activeKey,context={key:key,previousKey:previous,manifest:status.manifest,missingDependencies:status.missing,element:options.element||null,services:root.AurisPlatformServices||null};
  if(previous&&previous!==key){
    if(emit('before-leave',context,true)===false)return {ok:false,cancelled:true,key:key};
    if(callHook(previous,'beforeLeave',context)===false)return {ok:false,cancelled:true,key:key};
  }
  if(emit('before-enter',context,true)===false)return {ok:false,cancelled:true,key:key};
  if(callHook(key,'beforeEnter',context)===false)return {ok:false,cancelled:true,key:key};
  if(typeof options.activateView==='function')options.activateView(status.manifest);
  if(previous&&previous!==key){callHook(previous,'leave',context);emit('leave',context,false);}
  activeKey=key;
  var loader=typeof options.loader==='function'?options.loader:root[status.manifest.loader];
  function complete(){callHook(key,'enter',context);emit('enter',context,false);return {ok:true,key:key,previousKey:previous,missingDependencies:status.missing};}
  function failed(error){context.error=error;emit('error',context,false);throw error;}
  try{
    var result=typeof loader==='function'?loader(context):undefined;
    return result&&typeof result.then==='function'?result.then(complete,failed):complete();
  }catch(error){return failed(error);}
}
function current(){return activeKey;}

root.AurisModuleRuntime=Object.freeze({version:'1.0.0',activate:activate,current:current,readiness:readiness,register:register});
})(typeof window!=='undefined'?window:globalThis);
