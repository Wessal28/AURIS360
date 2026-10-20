// Generates rollback-only SQL for the localhost-only disposable migration replay.
// This module has no database connection or executable CLI of its own.
const OPTIONAL_TABLES = Object.freeze([
  'safety_awareness_topics', 'toolbox_talks', 'safety_alerts', 'safety_bulletins'
]);

function transactionBody(sql, closing, label) {
  const lines = String(sql).replace(/\r\n/g, '\n').split('\n');
  if (lines.some(line => /^\s*\\/.test(line))) throw Error(`${label} cannot contain psql commands`);
  const boundaries = lines.flatMap((line, index) => /^\s*(begin|commit|rollback)\s*;\s*(?:--.*)?$/i.test(line) ? [index] : []);
  if (boundaries.length !== 2 || !/^\s*begin\s*;/i.test(lines[boundaries[0]]) ||
    !new RegExp(`^\\s*${closing}\\s*;`, 'i').test(lines[boundaries[1]])) {
    throw Error(`${label} must have one BEGIN/${closing.toUpperCase()} transaction envelope`);
  }
  // Do not permit executable statements outside the one reviewed envelope.
  for (const line of [...lines.slice(0, boundaries[0]), ...lines.slice(boundaries[1] + 1)]) {
    if (line.trim() && !/^\s*--/.test(line)) throw Error(`${label} has statements outside its transaction`);
  }
  return lines.slice(boundaries[0] + 1, boundaries[1]).join('\n');
}

function buildMeetingsRpcIsolationFixture({ repair, installationAssertions, behaviorAssertions }) {
  const repairBody = transactionBody(repair, 'commit', 'Minutes repair');
  const installationBody = transactionBody(installationAssertions, 'rollback', 'Minutes catalog assertions');
  const behaviorBody = transactionBody(behaviorAssertions, 'rollback', 'Minutes behavior assertions');
  const preflight = repairBody.match(/^do \$minutes_preflight\$[\s\S]*?^end \$minutes_preflight\$;/m)?.[0];
  if (!preflight || preflight.includes('$fixture_preflight_sql$')) throw Error('Minutes repair metadata preflight is missing or ambiguous');
  const absent = OPTIONAL_TABLES.map(table => `
  if to_regclass('public.${table}') is not null or to_regclass('public.__fixture_missing_${table}') is null
  then raise exception 'Optional table ${table} must remain absent during the repair fixture';end if;`).join('');
  const assertAbsent = `do $optional_absence$ begin${absent}\nend $optional_absence$;`;
  return [
    '-- Disposable CI database only. One connection; every fixture change is rolled back.',
    'begin;',
    "set local statement_timeout='30s';",
    '-- A missing access helper must fail in the metadata preflight, without weakening policy.',
    'alter function public.user_access_allowed(text,text) rename to __fixture_missing_user_access_allowed;',
    `do $fixture_missing_helper$
declare failure_detail text;
begin
  begin
    execute $fixture_preflight_sql$${preflight}$fixture_preflight_sql$;
    raise exception 'Minutes preflight accepted a missing permission helper';
  exception when raise_exception then
    get stacked diagnostics failure_detail=pg_exception_detail;
    if sqlerrm<>'Minutes repair prerequisites are incomplete'
      or position('function public.user_access_allowed(text,text)' in coalesce(failure_detail,''))=0 then raise;end if;
  end;
end $fixture_missing_helper$;`,
    'alter function public.__fixture_missing_user_access_allowed(text,text) rename to user_access_allowed;',
    ...OPTIONAL_TABLES.map(table => `alter table public.${table} rename to __fixture_missing_${table};`),
    assertAbsent,
    'drop function public.save_hse_minutes(uuid,jsonb,timestamptz);',
    '-- Install from the actual repair file, then exercise its idempotence.',
    repairBody,
    repairBody,
    installationBody,
    '-- Save and update actual fictional minutes while the optional tables are absent.',
    behaviorBody,
    assertAbsent,
    'rollback;',
    ''
  ].join('\n');
}

module.exports = { OPTIONAL_TABLES, transactionBody, buildMeetingsRpcIsolationFixture };
