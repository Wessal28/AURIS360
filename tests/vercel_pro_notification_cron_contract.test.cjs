const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const vercel=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
const frequent=['/api/send-emails','/api/process-escalations','/api/send-push','/api/send-whatsapp','/api/process-acknowledgements'];
const workerFiles=['send-emails.js','process-escalations.js','send-push.js','send-whatsapp.js','process-acknowledgements.js'];

test('Vercel Pro notification workers run every five minutes while digest remains daily',()=>{
  const schedules=Object.fromEntries(vercel.crons.map(row=>[row.path,row.schedule]));
  frequent.forEach(route=>assert.equal(schedules[route],'*/5 * * * *',route));
  assert.equal(schedules['/api/process-digests'],'55 8 * * *');
});

test('every scheduled notification worker requires the exact Vercel cron secret',()=>{
  workerFiles.concat('process-digests.js').forEach(file=>{
    const source=fs.readFileSync(path.join(root,'api',file),'utf8');
    assert.match(source,/process\.env\.CRON_SECRET/,file);
    assert.match(source,/authorization/,file);
    assert.doesNotMatch(source,/x-vercel-cron/,file+' must not trust a caller-supplied marker header');
  });
});

test('production setup documents Vercel variables, UTC scheduling and log verification',()=>{
  const setup=fs.readFileSync(path.join(root,'EMAIL_SETUP.md'),'utf8');
  assert.match(setup,/NOTIFICATION_SCHEDULE_MODE=vercel_pro/);
  assert.match(setup,/Cron expressions use UTC/);
  assert.match(setup,/View Logs/);
  assert.match(setup,/Production, Preview and Development/);
});
