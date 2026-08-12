const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const repair=fs.readFileSync(path.join(root,'notification_legacy_relationship_repair.sql'),'utf8');
const relationships=fs.readFileSync(path.join(root,'notification_relationships_upgrade.sql'),'utf8');
const inbox=fs.readFileSync(path.join(root,'in_app_notification_centre_upgrade.sql'),'utf8');

test('legacy repair drops the guard before repairing constrained rows',()=>{
  assert.match(repair,/drop constraint if exists notification_queue_workflow_relationship_check[\s\S]*update public\.notification_queue/i);
  assert.match(relationships,/drop constraint if exists notification_queue_workflow_relationship_check[\s\S]*set related_module/i);
});

test('legacy records retain metadata reference or stable record id',()=>{
  assert.match(repair,/metadata#>>'\{relationship,ref\}'[\s\S]*related_id::text/i);
  assert.match(repair,/https:\/\/auris360\.app\/\?goto=/i);
  assert.doesNotMatch(repair,/delete from public\.notification_queue/i);
});

test('constraint is restored not-valid and unresolved history is diagnosed',()=>{
  assert.match(repair,/add constraint notification_queue_workflow_relationship_check[\s\S]*not valid/i);
  assert.match(repair,/select id,type,subject,related_module,related_table,related_id,related_ref/i);
});

test('inbox recipient backfill does not update unresolved constrained rows',()=>{
  assert.match(inbox,/set recipient_profile_id = u\.recipient_profile_id[\s\S]*q\.type in \('test_email','system'\)[\s\S]*nullif\(trim\(q\.related_ref\),''\) is not null/i);
});
