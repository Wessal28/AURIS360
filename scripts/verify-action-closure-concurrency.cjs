// Real timeout and retry against disposable PostgreSQL; no external delivery.
const {spawn,execFileSync}=require('node:child_process');const {randomUUID}=require('node:crypto');const assert=require('node:assert/strict');
const database=process.env.MIGRATION_REPLAY_DATABASE_URL,parsed=new URL(database);
if(!['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)||parsed.pathname!=='/auris360_migration_replay')throw Error('Disposable replay database required');
const psql=process.env.PSQL_COMMAND||'psql',args=[database,'-X','-qAt','-v','ON_ERROR_STOP=1'];const tenant=randomUUID(),actor=randomUUID(),action=randomUUID(),notice=randomUUID();
const q=v=>"'"+String(v).replaceAll("'","''")+"'";const query=sql=>execFileSync(psql,[...args,'-c',sql],{encoding:'utf8',timeout:15000}).trim();let locker;
const checklist=JSON.stringify(Object.fromEntries([1,2,3,4,5,6].map(n=>[n,{confirmed:true}])));
(async()=>{try{
 query(`create or replace function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;insert into auth.users(id) values(${q(actor)});insert into public.companies(id,name) values(${q(tenant)},'Fictional closure concurrency');insert into public.profiles(id,company_id,role,status,full_name) values(${q(actor)},${q(tenant)},'admin','active','Fixture reviewer');insert into public.action_tracker(id,company_id,description,status,progress_pct,evidence,requires_verification,verification_status,closure_notes,closure_checklist) values(${q(action)},${q(tenant)},'Fictional timeout test','pending_closure',100,'Controlled evidence',true,'passed','Reviewed',${q(checklist)});insert into public.notification_queue(id,company_id,type,subject,body_html,to_email,related_table,related_id,related_module,related_ref) values(${q(notice)},${q(tenant)},'action','Fixture','Not sent','fixture@example.invalid','action_tracker',${q(action)},'actions','MAP-FIXTURE');`);
 const revision=query(`select updated_at from public.action_tracker where id=${q(action)}`);
 locker=spawn(psql,args,{stdio:['pipe','pipe','pipe']});let output='',errors='';locker.stdout.on('data',d=>output+=d);locker.stderr.on('data',d=>errors+=d);const ended=new Promise(resolve=>locker.on('close',resolve));
 locker.stdin.write(`begin;select id from public.notification_queue where id=${q(notice)} for update;select 'LOCK_HELD';\n`);
 for(let n=0;!output.includes('LOCK_HELD');n++){if(n>100)throw Error('Lock not acquired: '+errors);await new Promise(r=>setTimeout(r,50));}
 const close=`select set_config('request.jwt.claim.sub',${q(actor)},false);update public.action_tracker set status='closed' where id=${q(action)} and updated_at=${q(revision)}::timestamptz returning status;`;
 const timed=spawn(psql,args,{stdio:['pipe','pipe','pipe']});let timeoutError='';timed.stderr.on('data',d=>timeoutError+=d);const code=new Promise(resolve=>timed.on('close',resolve));timed.stdin.end("set statement_timeout='200ms';"+close);assert.notEqual(await code,0);assert.match(timeoutError,/statement timeout/);
 assert.equal(query(`select status from public.action_tracker where id=${q(action)}`),'pending_closure');assert.equal(query(`select count(*) from public.map_activity_log where action_id=${q(action)}`),'0');assert.equal(query(`select status from public.notification_queue where id=${q(notice)}`),'pending');assert.equal(query(`select updated_at from public.action_tracker where id=${q(action)}`),revision);
 locker.stdin.end('commit;\n');assert.equal(await ended,0,errors);locker=null;
 assert.match(query(close),/closed/);assert.equal(query(`select count(*) from public.map_activity_log where action_id=${q(action)}`),'1');assert.equal(query(`select status from public.notification_queue where id=${q(notice)}`),'skipped');
 // The stale revision cannot replay a closure or add another audit event.
 assert.doesNotMatch(query(close),/closed/);assert.equal(query(`select count(*) from public.map_activity_log where action_id=${q(action)}`),'1');
 console.log('Action closure concurrency passed: timeout rolls back status, history and notifications; retry commits once.');
}finally{if(locker&&locker.exitCode===null)locker.kill();query('create or replace function auth.uid() returns uuid language sql stable as $$select null::uuid$$;');}})().catch(error=>{console.error(error);process.exitCode=1;});
