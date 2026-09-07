const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'../..',file),'utf8');
module.exports=function runtime(){
  let markup='',elements=[];
  const document={activeElement:null},values=new Map(),identity={companyId:'co-a',userId:'user-a',role:'manager'};
  function matches(el,selector){
    if(selector[0]==='.')return (el.attrs.class||'').split(' ').includes(selector.slice(1));
    const match=selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    return match&&Object.hasOwn(el.attrs,match[1])&&(match[2]===undefined||el.attrs[match[1]]===match[2]);
  }
  const host={classList:{add(){}},
    get innerHTML(){return markup;},
    set innerHTML(value){
      markup=value;elements=[];
      for(const match of value.matchAll(/<(button|select|input|details|div)\b([^>]*)>/g)){
        const attrs={},events={};
        for(const attr of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attrs[attr[1]]=attr[2]||'';
        const content=match[1]==='select'?value.slice(match.index+match[0].length,value.indexOf('</select>',match.index)):'';
        const options=[...content.matchAll(/<option value="([^"]*)"([^>]*)>/g)];
        elements.push({attrs,events,value:(options.find(o=>o[2].includes('selected'))||options[0]||[])[1]||attrs.value||'',
          checked:Object.hasOwn(attrs,'checked'),disabled:Object.hasOwn(attrs,'disabled'),hidden:Object.hasOwn(attrs,'hidden'),textContent:'',open:false,scrollLeft:0,scrollTop:0,
          getAttribute(name){return attrs[name]??null;},addEventListener(name,fn){events[name]=fn;},
          fire(name='click'){if(!this.disabled)return events[name]?.();},focus(){document.activeElement=this;}});
      }
    },
    querySelector(selector){return elements.find(el=>matches(el,selector))||null;},
    querySelectorAll(selector){return elements.filter(el=>matches(el,selector));}
  };
  const window={console,Date,document,localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)}};
  vm.runInNewContext(read('auris-view-engine.js'),window);
  const def={fields:[{key:'title',label:'Title',required:true},{key:'status',label:'Status'},{key:'due',label:'Due date',type:'date'}],titleField:'title',groupField:'status'};
  const rows=[{id:'one',company_id:'co-a',title:'First',status:'open',due:'2026-09-01'},{id:'two',company_id:'co-a',title:'Second',status:'closed',due:'2026-09-02'}];
  const options={moduleKey:'test',definition:def,context:()=>identity,actions:[{key:'open',label:'Open'}]};
  function mount(extra={}){Object.assign(options,extra);return window.AurisViewEngine.mount(host,rows,options);}
  function element(selector){const el=host.querySelector(selector);if(!el)throw new Error('Missing control '+selector);return el;}
  function change(selector,value){const el=element(selector);el.value=value;return el.fire('change');}
  return {window,identity,values,host,document,def,rows,options,mount,element,change,click:selector=>element(selector).fire()};
};
