'use strict';
// Real competing account-link sessions, confined to the disposable CI database.
const {spawn,execFileSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');

function verifyTarget(value){
  let parsed;try{parsed=new URL(value);}catch{throw Error('A disposable local replay database URL is required');}
  if(!['postgres:','postgresql:'].includes(parsed.protocol)||!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)||parsed.pathname!=='/auris360_migration_replay')throw Error('Only the named disposable localhost replay database is allowed');
  return parsed;
}
async function main(){
  const database=process.env.MIGRATION_REPLAY_DATABASE_URL,parsed=verifyTarget(database);
  if(process.argv.includes('--check')){console.log('People/account concurrency target is a named disposable localhost database.');return;}
  if(process.env.AURIS360_MIGRATION_REPLAY_CONFIRM!=='REPLAY LOCAL MIGRATIONS')throw Error('Explicit disposable migration replay confirmation is required');
  const psql=process.env.PSQL_COMMAND||'psql',args=[database,'-X','-qAt','-v','ON_ERROR_STOP=1'];
  const company=randomUUID(),actor=randomUUID(),firstUser=randomUUID(),secondUser=randomUUID();
  const contact='fictional-'+company+'@linking.test';
  const q=value=>"'"+String(value).replaceAll("'","''")+"'";
  const safe=value=>String(value||'').replaceAll(database,'[local replay]').replaceAll(decodeURIComponent(parsed.password||'')||'\0','[redacted]').slice(0,4000);
  function query(sql){try{return execFileSync(psql,[...args,'-c',sql],{encoding:'utf8',timeout:20000,stdio:['pipe','pipe','pipe']}).trim();}catch(error){throw Error('People/account concurrency query failed: '+safe(error.stderr||error.code));}}
  function session(name){
    const child=spawn(psql,args,{env:{...process.env,PGAPPNAME:name},stdio:['pipe','pipe','pipe']});
    let output='',errors='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors+=chunk);
    const ended=new Promise(resolve=>{child.on('close',code=>resolve({code,output,errors:safe(errors)}));child.on('error',error=>resolve({code:-1,output,errors:safe(error.code)}));});
    return {child,ended,output:()=>output,errors:()=>safe(errors)};
  }
  async function until(predicate,label){for(let attempt=0;attempt<100;attempt++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Timed out: '+label);}
  const payload=q(JSON.stringify({full_name:'Fictional Concurrent Worker',email:contact,role:'employee'}));
  const call=id=>`select public.admin_link_user_person(${q(actor)},${q(company)},${q(id)},${payload}::jsonb,null,false,false);`;
  let first,second;
  try{
    query(`begin;insert into auth.users(id) values(${q(actor)}),(${q(firstUser)}),(${q(secondUser)});insert into public.companies(id,name) values(${q(company)},'Fictional account-link concurrency');insert into public.profiles(id,company_id,full_name,role,status) values(${q(actor)},${q(company)},'Fictional link administrator','admin','active');commit;`);
    const prefix='auris-person-'+company.slice(0,8);
    first=session(prefix+'-first');
    first.child.stdin.write("set statement_timeout='15s';begin;"+call(firstUser)+"select 'AURIS_PEOPLE_LINK_LOCK_HELD';\n");
    await until(()=>first.output().includes('AURIS_PEOPLE_LINK_LOCK_HELD'),'first user link must complete while its transaction remains open: '+first.errors());
    second=session(prefix+'-second');second.child.stdin.end("set statement_timeout='15s';begin;"+call(secondUser)+'commit;\n');
    await until(()=>query(`select exists(select 1 from pg_stat_activity where application_name=${q(prefix+'-second')} and wait_event_type='Lock' and lower(wait_event)='advisory');`)==='t','second user link must wait for the company identity lock');
    first.child.stdin.end('commit;\n');
    const [a,b]=await Promise.all([first.ended,second.ended]);
    assert.equal(a.code,0,a.errors);assert.equal(b.code,0,b.errors);
    const resultA=JSON.parse(a.output.split('\n').find(line=>line.startsWith('{')));
    const resultB=JSON.parse(b.output.split('\n').find(line=>line.startsWith('{')));
    assert.equal(resultA.ok,true);assert.ok(resultA.person_id);
    assert.ok((resultB.ok===false&&resultB.code==='identity_conflict')||(resultB.ok===true&&resultB.person_id===resultA.person_id),'The second request must safely reuse or report the established identity');
    assert.equal(query(`select count(*) from public.people where company_id=${q(company)} and public.user_person_email_key(email)=${q(contact)};`),'1');
    assert.equal(query(`select count(*) from public.profiles where person_id=${q(resultA.person_id)};`),'1');
    assert.equal(query(`select id from public.profiles where person_id=${q(resultA.person_id)};`),firstUser);
    assert.equal(query(`select count(*) from public.person_identity_decisions where company_id=${q(company)} and source_table='profiles';`),'1');
    assert.equal(query(`select concat_ws(' ',first_name,last_name) from public.people where id=${q(resultA.person_id)};`),'Fictional Concurrent Worker');
    console.log('People/account concurrency passed: second session waited for identity lock; one Person, one profile link, one audit event; no overwrite.');
  }finally{
    for(const active of [first,second])if(active?.child.exitCode===null){active.child.kill();await active.ended;}
    query(`begin;delete from public.person_identity_decisions where company_id=${q(company)};delete from public.profiles where company_id=${q(company)} and id<>${q(actor)};delete from public.people where company_id=${q(company)};delete from public.profiles where id=${q(actor)} and company_id=${q(company)};delete from public.companies where id=${q(company)};delete from auth.users where id in (${q(actor)},${q(firstUser)},${q(secondUser)});commit;`);
  }
}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={verifyTarget};
