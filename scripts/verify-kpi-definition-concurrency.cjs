// Real competing sessions, only on the disposable CI migration database.
const {spawn,execFileSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');
const database=process.env.MIGRATION_REPLAY_DATABASE_URL;
const parsed=new URL(database);
if(!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)||parsed.pathname!=='/auris360_migration_replay')throw Error('Disposable local replay database required');
const psql=process.env.PSQL_COMMAND||'psql',args=[database,'-X','-qAt','-v','ON_ERROR_STOP=1'];
const tenant=randomUUID(),actor=randomUUID(),objective=randomUUID();
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const query=sql=>execFileSync(psql,[...args,'-c',sql],{encoding:'utf8',timeout:20000}).trim();
const asActor=`select set_config('request.jwt.claim.sub',${q(actor)},false);set role authenticated;`;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let kpi,indicator,writer;
function save(snapshot,name){
  return `select public.save_kpi_definition(${q(tenant)},${q(kpi)},${snapshot.kpi.definition_revision},${q(JSON.stringify(snapshot.indicators.map(i=>{const copy={...i};delete copy.created_at;return copy;})))}::jsonb,${q(JSON.stringify({...snapshot.kpi,name}))}::jsonb,${q(JSON.stringify(snapshot.indicators))}::jsonb);`;
}
function read(){return JSON.parse(query(`select jsonb_build_object('kpi',to_jsonb(k),'indicators',(select jsonb_agg(to_jsonb(i) order by sort_order) from public.kpi_indicators i where kpi_id=k.id)) from public.kpis_v2 k where id=${q(kpi)};`));}
function session(name){
  const child=spawn(psql,args,{env:{...process.env,PGAPPNAME:name},stdio:['pipe','pipe','pipe']});
  let output='',errors='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>errors+=data);
  const ended=new Promise(resolve=>{child.on('close',code=>resolve({code,output,errors}));child.on('error',error=>resolve({code:-1,output,errors:String(error)}));});
  return {child,ended,output:()=>output,errors:()=>errors};
}
async function until(predicate,label){for(let i=0;i<100;i++){if(predicate())return;await pause(100);}throw Error('Timed out: '+label);}
async function compete(snapshot,secondSql,expectConflict){
  const first=session('auris-kpi-race-first');writer=first;
  first.child.stdin.write('begin;'+asActor+save(snapshot,'First competing save')+"select 'AURIS_LOCK_HELD';\n");
  await until(()=>first.output().includes('AURIS_LOCK_HELD'),'first save: '+first.errors());
  const second=session('auris-kpi-race-second');
  second.child.stdin.end('begin;'+asActor+secondSql+'commit;\n');
  try{
    await until(()=>query("select exists(select 1 from pg_stat_activity where application_name='auris-kpi-race-second' and wait_event_type='Lock');")==='t','second writer must wait for parent lock');
    first.child.stdin.end('commit;\n');
    const [a,b]=await Promise.all([first.ended,second.ended]);
    assert.equal(a.code,0,a.errors);
    if(expectConflict){assert.notEqual(b.code,0);assert.match(b.errors,/AURIS_KPI_EDIT_CONFLICT/);}
    else assert.equal(b.code,0,b.errors);
  }finally{if(first.child.exitCode===null)first.child.kill();if(second.child.exitCode===null)second.child.kill();writer=null;}
}
(async()=>{
  try{
    query(`begin;
      create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to authenticated;
      grant select,insert,update on public.kpis_v2,public.kpi_indicators,public.kpi_monthly_data to authenticated;
      insert into auth.users(id) values(${q(actor)});
      insert into public.companies(id,name) values(${q(tenant)},'KPI concurrency replay');
      insert into public.profiles(id,company_id,role,status) values(${q(actor)},${q(tenant)},'admin','active');
      insert into public.objectives(id,company_id,name,year) values(${q(objective)},${q(tenant)},'Concurrency replay',2026);commit;`);
    const created=query(asActor+`select public.save_kpi_definition(${q(tenant)},null,null,'[]',${q(JSON.stringify({company_id:tenant,objective_id:objective,name:'Initial KPI',frequency:'monthly',year:2026}))},'[ {"name":"Initial indicator","target_value":4,"target_operator":"gte","ytd_method":"sum"} ]');`);
    const result=JSON.parse(created.split('\n').find(line=>line.startsWith('{')));
    kpi=result.kpi.id;indicator=result.indicators[0].id;
    await compete(result,save(result,'Stale competing save'),true);
    assert.equal(read().kpi.name,'First competing save');
    const next=read();
    await compete(next,`insert into public.kpi_monthly_data(company_id,kpi_id,indicator_id,year,month,actual,ytd) values(${q(tenant)},null,${q(indicator)},2026,3,5,5);`,false);
    assert.equal(query(`select actual from public.kpi_monthly_data where indicator_id=${q(indicator)};`),'5');
    const beforeLegacy=read();
    await compete(beforeLegacy,`update public.kpi_indicators set name='Legacy competing write' where id=${q(indicator)};`,false);
    const afterLegacy=read();
    assert.equal(afterLegacy.indicators[0].name,'Legacy competing write');
    assert.ok(afterLegacy.kpi.definition_revision>beforeLegacy.kpi.definition_revision+2);
    console.log('KPI concurrency passed: competing saves, monthly parent locking and legacy indicator revision.');
  }finally{
    if(writer?.child.exitCode===null)writer.child.kill();
    // The database is discarded by CI; retain data only inside this disposable target.
    // Restoring the bootstrap auth function avoids leaking test identity into later gates.
    query('create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;');
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
