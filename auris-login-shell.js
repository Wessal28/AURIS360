(function(){
'use strict';
var fallback='/assets/auris360-logo-final.png';
function isLogo(image){return image&&image.tagName==='IMG'&&image.classList.contains('login-logo');}
function failed(image){
 if(!isLogo(image))return;
 if(new URL(image.src,location.href).pathname!==fallback){image.src=fallback;return;}
 image.hidden=true;
 var text=document.getElementById('login-brand-fallback');if(text)text.hidden=false;
}
document.addEventListener('error',function(event){failed(event.target);},true);
document.addEventListener('load',function(event){if(!isLogo(event.target))return;event.target.hidden=false;var text=document.getElementById('login-brand-fallback');if(text)text.hidden=true;},true);
var logo=document.querySelector('.login-logo');if(logo&&logo.complete&&!logo.naturalWidth)failed(logo);
})();
