(function(root){
'use strict';

var serviceNames=['auth','api','rbac','audit','notifications'];
var adapters=Object.create(null);
var listeners=[];

function known(name){return serviceNames.indexOf(name)!==-1;}
function assertKnown(name){if(!known(name))throw new Error('Unknown AURIS platform service: '+name);}
function assertAdapter(name,adapter){
  if(!adapter||typeof adapter!=='object')throw new Error('AURIS platform service '+name+' requires an adapter object.');
}
function emit(name){
  var detail={name:name,service:facades[name],health:health()};
  listeners.slice().forEach(function(listener){try{listener(detail);}catch(_){}});
  if(root.document&&typeof root.CustomEvent==='function')root.document.dispatchEvent(new root.CustomEvent('auris:service-ready',{detail:detail}));
}
function configure(name,adapter){
  if(name&&typeof name==='object'&&!Array.isArray(name)){
    Object.keys(name).forEach(function(key){configure(key,name[key]);});
    return api;
  }
  assertKnown(name);assertAdapter(name,adapter);adapters[name]=adapter;emit(name);return facades[name];
}
function invoke(name,method,args){
  var adapter=adapters[name];
  if(!adapter)throw new Error('AURIS platform service is not configured: '+name);
  var fn=adapter[method];
  if(typeof fn!=='function')throw new Error('AURIS platform service '+name+' does not implement '+method+'().');
  return fn.apply(adapter,args);
}
function facade(name,methods){
  var out={};methods.forEach(function(method){out[method]=function(){return invoke(name,method,arguments);};});
  out.isReady=function(){return !!adapters[name];};
  return Object.freeze(out);
}

var facades={
  auth:facade('auth',['current','isAuthenticated','signIn','signOut','restore']),
  api:facade('api',['request','companyFilter','companyId']),
  rbac:facade('rbac',['role','can','canAccess','requireAccess']),
  audit:facade('audit',['log']),
  notifications:facade('notifications',['queue','relationship','open','recipientIssue'])
};

function get(name){assertKnown(name);return facades[name];}
function health(){
  return Object.freeze(serviceNames.reduce(function(result,name){result[name]=!!adapters[name];return result;},{}));
}
function ready(required){
  required=required||serviceNames;
  return required.every(function(name){assertKnown(name);return !!adapters[name];});
}
function subscribe(listener){
  if(typeof listener!=='function')throw new Error('AURIS service subscriber must be a function.');
  listeners.push(listener);return function(){listeners=listeners.filter(function(item){return item!==listener;});};
}

var api={version:'1.0.0',names:Object.freeze(serviceNames.slice()),configure:configure,get:get,health:health,ready:ready,subscribe:subscribe};
serviceNames.forEach(function(name){api[name]=facades[name];});
root.AurisPlatformServices=Object.freeze(api);
})(typeof window!=='undefined'?window:globalThis);
