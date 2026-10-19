// MAP's editor is loaded only when an action is created or edited.
var mapEditorSession=null,mapEditorInitial=null,mapEditorBusy=false,mapEditorOpening=0;
var mapEditorLoadPromise=null;
function mapEditorDirty(){return false;}
async function mapEditorLeave(){return true;}
function mapEnsureEditor(){
 if(typeof mapEditorBegin==='function')return Promise.resolve();
 if(!mapEditorLoadPromise)mapEditorLoadPromise=new Promise(function(resolve,reject){var script=document.createElement('script');script.src='auris-action-editor.js?v=20261018-1';script.onload=function(){if(typeof mapEditorBegin==='function')resolve();else reject(new Error('The action editor did not initialise. Reload and retry.'));};script.onerror=function(){script.remove();reject(new Error('The action editor could not load. Your saved records are unchanged. Reconnect and retry.'));};document.head.appendChild(script);}).catch(function(error){mapEditorLoadPromise=null;throw error;});
 return mapEditorLoadPromise;
}
