const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const sql=fs.readFileSync('supabase/migrations/20260914010000_kpi_monthly_review_delegation.sql','utf8');
const ui=fs.readFileSync('kpi-monthly-review.js','utf8');

test('monthly review delegation is tenant scoped, stage bound and audited',()=>{
  for(const marker of ['create table if not exists public.work_activities','create table if not exists public.work_item_delegations','create or replace function public.add_work_activity','create or replace function public.delegate_work_item','delegation_role','delegate_kpi_monthly_review','p_expected_revision','p_stage','status=\'active\'','AURIS_MONTH_REVIEW_DELEGATION_TARGET','work_activities','audit_events','delegated_reviewer','delegated_approver']) assert.match(sql,new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g,'\\$&')));
  assert.match(sql,/p.company_id=p_company_id and p.status='active'/i);
  assert.match(sql,/p_stage not in \('reviewer','approver'\)/i);
  assert.match(sql,/grant execute on function public\.delegate_kpi_monthly_review/i);
});

test('reviewer and approver reassignment uses the governed RPC and refreshes the exact revision',()=>{
  assert.match(ui,/function canDelegate\(s\)/);
  assert.match(ui,/data-mr-delegate/);
  assert.match(ui,/\/rpc\/delegate_kpi_monthly_review/);
  assert.match(ui,/p_expected_revision:r\.revision/);
  assert.match(ui,/Unconfirmed monthly delegation/);
  assert.match(ui,/await load\(s\)/);
});

test('delegation form never uses browser prompts or direct table writes',()=>{
  const body=ui.slice(ui.indexOf('async function openDelegate'),ui.indexOf('function openWorkflowConfig'));
  assert.doesNotMatch(body,/window\.prompt|document\.execCommand/);
  assert.doesNotMatch(body,/\/kpi_monthly_reviews\?/);
  assert.match(body,/p_reason:reason/);
});
