# AURIS360 safe release workflow

This workflow separates **committing code** from **releasing code to clients**. Pushing a feature branch is routine; assigning `auris360.app` to a new deployment is a controlled production action.

## One-time production safeguards

### GitHub

Protect `main` in **Repository settings -> Rules -> Rulesets**:

1. Create a branch ruleset targeting the default branch.
2. Require a pull request before merging.
3. Require the `Verify release candidate` status check.
4. Require branches to be up to date before merging.
5. Block force pushes and branch deletion.
6. Allow the repository owner to use the documented emergency rollback process, but do not routinely bypass checks.

### Vercel

In **Project settings -> Environments -> Production -> Branch Tracking**, turn off **Auto-assign Custom Production Domains**. A build from `main` then remains staged until the release owner promotes it.

Keep these environment boundaries:

- Preview deployments: staging Supabase URL and keys.
- Production deployments: production Supabase URL and keys.
- Secrets needed only by server functions must never use a browser-exposed prefix.

## Normal update

1. Start from the latest `main` and create `codex/<change-name>`.
2. Make and locally verify the change.
3. Push the branch. Do not push the update directly to `main`.
4. Open a pull request and wait for **Release readiness** to pass.
5. Test the Vercel Preview deployment using the staging database.
6. Record manual evidence using `RELEASE_ACCEPTANCE_CHECKLIST.md`.
7. Merge the approved pull request to create a staged production build.
8. Verify the staged build, its commit, build logs and non-destructive production smoke checks.
9. Promote that staged build to production.
10. Confirm the **Production smoke** workflow passes for the promoted commit and retain its evidence artifact.
11. Observe authentication, browser errors, API errors and notification failures after promotion.

The production smoke gate is deliberately read-only. It verifies that the canonical domain serves the expected Git commit, the approved production runtime and Supabase project, enforced browser-security headers, the service worker and critical Core Control assets. It never signs in or writes production data.

To repeat it manually from GitHub Actions, run **Production smoke** with the canonical production URL and the full commit SHA expected to be live. A release-identity mismatch is a stop signal: confirm the Vercel promotion rather than accepting evidence from an older deployment.

## Local release checks

Run the complete suite before opening a pull request:

```powershell
git diff --check
npm run check:sw-manifest
npm test
npm run release:readiness -- --report release-evidence/<release-name>.json
```

`npm run release:readiness` does not replace `npm test`; it runs a smaller release-critical subset and records the manual environment gates as pending.

## Database changes

1. Store each change as a timestamped migration in `supabase/migrations`.
2. Apply and verify the migration on staging first.
3. Record before/after relationship and record-count evidence.
4. Prefer additive, backward-compatible changes so the previous application version remains usable.
5. Back up production and identify the recovery procedure before applying the migration.
6. Apply the production migration only once, from a controlled release process.

Never rely on application rollback alone after a destructive or incompatible schema change.

## Stop and rollback conditions

Pause promotion or rollout when any of these occurs:

- Authentication, tenant isolation or confidential-record failure.
- Missing or duplicated production data.
- A core workflow cannot create, reopen or approve its record.
- A migration or relationship check does not pass.
- The dashboard or module shell fails to load without a manual refresh.
- Mobile navigation prevents access to required controls.
- Critical notifications or linked actions fail.
- The Production smoke workflow reports a release-identity, runtime-boundary, security-header or critical-asset failure.

For an application-only incident, restore the last known-good Vercel production deployment. For a database incident, use the migration-specific recovery procedure; do not improvise destructive SQL during the incident.
