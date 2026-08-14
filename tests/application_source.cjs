const fs=require('node:fs');
const path=require('node:path');

module.exports=function applicationSource(root=path.resolve(__dirname,'..')){
  return fs.readFileSync(path.join(root,'index.html'),'utf8')+'\n'+
    fs.readFileSync(path.join(root,'auris-core.js'),'utf8')+'\n'+
    fs.readFileSync(path.join(root,'auris-detached-modules.js'),'utf8');
};
