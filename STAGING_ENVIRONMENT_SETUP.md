# AURIS360 staging environment setup

The staging environment must be isolated from production at the database, authentication, storage and server-key levels. A Preview deployment is not safe merely because it has a different URL.

## 1. Create the Supabase staging project

Create a separate Supabase project named `auris360-staging` in the same organisation and region as production where practical.

Do not copy client records, authentication users, evidence files or production notification recipients. The staging project should contain only synthetic testing data.

Record these staging-only values securely:

- Project URL
- Publishable or legacy `anon` key
- Service-role key
- Database connection string for controlled migration work

The service-role key is server-only. It must never be placed in application JavaScript, screenshots, documentation, Git or any variable exposed to the browser.

## 2. Establish the schema

AURIS360 currently has historical SQL upgrades but not yet a complete ordered `supabase/migrations` baseline. Do not run the upgrade files in alphabetical order and assume that this recreates production.

Until the migration baseline is completed:

1. Obtain a schema-only backup from the production Supabase project.
2. Review it to ensure that it contains no production rows or secrets.
3. Restore that schema into `auris360-staging`.
4. Apply any later approved upgrade scripts in their documented order.
5. Run `supabase_exposure_security_audit.sql` and the relevant relationship checks.

For the current one-time staging bootstrap on Windows, use:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\copy-production-schema-to-staging.ps1
```

The guarded script accepts only the approved production project as its read-only
source and `beoutmqttgfyyzndcdxu` as its staging write target. It prompts for
Session pooler connection details locally, rejects data-bearing SQL, refuses a
non-empty staging public schema and requires an exact confirmation before import.
Passwords and generated schema files are not retained.

Creating the authoritative migration baseline is a separate required hardening task. Once it exists, staging should be rebuilt from migrations and a committed synthetic seed instead of from a manual schema backup.

## 3. Separate Vercel variables

In **Vercel -> auris-360 -> Settings -> Environment Variables**, edit the current Supabase variables that apply to both Production and Preview.

Production scope:

- `SUPABASE_URL` = production project URL
- `SUPABASE_ANON_KEY` = production publishable/anon key
- `SUPABASE_SERVICE_KEY` = production service-role key

Preview scope:

- `SUPABASE_URL` = staging project URL
- `SUPABASE_ANON_KEY` = staging publishable/anon key
- `SUPABASE_SERVICE_KEY` = staging service-role key

Never reuse the production service-role key in Preview. Preview notification providers should be disabled or connected only to test/sandbox recipients.

## 4. Configure authentication URLs

In the staging Supabase project, configure Auth URL settings for the stable staging/Preview URL used for acceptance testing. Password reset, invitation and confirmation links must return to staging, never to `auris360.app`.

Use staging-only test users for each supported role. Do not invite real client users into the staging project.

## 5. Redeploy and verify

After the Preview variables are saved, redeploy the current feature branch. The Vercel build runs:

```text
node scripts/verify-deployment-environment.cjs
```

The build deliberately fails when:

- Preview points to the production Supabase project.
- Preview has no staging public key.
- Production points to an unapproved project.

On the successful Preview deployment:

1. Open `/api/runtime-config` and confirm that `environment` is `preview` and the URL contains the staging project reference.
2. Confirm that the response does not contain a service-role key.
3. Sign in with a staging test user.
4. Create a synthetic record and confirm it exists only in staging.
5. Confirm the production record count is unchanged.

## 6. Evidence to retain

- Staging project reference (not its keys)
- Preview deployment URL and commit
- Environment-boundary check result
- Staging login test
- Synthetic record ID
- Production before/after record counts
- Tester and date
