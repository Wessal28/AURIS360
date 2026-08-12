const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('public app and notification links use the canonical auris360.app origin',()=>{
  const files=[
    'index.html',
    'api/notification-open.js',
    'api/send-emails.js',
    'api/send-whatsapp.js',
    'action_notification_digest_upgrade.sql',
    'action_notification_escalation_upgrade.sql',
    'notification_acknowledgement_control_upgrade.sql',
    'notification_legacy_relationship_repair.sql',
    'notification_relationships_upgrade.sql'
  ];
  for(const file of files){
    const source=read(file);
    assert.match(source,/https:\/\/auris360\.app/,`${file} must reference the canonical origin`);
    assert.doesNotMatch(source,/https:\/\/(?:auris-360\.vercel\.app|app\.auris360\.com)/,`${file} contains a retired public origin`);
  }
});

test('database migration updates active links without rewriting sent evidence',()=>{
  const sql=read('canonical_domain_migration.sql');
  assert.match(sql,/status in \('pending', 'processing', 'failed'\)/);
  assert.match(sql,/pg_get_functiondef/);
  assert.match(sql,/https:\/\/auris360\.app/);
  assert.doesNotMatch(sql,/update public\.notification_queue[\s\S]*where status = 'sent'/);
});
