// Real concurrent transactions on the disposable CI database only.
const {spawn,execFileSync}=require('node:child_process'),{randomUUID}=require('node:crypto'),assert=require('node:assert/strict');
const database=process.env.MIGRATION_REPLAY_DATABASE_URL,parsed=new URL(database);
if(!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)||parsed.pathname!=='/auris360_migration_replay')throw Error('Disposable local replay database required');
const psql=process.env.PSQL_COMMAND||'psql',args=[database,'-X','-qAt','-v','ON_ERROR_STOP=1'];
const tenant=randomUUID(),actor=randomUUID(),objective=randomUUID(),kpi=randomUUID(),indicator=randomUUID();
const q=v=>v==null?'null':"'"+String(v).replaceAll("'","''")+"'";
const query=sql=>execFileSync(psql,[...args,'-c',sql],{encoding:'utf8',timeout:20000}).trim();
const actorSql=`select set_config('request.jwt.claim.sub',${q(actor)},false);set role authenticated;`;
const read=month=>{const r=query(`select to_jsonb(m) from public.kpi_monthly_data m where indicator_id=${q(indicator)} and year=2025 and month=${month};`);return r?JSON.parse(r):null;};
const revision=()=>Number(query(`select definition_revision from public.kpis_v2 where id=${q(kpi)};`));
function mutate(month,old,op='save',rev=revision(),actual=10){return `select public.mutate_kpi_monthly_result(${q(tenant)},${q(kpi)},${q(indicator)},2025,${month},${rev},${q(old?.id)},${old?.result_revision??'null'},${q(op)},${q(JSON.stringify({actual,explanation:'Concurrency test',root:'Synthetic'}))}::jsonb);`;}
function session(name){const child=spawn(psql,args,{env:{...process.env,PGAPPNAME:name},stdio:['pipe','pipe','pipe']});let output='',errors='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>errors+=d);const ended=new Promise(resolve=>{child.on('close',code=>resolve({code,output,errors}));child.on('error',e=>resolve({code:-1,errors:String(e)}));});return {child,ended,output:()=>output,errors:()=>errors};}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<100;i++){if(fn())return;await pause(100);}throw Error('Timed out: '+label);}
async function compete(firstSql,secondSql,conflict){
 const first=session('auris-monthly-first'),second=session('auris-monthly-second');
 try{
  first.child.stdin.write('begin;'+actorSql+firstSql+"select 'MONTHLY_LOCK_HELD';\n");
  await until(()=>first.output().includes('MONTHLY_LOCK_HELD'),'first transaction '+first.errors());
  second.child.stdin.end('begin;'+actorSql+secondSql+'commit;\n');
  await until(()=>query("select exists(select 1 from pg_stat_activity where application_name='auris-monthly-second' and wait_event_type='Lock');")==='t','second transaction must wait');
  first.child.stdin.end('commit;\n');
  const [a,b]=await Promise.all([first.ended,second.ended]);assert.equal(a.code,0,a.errors);
  if(conflict){assert.notEqual(b.code,0);assert.match(b.errors,/AURIS_KPI_(MONTHLY_CONFLICT|EDIT_CONFLICT|ANNUAL_RESULT_EXISTS)/);}else assert.equal(b.code,0,b.errors);
 }finally{if(first.child.exitCode===null)first.child.kill();if(second.child.exitCode===null)second.child.kill();}
}
(async()=>{try{
 query(`begin;
  create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema public,auth to authenticated;
  grant select,insert,update,delete on public.kpis_v2,public.kpi_indicators,public.kpi_monthly_data to authenticated;
  insert into auth.users(id) values(${q(actor)});
  insert into public.companies(id,name) values(${q(tenant)},'Monthly concurrency replay');
  insert into public.profiles(id,company_id,role,status) values(${q(actor)},${q(tenant)},'admin','active');
  insert into public.objectives(id,company_id,name,year) values(${q(objective)},${q(tenant)},'Monthly replay',2025);
  insert into public.kpis_v2(id,company_id,objective_id,name,year,frequency) values(${q(kpi)},${q(tenant)},${q(objective)},'Monthly replay',2025,'monthly');
  insert into public.kpi_indicators(id,company_id,kpi_id,name,target_value,target_operator) values(${q(indicator)},${q(tenant)},${q(kpi)},'Count',1,'gte');commit;`);
 await compete(mutate(8,null),mutate(8,null),true);
 let old=read(8);await compete(mutate(8,old,'save',revision(),12),mutate(8,old,'save',revision(),99),true);assert.equal(read(8).actual,12);
 old=read(8);await compete(mutate(8,old,'clear'),mutate(8,old),true);assert.equal(read(8),null);
 await compete(mutate(9,null,'save',revision(),4),mutate(10,null,'save',revision(),8),false);assert.equal(read(10).ytd,12);
 old=read(9);await compete(`update public.kpi_monthly_data set actual=5 where id=${q(old.id)};`,mutate(9,old),true);assert.equal(read(9).actual,5);
 const prior=revision();await compete(`update public.kpis_v2 set name='Changed definition' where id=${q(kpi)};`,mutate(11,null,'save',prior),true);assert.equal(read(11),null);
 query(`delete from public.kpi_monthly_data where indicator_id=${q(indicator)};update public.kpis_v2 set frequency='annual' where id=${q(kpi)};`);
 await compete(mutate(6,null),mutate(7,null),true);assert.equal(read(7),null);
 // Compare database status rules against the real browser calculation, not a duplicate test implementation.
 const vm=require('node:vm'),fs=require('node:fs'),context={document:{readyState:'loading',addEventListener(){}}};context.window=context;vm.createContext(context);
 const source=fs.readFileSync('kpi-module-upgrade.js','utf8').replace("if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',kpiXBoot);else kpiXBoot();",'window.evaluateMonthly=kpiXEvaluate;');vm.runInContext(source,context);
 const vectors=[];
 for(const op of ['gte','gt','lte','lt','eq','zero','zero_tolerance','between','trend_up','trend_down'])for(const value of [null,-4,0,4,8.5,9,10,11,20])for(const risk of [85,95]){
  const ind={target_operator:op,target_value:10,target_value_max:20},config={targets:{at_risk_percent:risk}},expected=context.evaluateMonthly(ind,value,10,config);
  vectors.push({ind,value,config,expected:{status:expected.status,score:expected.score}});
 }
 const scores=JSON.parse(query(`select jsonb_agg(public.kpi_monthly_score(v->'ind',(v->>'value')::numeric,10,v->'config') order by n) from jsonb_array_elements(${q(JSON.stringify(vectors))}::jsonb) with ordinality a(v,n);`));
 scores.forEach((score,n)=>assert.deepEqual(score,vectors[n].expected,JSON.stringify(vectors[n])));
 console.log('Monthly status parity passed: '+scores.length+' operator and configuration comparisons.');
 console.log('Monthly concurrency passed: same-month create/edit, clear versus save, different-month totals, legacy revision, definition edits and annual uniqueness.');
 }finally{
  query(`delete from public.audit_events where company_id=${q(tenant)};delete from public.kpi_monthly_data where indicator_id=${q(indicator)};delete from public.kpi_indicators where id=${q(indicator)};delete from public.kpis_v2 where id=${q(kpi)};delete from public.objectives where id=${q(objective)};delete from public.profiles where id=${q(actor)};delete from public.companies where id=${q(tenant)};delete from auth.users where id=${q(actor)};`);
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
