// Never use real staging/production data for competing transaction tests.
const {spawn,execFileSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');
const database=process.env.MIGRATION_REPLAY_DATABASE_URL;
const parsed=new URL(database);
if(!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)||parsed.pathname!=='/auris360_migration_replay')throw Error('Disposable local replay database required');
const psql=process.env.PSQL_COMMAND||'psql',args=[database,'-X','-qAt','-v','ON_ERROR_STOP=1'];
const tenant=randomUUID(),actor=randomUUID();
const q=value=>"'"+String(value).replaceAll("'","''")+"'";
const query=sql=>execFileSync(psql,[...args,'-c',sql],{encoding:'utf8',timeout:20000}).trim();
const asActor=`select set_config('request.jwt.claim.sub',${q(actor)},false);set role authenticated;`;
const definition={company_id:tenant,name:'Objective concurrency',code:'',year:2026,color:'#1D9E75'};
function save(item,patch={}){return `select public.save_objective_definition(${q(tenant)},${item?q(item.id):'null'},${item?item.definition_revision:'null'},${q(JSON.stringify({...definition,...item,...patch}))}::jsonb);`;}
function read(id){return JSON.parse(query(`select to_jsonb(o) from public.objectives o where id=${q(id)};`));}
function result(output){return JSON.parse(output.split('\n').find(line=>line.startsWith('{')));}
function create(){return result(query(asActor+save(null)));}
function createKpi(obj){return `select public.save_kpi_definition(${q(tenant)},null,null,'[]',${q(JSON.stringify({company_id:tenant,objective_id:obj.id,name:'Competing KPI',frequency:'monthly',year:2026}))},'[{"name":"Measure","target_value":4,"target_operator":"gte","ytd_method":"sum"}]');`;}
function session(name){
  const child=spawn(psql,args,{env:{...process.env,PGAPPNAME:name},stdio:['pipe','pipe','pipe']});
  let output='',errors='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>errors+=data);
  const ended=new Promise(resolve=>{child.on('close',code=>resolve({code,output,errors}));child.on('error',error=>resolve({code:-1,output,errors:String(error)}));});
  return {child,ended,output:()=>output,errors:()=>errors};
}
async function until(predicate,label){for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Timed out: '+label);}
async function compete(firstSql,secondSql,error){
  const first=session('auris-objective-first');let second;
  try{
    first.child.stdin.write('begin;'+asActor+firstSql+"select 'AURIS_LOCK_HELD';\n");
    await until(()=>first.output().includes('AURIS_LOCK_HELD'),'first save: '+first.errors());
    second=session('auris-objective-second');
    second.child.stdin.end('begin;'+asActor+secondSql+'commit;\n');
    await until(()=>query("select exists(select 1 from pg_stat_activity where application_name='auris-objective-second' and wait_event_type='Lock');")==='t','second writer must wait');
    first.child.stdin.end('commit;\n');
    const [a,b]=await Promise.all([first.ended,second.ended]);
    assert.equal(a.code,0,a.errors);
    if(error){assert.notEqual(b.code,0);assert.ok(b.errors.includes(error),b.errors);}
    else assert.equal(b.code,0,b.errors);
    return [a,b];
  }finally{if(first.child.exitCode===null)first.child.kill();if(second?.child.exitCode===null)second.child.kill();}
}
(async()=>{
  try{
    query(`begin;
      create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to authenticated;
      grant select,insert,update on public.objectives to authenticated;
      insert into auth.users(id) values(${q(actor)});
      insert into public.companies(id,name) values(${q(tenant)},'Objective concurrency replay');
      insert into public.profiles(id,company_id,role,status) values(${q(actor)},${q(tenant)},'admin','active');commit;`);
    const original=create();
    await compete(save(original,{name:'First objective save'}),save(original,{name:'Stale objective save'}),'AURIS_OBJECTIVE_EDIT_CONFLICT');
    assert.equal(read(original.id).name,'First objective save');
    assert.equal(read(original.id).definition_revision,2);
    const [allocatedA,allocatedB]=await compete(save(null),save(null));
    assert.equal(result(allocatedA.output).code,'2');assert.equal(result(allocatedB.output).code,'3');
    const linking=create();
    await compete(createKpi(linking),save(linking,{year:2027}),'AURIS_OBJECTIVE_YEAR_HAS_KPIS');
    assert.equal(read(linking.id).year,2026);
    assert.equal(query(`select count(*) from public.kpis_v2 where objective_id=${q(linking.id)} and year=2026;`),'1');
    const moving=create();
    await compete(save(moving,{year:2027}),createKpi(moving),'AURIS_KPI_OBJECTIVE_REQUIRED');
    assert.equal(read(moving.id).year,2027);
    assert.equal(query(`select count(*) from public.kpis_v2 where objective_id=${q(moving.id)};`),'0');
    const legacy=read(original.id);
    await compete(save(legacy,{name:'Modern edit'}),`update public.objectives set name='Legacy edit',definition_revision=0 where id=${q(legacy.id)};`);
    assert.equal(read(legacy.id).name,'Legacy edit');assert.equal(read(legacy.id).definition_revision,legacy.definition_revision+2);
    console.log('Objective concurrency passed: stale saves, unique automatic codes, both KPI/year race orders and legacy revisions.');
  }finally{
    query('create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;');
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
