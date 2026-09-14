const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'api','process-kpi-review-reminders.js'),'utf8');
const worker=require(path.join(root,'api','process-kpi-review-reminders.js'))._test;
const email=require(path.join(root,'api','send-emails.js'))._test;
const vercel=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));

test('KPI review reminders are protected, exact and idempotent',()=>{
  assert.match(source,/CRON_SECRET/);
  assert.match(source,/SUPABASE_SERVICE_KEY/);
  assert.match(source,/kpi_monthly_reviews/);
  assert.match(source,/notification_queue/);
  assert.match(source,/kpi-review-reminder\//);
  assert.match(source,/on_conflict=company_id%2Cidempotency_key/);
  assert.match(source,/resolution=ignore-duplicates/);
  assert.match(source,/Content-Type.*application\/json/);
  assert.match(source,/submitted.*verified/);
});

test('only stale assigned review stages become reminders',()=>{
  const now=new Date('2026-09-13T12:00:00Z');
  const stale={id:'r1',company_id:'c1',year:2026,month:8,status:'submitted',updated_at:'2026-09-11T11:59:00Z',route:{reviewer:'11111111-1111-4111-8111-111111111111',approver:'22222222-2222-4222-8222-222222222222'}};
  assert.deepEqual(worker.reminderForReview(stale,now),{ageDays:2});
  assert.equal(worker.assignedProfileId(stale),'11111111-1111-4111-8111-111111111111');
  assert.equal(worker.assignedProfileId({...stale,status:'verified'}),'22222222-2222-4222-8222-222222222222');
  assert.equal(worker.reminderForReview({...stale,status:'approved'},now),null);
  assert.equal(worker.reminderForReview({...stale,updated_at:'2026-09-13T00:01:00Z'},now),null);
});

test('reminders use deliverable email, exact record identity and safe body text',()=>{
  const review={id:'r1',company_id:'c1',year:2026,month:8,status:'verified'};
  assert.equal(worker.bestEmail({real_email:'worker.local',email:'Reviewer@Example.com'}),'reviewer@example.com');
  assert.equal(worker.bestEmail({real_email:'worker.local',email:'worker.local'}),null);
  const url=worker.reviewUrl(review);assert.match(url,/goto=objectives/);assert.match(url,/review=r1/);assert.match(url,/company=c1/);
  assert.match(worker.reminderBody(review,{full_name:'<Reviewer>'},url,3),/&lt;Reviewer&gt;/);
  assert.doesNotMatch(worker.reminderBody(review,{full_name:'<Reviewer>'},url,3),/<Reviewer>/);
});

test('review reminder worker runs every five minutes and follows due email preference',()=>{
  assert.equal(vercel.crons.find(row=>row.path==='/api/process-kpi-review-reminders').schedule,'*/5 * * * *');
  assert.equal(email.preferenceForType('kpi_monthly_review_due'),'notify_on_overdue');
});
