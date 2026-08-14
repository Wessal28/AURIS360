# Supabase remaining exposure review

Date: 14 August 2026

Project: AURIS360 production (`iarfxjhahzbhncsaohbg`)

## Scope

This gate classified the remaining non-`SECURITY DEFINER` RPCs, anonymous read grants, public policies and default privileges after the privileged-RPC remediation.

## Production findings

- 15 non-privileged functions inherited anonymous/PUBLIC execution.
- Four were trigger-only timestamp/notification-state utilities.
- Three authenticated application RPCs generate equipment references, publish KPI configuration and refresh learning-source impacts.
- The remaining functions normalize internal identity/reference text or validate/escape notification content.
- None is required before authentication.
- No anonymously granted public table lacked RLS.
- 117 tables had anonymous SELECT grants but no applicable anonymous SELECT/ALL policy; RLS already denied those reads.
- No applicable anonymous policy lacked an identity, role, company, tenant or bucket guard.
- Anonymous MAINTAIN grants were present on public tables through broad defaults.
- `supabase_admin` defaults for `public`, `storage`, `graphql` and `graphql_public` are platform-managed and cannot be altered by the project SQL role.

## Applied remediation

`supabase_remaining_exposure_remediation.sql` was applied to production:

- revoked anonymous/PUBLIC execution from all 15 functions;
- retained authenticated/service execution for callable application and internal helper functions;
- limited trigger utilities to direct trigger use and the service role;
- removed redundant anonymous SELECT grants where no applicable read policy exists;
- removed anonymous MAINTAIN grants from public application tables;
- narrowed project-owned `postgres` defaults without modifying Supabase-managed schemas or roles.

The first attempted transaction included `supabase_admin` default changes and was rejected with PostgreSQL `42501`. Because it was transactional, no partial change was committed. The unsupported platform-level statements were removed before the successful production run.

## Live verification

| Check | Result |
| --- | ---: |
| Exposed non-privileged RPCs | 0 |
| Anonymous reads without an applicable policy | 0 |
| Anonymous public-table MAINTAIN grants | 0 |
| Risky project-owned public defaults | 0 |
| Authenticated KPI publish RPC retained | true |
| Authenticated learning refresh RPC retained | true |
| Anonymous read tables without RLS | 0 |
| Weak anonymous policy expressions | 0 |

## Residual control

Supabase-managed defaults remain visible in the catalog. Current public application objects are explicitly hardened and RLS remains the tenant boundary. Re-run both exposure audits after every migration; if a platform-managed default creates a new anonymous grant, the release migration must explicitly revoke it on that object.
