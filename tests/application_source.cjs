const fs=require('node:fs');
const path=require('node:path');

module.exports=function applicationSource(root=path.resolve(__dirname,'..')){
  return fs.readFileSync(path.join(root,'index.html'),'utf8')+'\n'+
    fs.readFileSync(path.join(root,'auris-static-event-handlers.js'),'utf8')+'\n'+
    fs.readFileSync(path.join(root,'auris-generated-event-handlers.js'),'utf8')+'\n'+
    fs.readFileSync(path.join(root,'auris-runtime-event-handlers.js'),'utf8')+'\n'+
    fs.readFileSync(path.join(root,'auris-module-event-handlers-batch-1.js'),'utf8')+'\n'+
    fs.readFileSync(path.join(root,'auris-module-event-handlers-batch-2.js'),'utf8')+'\n'+
    fs.readFileSync(path.join(root,'auris-module-event-handlers-batch-3.js'),'utf8')+'\n'+
    fs.readFileSync(path.join(root,'auris-core.js'),'utf8')+'\n'+
    fs.readFileSync(path.join(root,'auris-detached-modules.js'),'utf8');
};
