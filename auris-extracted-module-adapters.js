(function(root){
'use strict';
var runtime=root.AurisModuleRuntime,registry=root.AurisModuleRegistry,platform=root.AurisPlatformServices;
if(!runtime||!registry||!platform)throw new Error('Extracted module adapters require the registry, runtime and platform services.');
var keys=registry.list().filter(function(module){return !!module.extraction;}).map(function(module){return module.key;});
function contextFor(key){var manifest=registry.get(key),auth=platform.auth.current()||{};return Object.freeze({key:key,manifest:manifest,profile:auth.profile||null,company:auth.company||null,role:platform.rbac.role(),services:platform});}
function mark(key,state){if(!root.document)return;var page=root.document.getElementById('page-'+key);if(page)page.dataset.aurisModuleState=state;}
keys.forEach(function(key){runtime.register(key,{beforeEnter:function(){platform.rbac.requireAccess(key);mark(key,'loading');},enter:function(){mark(key,'ready');if(root.document)root.document.dispatchEvent(new root.CustomEvent('auris:extracted-module-ready',{detail:contextFor(key)}));},leave:function(){mark(key,'idle');}});});
root.AurisExtractedModuleAdapters=Object.freeze({version:'1.0.0',keys:Object.freeze(keys.slice()),contextFor:contextFor});
})(typeof window!=='undefined'?window:globalThis);
