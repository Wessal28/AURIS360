// Race the actual workflow against source/legacy writes on a disposable database.
const {spawn,execFileSync}=require('node:child_process'),{randomUUID}=require('node:crypto'),assert=require('node:assert/strict');
const database=process.env.MIGRATION_REPLAY_DATABASE_URL,u=new URL(database);
if(!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.pathname!=='/auris360_migration_replay')throw Error('Disposable replay only');
const args=[database,'-X','-qAt','-v','ON_ERROR_STOP=1'],psql=process.env.PSQL_COMMAND||'psql',q=v=>v==null?'null':"'"+String(v).replaceAll("'","''")+"'";
const ids=Object.fromEntries(['company','owner','reviewer','approver','objective','kpi','indicator'].map(k=>[k,randomUUID()]));
const query=sql=>execFileSync(psql,[...args,'-c',sql],{encoding:'utf8',timeout:10000}).trim();
const actor=id=>`select set_config('request.jwt.claim.sub',${q(id)},false);set role authenticated;`;
function session(){const child=spawn(psql,args,{stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);return {child,out:()=>out,err:()=>err,done:new Promise(resolve=>child.on('close',code=>resolve({code,out,err})))};}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function race(firstSql,secondSql,expected){const a=session(),b=session();try{
 a.child.stdin.write('begin;'+firstSql+"select 'REVIEW_HELD';\n");for(let n=0;n<100&&!a.out().includes('REVIEW_HELD');n++)await pause(50);assert.ok(a.out().includes('REVIEW_HELD'),a.err());
 b.child.stdin.end('begin;'+secondSql+'commit;\n');const result=await Promise.race([b.done,pause(5000).then(()=>{throw Error('Review race waited instead of rejecting safely');})]);assert.notEqual(result.code,0);assert.match(result.err,new RegExp(expected));
 a.child.stdin.end('commit;\n');const first=await a.done;assert.equal(first.code,0,first.err);
}finally{for(const x of [a,b])if(x.child.exitCode===null)x.child.kill();}}
const transition=(r,action,who)=>actor(who)+`select public.transition_kpi_monthly_review(${q(ids.company)},2025,8,${q(r?.id)},${r?.revision??'null'},${q(r?.fingerprint||JSON.parse(query(`select public.get_kpi_monthly_review(${q(ids.company)},2025,8);`)).fingerprint)},${q(action)},'Concurrency evidence');`;
(async()=>{try{
 query(`begin;create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 insert into auth.users(id) values(${q(ids.owner)}),(${q(ids.reviewer)}),(${q(ids.approver)});
 insert into public.companies(id,name) values(${q(ids.company)},'Review race');
 insert into public.profiles(id,company_id,role,status) values(${q(ids.owner)},${q(ids.company)},'admin','active'),(${q(ids.reviewer)},${q(ids.company)},'manager','active'),(${q(ids.approver)},${q(ids.company)},'admin','active');
 insert into public.objectives(id,company_id,name,year) values(${q(ids.objective)},${q(ids.company)},'Review race',2025);
 insert into public.kpis_v2(id,company_id,objective_id,name,year,frequency) values(${q(ids.kpi)},${q(ids.company)},${q(ids.objective)},'Review race',2025,'monthly');
 insert into public.kpi_indicators(id,company_id,kpi_id,name,target_value) values(${q(ids.indicator)},${q(ids.company)},${q(ids.kpi)},'Count',1);
 insert into public.kpi_monthly_data(company_id,kpi_id,indicator_id,year,month,actual,ytd) values(${q(ids.company)},${q(ids.kpi)},${q(ids.indicator)},2025,8,2,2);
 insert into public.kpi_config_versions(company_id,version_no,status,configuration) values(${q(ids.company)},1,'published',${q(JSON.stringify({workflow:{stage1:ids.owner,stage2:ids.reviewer,stage3:ids.approver,self_approval:false}}))}::jsonb);
 commit;`);
 const preview=JSON.parse(query(actor(ids.owner)+`select public.get_kpi_monthly_review(${q(ids.company)},2025,8);`).split('\n').at(-1));
 const submit=actor(ids.owner)+`select public.transition_kpi_monthly_review(${q(ids.company)},2025,8,null,null,${q(preview.fingerprint)},'submit','Race');`;
 await race(submit,actor(ids.owner)+`update public.kpi_monthly_data set actual=99 where indicator_id=${q(ids.indicator)};`,'AURIS_MONTH_REVIEW_BUSY');
 let r=JSON.parse(query(`select to_jsonb(t) from public.kpi_monthly_reviews t where company_id=${q(ids.company)};`));
 await race(transition(r,'verify',ids.reviewer),transition(r,'reject',ids.reviewer),'AURIS_MONTH_REVIEW_BUSY');
 r=JSON.parse(query(`select to_jsonb(t) from public.kpi_monthly_reviews t where company_id=${q(ids.company)};`));assert.equal(r.status,'verified');
 assert.equal(query(`select actual from public.kpi_monthly_data where indicator_id=${q(ids.indicator)};`),'2');
 // Reverse order: an in-flight writer owns the scope; a submission cannot pass it.
 query(transition(r,'request_revision',ids.approver));
 const next=JSON.parse(query(actor(ids.owner)+`select public.get_kpi_monthly_review(${q(ids.company)},2025,8);`).split('\n').at(-1));
 const resubmit=actor(ids.owner)+`select public.transition_kpi_monthly_review(${q(ids.company)},2025,8,${q(next.review.id)},${next.review.revision},${q(next.fingerprint)},'submit','Resubmit');`;
 await race(actor(ids.owner)+`update public.kpi_monthly_data set actual=4 where indicator_id=${q(ids.indicator)};`,resubmit,'AURIS_MONTH_REVIEW_BUSY');
 console.log('Monthly review races passed: submission versus legacy write, competing decisions, and writer versus resubmission.');
}finally{query(`delete from public.audit_events where company_id=${q(ids.company)};delete from public.kpi_monthly_reviews where company_id=${q(ids.company)};delete from public.kpi_config_versions where company_id=${q(ids.company)};delete from public.kpi_monthly_data where company_id=${q(ids.company)};delete from public.kpi_indicators where company_id=${q(ids.company)};delete from public.kpis_v2 where company_id=${q(ids.company)};delete from public.objectives where company_id=${q(ids.company)};delete from public.profiles where company_id=${q(ids.company)};delete from public.companies where id=${q(ids.company)};delete from auth.users where id in (${q(ids.owner)},${q(ids.reviewer)},${q(ids.approver)});`);}})().catch(e=>{console.error(e);process.exitCode=1;});
