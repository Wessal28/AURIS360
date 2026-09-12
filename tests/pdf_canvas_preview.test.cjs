const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../auris-core.js'),'utf8');
function element(){return {children:[],clientWidth:800,events:{},append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},setAttribute(){},addEventListener(k,v){this.events[k]=v;},getContext(){return {};}};}
function harness(promise){
 let destroyed=false;const rendered=[];
 const pdf={numPages:2,getPage:async n=>({getViewport:({scale})=>({width:600*scale,height:800*scale}),render:()=>{rendered.push(n);return {promise:Promise.resolve()};}})};
 const context={Promise,document:{createElement:element},window:{pdfjsLib:{GlobalWorkerOptions:{},getDocument:()=>({promise:promise||Promise.resolve(pdf),destroy:()=>{destroyed=true;}})}}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('var dcViewerGeneration='),source.indexOf('function dcOpenViewer(doc)')),context);
 return {context,rendered,pdf,isDestroyed:()=>destroyed};
}
test('PDF viewer paints pages and supports page navigation without blocked embeds',async()=>{
 const h=harness(),body=element();await h.context.dcRenderPdfPreview(body,'https://example.test/file.pdf',0);
 assert.deepEqual(h.rendered,[1]);assert.equal(body.children[1].children.length,1);
 const [previous,status,next]=body.children[0].children;
 assert.equal(previous.disabled,true);assert.equal(status.textContent,'Page 1 of 2');
 next.events.click();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(h.rendered,[1,2]);assert.equal(next.disabled,true);assert.equal(status.textContent,'Page 2 of 2');
 assert.doesNotMatch(source.slice(source.indexOf('function dcOpenViewer(doc)'),source.indexOf('function dcViewerFallbackHTML')),/<embed/);
});
test('closing a loading PDF cancels it and prevents late viewer updates',async()=>{
 let finish;const h=harness(new Promise(resolve=>{finish=resolve;})),body=element();
 const pending=h.context.dcRenderPdfPreview(body,'https://example.test/file.pdf',0);
 h.context.dcStopPdfPreview();finish(h.pdf);await pending;
 assert.equal(h.isDestroyed(),true);assert.equal(body.children.length,0);assert.deepEqual(h.rendered,[]);
});
test('failed PDF loading displays an actionable message',async()=>{
 const h=harness(Promise.reject(new Error('unavailable'))),body=element();
 await h.context.dcRenderPdfPreview(body,'https://example.test/file.pdf',0);
 assert.match(body.textContent,/Use Open or Download/);
});
