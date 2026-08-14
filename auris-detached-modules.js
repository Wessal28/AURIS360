(function(){
  function placeDetachedModulesInMain(){
    var main = document.querySelector('.main');
    if(!main) return;
    ['page-fire','page-sitemap'].forEach(function(id){
      var page = document.getElementById(id);
      if(page && page.parentElement !== main) main.appendChild(page);
    });
  }
  if(document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', placeDetachedModulesInMain);
  } else {
    placeDetachedModulesInMain();
  }
})();
