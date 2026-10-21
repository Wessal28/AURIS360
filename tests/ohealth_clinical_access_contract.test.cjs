const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261014010000_occupational_health_clinical_access.sql'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'auris-ohealth-worker.js'), 'utf8');

test('every clinical table has a restrictive policy for reads and writes', () => {
  for (const table of ['medical_surveillance', 'audiometry_records', 'spirometry_records',
    'vaccination_records', 'occupational_diseases', 'exposure_monitoring']) {
    assert.match(migration, new RegExp(`'${table}'`));
  }
  assert.match(migration, /create policy clinical_role_access on public\.%I as restrictive for all to authenticated/i);
  assert.match(migration, /with check \(public\.can_access_occupational_health_clinical\(\)\)/i);
  assert.match(migration, /p\.role in \('occupational_health', 'sephs_admin', 'admin'\)/);
});

test('operational RPC returns only current fitness fields and checks tenant and role', () => {
  const projection = migration.slice(migration.indexOf('create or replace function public.occupational_fitness_summaries'));
  assert.match(projection, /security definer/);
  assert.match(projection, /actor\.company_id is distinct from p_company_id/);
  assert.match(projection, /actor\.role is null/);
  assert.match(projection, /user_access_allowed\('ohealth', 'view'\)/);
  assert.match(projection, /distinct on/);
  assert.match(projection, /case when m\.fitness_status = 'fit_with_restrictions' then m\.restrictions else null end/);
  for (const sensitive of ['medical_notes', 'referral_details', 'blood_pressure', 'audiometry_records', 'spirometry_records']) {
    assert.doesNotMatch(projection, new RegExp(`m\\.${sensitive}`));
  }
  assert.match(worker, /if\(!clinicalAccess\(\)\)\{await loadOperationalSummary\(\);return;\}/);
  assert.match(worker, /if\(!clinicalAccess\(\)&&tab!=='dash'\)/);
});
