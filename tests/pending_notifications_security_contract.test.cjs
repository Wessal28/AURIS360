const assert = require('assert');
const fs = require('fs');

const sql = fs.readFileSync('pending_notifications_security_upgrade.sql', 'utf8');

assert.match(sql, /to_regclass\('public\.pending_notifications'\)/i);
assert.match(sql, /alter view public\.pending_notifications set \(security_invoker=true\)/i);
assert.match(sql, /revoke all on public\.pending_notifications from anon/i);
assert.match(sql, /grant select on public\.pending_notifications to authenticated/i);
assert.doesNotMatch(sql, /drop\s+(?:view|table)/i);

console.log('Pending notifications security contract passed.');
