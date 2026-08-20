# AURIS360 ordered database migrations

This directory is the authoritative, ordered database change history starting with a schema-only snapshot of the verified staging environment.

Rules:

- Files use `YYYYMMDDHHMMSS_lower_snake_case.sql` names.
- The first file is the single `_schema_baseline.sql` snapshot.
- Baselines never contain table rows, Auth users, credentials, or top-level DML.
- A later migration containing intentional data changes must include `-- auris360: allow-data-migration` and receive explicit review.
- Existing migration files are immutable after promotion. Corrections are new migrations.
- Every migration must pass on staging before a production promotion is approved.
- `manifest.json` records the ordered filenames and SHA-256 checksums.

Capture the initial baseline only from the isolated staging project:

```powershell
npm run migration:capture-baseline
```

If `npm` is not installed in the Windows terminal, run the PowerShell entry point directly:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\capture-staging-schema-baseline.ps1
```

Validate the baseline and all later migrations:

```powershell
npm run migration:validate
```

The required pull-request workflow also replays the complete ordered history on
a fresh local PostgreSQL service and compares the resulting tables, policies and
routines with `replay-expectations.json`. The replay command is deliberately
restricted to `localhost` and the database name `auris360_migration_replay`; it
cannot be pointed at production or staging.
