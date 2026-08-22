const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20260822030000_buildco_mauritius_showcase_seed.sql'), 'utf8');
const player = fs.readFileSync(path.join(root, 'elearning-course-path.js'), 'utf8');
const vercel = fs.readFileSync(path.join(root, 'vercel.json'), 'utf8');

test('BuildCo showcase seed is guarded, labelled and uses non-deliverable identities', () => {
  assert.match(migration, /auris360: allow-data-migration/);
  assert.match(migration, /fictional demonstration data/i);
  assert.match(migration, /non-showcase company named BuildCo Mauritius already exists/i);
  assert.match(migration, /jsonb_build_object\('is_demo',true/);
  const emails = migration.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  assert.ok(emails.length >= 12, 'expected fictional employee and workflow contacts');
  assert.ok(emails.every((email) => email.toLowerCase().endsWith('.example.invalid')), `deliverable-looking demo email found: ${emails.join(', ')}`);
});

test('BuildCo showcase covers every client-facing module family with linked records', () => {
  const requiredTables = [
    'companies', 'sites', 'people', 'objectives', 'kpis_v2', 'work_schedule',
    'events', 'investigations', 'safety_observations', 'bbs_programmes', 'inspections',
    'risk_assessments', 'permits', 'tools_register', 'atex_areas', 'fire_layouts',
    'contractors', 'emergency_plans', 'medical_surveillance', 'ppe_catalogue',
    'fire_certificates', 'chemical_register', 'waste_records', 'noise_mgmt_programmes',
    'hse_meetings', 'training_plan', 'elearning_courses', 'action_tracker',
    'legal_requirements', 'sop_documents', 'jsa_records', 'documents',
    'moc_change_requests', 'integrations', 'approval_workflows', 'approval_requests',
    'audit_events'
  ];
  for (const table of requiredTables) {
    assert.match(migration, new RegExp(`insert\\s+into\\s+public\\.${table}\\b`, 'i'), `missing showcase coverage for ${table}`);
  }
  assert.match(migration, /RA-BC-2026-014[\s\S]*PTW-BC-2026-081/);
  assert.match(migration, /INV-BC-2026-006/);
  assert.match(migration, /CLIENT SHOWCASE — FICTIONAL DATA/);
});

test('showcase site and fire plans are local, labelled SVG assets', () => {
  for (const name of ['buildco-mauritius-site-plan.svg', 'buildco-mauritius-fire-plan.svg']) {
    const file = path.join(root, 'assets', 'demo', name);
    assert.ok(fs.existsSync(file), `${name} is missing`);
    const svg = fs.readFileSync(file, 'utf8');
    assert.match(svg, /DEMO PLAN/);
    assert.match(migration, new RegExp(`/assets/demo/${name.replaceAll('.', '\\.')}`));
  }
});

test('authoritative externally hosted training videos use the privacy embed allowlist', () => {
  assert.match(migration, /youtube\.com\/watch\?v=aTOOegjstG0/);
  assert.match(migration, /youtube\.com\/watch\?v=GEyC112dO44/);
  assert.match(player, /www\.youtube-nocookie\.com/);
  assert.match(player, /\^\[A-Za-z0-9_-\]\{11\}\$/);
  assert.match(player, /Confirm video completed/);
  assert.match(vercel, /frame-src[^;]+https:\/\/www\.youtube-nocookie\.com/);
});
