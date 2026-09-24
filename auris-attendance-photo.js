(function(root){
'use strict';
var states=new Map();
function context(){return String(ccid()||'')+':'+String(prof&&prof.id||'');}
function valid(photo){return !!photo&&typeof photo.data==='string'&&photo.data.length<=1800000&&/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(photo.data);}
function get(key){var state=states.get(key);if(!state)return null;if(state.context!==context())throw new Error('Company or account changed. Reopen the talk.');if(state.pending)throw new Error('Wait for the attendance photo to finish processing.');return state.photo;}
function mount(key,host,photo){
 if(!host)return;var old=states.get(key);if(old&&old.el)old.el.remove();
 var state={context:context(),photo:valid(photo)?photo:null,pending:false,revision:0},el=document.createElement('section');state.el=el;states.set(key,state);
 el.className='card auris-attendance-photo';var title=document.createElement('h3');title.textContent='Group attendance photo';el.appendChild(title);
 var help=document.createElement('p');help.textContent='Capture or upload a group photo as supporting attendance evidence. The photo is saved with this toolbox talk.';el.appendChild(help);
 var preview=document.createElement('img');preview.alt='Toolbox group attendance';preview.style.cssText='display:none;max-width:100%;max-height:280px';el.appendChild(preview);
 var status=document.createElement('p');status.setAttribute('role','status');el.appendChild(status);
 function render(){preview.hidden=!state.photo;preview.style.display=state.photo?'block':'none';if(state.photo)preview.src=state.photo.data;else preview.removeAttribute('src');status.textContent=state.photo?'Photo attached. Save the talk to retain it.':'No group photo attached.';}
 async function read(file){if(!file)return;var revision=++state.revision;state.pending=true;status.textContent='Processing photo…';var url;
  try{if(!/^image\/(jpeg|png|webp)$/.test(file.type)||file.size>12*1024*1024)throw new Error('Choose a JPEG, PNG or WebP image up to 12 MB.');
   url=URL.createObjectURL(file);var img=new Image();img.src=url;await img.decode();
   if(img.naturalWidth*img.naturalHeight>50000000)throw new Error('Image is too large. Choose a smaller photo.');
   var scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
   var data=canvas.toDataURL('image/jpeg',0.75);if(data.length>1800000)throw new Error('Photo is too detailed. Choose a smaller photo.');
   if(states.get(key)!==state||revision!==state.revision||state.context!==context())return;
   state.photo={data:data,name:String(file.name||'attendance.jpg').slice(0,200),captured_at:new Date().toISOString(),uploaded_by:prof.id};render();
  }catch(error){if(states.get(key)===state&&revision===state.revision)status.textContent=error.message;}finally{if(url)URL.revokeObjectURL(url);if(revision===state.revision)state.pending=false;}
 }
 ['Upload photo','Take photo'].forEach(function(label,i){var input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';input.hidden=true;if(i)input.setAttribute('capture','environment');input.addEventListener('change',function(){read(input.files[0]);input.value='';});var button=document.createElement('button');button.type='button';button.className='btn btn-sm';button.textContent=label;button.addEventListener('click',async function(){if(!i){input.click();return;}try{var data=await root.aurisTakePhoto();if(states.get(key)!==state||state.context!==context())return;if(data.length>1800000)throw Error('Photo is too detailed. Choose a smaller photo.');state.photo={data:data,name:'attendance.jpg',captured_at:new Date().toISOString(),uploaded_by:prof.id};render();}catch(error){if(error.message==='Photo cancelled.')return;input.click();}});el.append(button,input);});
 var remove=document.createElement('button');remove.type='button';remove.className='btn btn-sm';remove.textContent='Remove photo';remove.addEventListener('click',function(){if(state.context!==context())return;state.revision++;state.pending=false;state.photo=null;render();});el.appendChild(remove);host.appendChild(el);render();
}
root.AurisAttendancePhoto=Object.freeze({mount:mount,get:get,valid:valid});
})(window);
