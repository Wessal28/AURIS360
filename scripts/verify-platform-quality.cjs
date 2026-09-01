const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const size=file=>fs.statSync(path.join(root,file)).size;
const html=read('index.html');
const budgets={
  'index.html':900*1024,
  'auris-core.js':3300*1024,
  'auris-module-registry.js':40*1024,
  'auris-application-lifecycle.js':24*1024,
  'auris-command-centre.js':32*1024,
  'auris-view-engine.js':36*1024,
  'auris-record-workspace.js':40*1024
};
const failures=[];
for(const [file,budget] of Object.entries(budgets))if(size(file)>budget)failures.push(`${file} exceeds ${budget} bytes (${size(file)})`);
const initialScripts=[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match=>match[1].split('?')[0]).filter(file=>file&&!file.startsWith('/')&&!/^https?:/i.test(file)&&fs.existsSync(path.join(root,file)));
const initialBytes=[...new Set(initialScripts)].reduce((total,file)=>total+size(file),0);
if(initialBytes>5*1024*1024)failures.push(`initial JavaScript exceeds 5 MiB (${initialBytes})`);
if(!/<html\s+lang=["']en["']/i.test(html))failures.push('document language is missing');
if(!/<meta\s+name=["']viewport["'][^>]*width=device-width/i.test(html))failures.push('responsive viewport is missing');
if(!/focus-visible/.test(read('auris-base.css')))failures.push('keyboard focus-visible treatment is missing');
if(/\son(?:click|change|input|submit|keydown)=/i.test(html))failures.push('executable inline event attributes are forbidden');
if(failures.length){failures.forEach(item=>console.error(item));process.exit(1);}
console.log(`Platform quality budgets passed (${initialBytes} initial JS bytes; ${Object.keys(budgets).length} bounded critical assets).`);
