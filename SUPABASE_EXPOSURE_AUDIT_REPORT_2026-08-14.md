# Supabase API exposure assessment

Date: 14 August 2026  
Project: AURIS360 production (`iarfxjhahzbhncsaohbg`)

## Live read-only audit result

The catalog audit returned 779 raw findings. Most table and column findings are Supabase role grants evaluated behind RLS and are not, by themselves, proof of data exposure.

Confirmed controls:

- no public table with API grants was found without RLS;
- no unsafe non-invoker view finding was returned;
- `storage.objects` has RLS enabled;
- 213 policies applying to `anon`/`public` were reviewed by expression;
- the only policies without a visible user/company guard were intentional bucket reads for `logos`, `layouts`, and `documents`; storage mutations require `auth.role() = 'authenticated'`.

## Confirmed remediation findings

- 225 public tables exposed anonymous mutation grants before RLS evaluation.
- 29 callable `SECURITY DEFINER` functions exist.
- 12 callable privileged functions inherited PUBLIC execution.
- 2 privileged functions had no fixed search path.
- 8 PUBLIC callable privileged helpers had no visible caller-identity guard:
  - identity/reference backfill helpers;
  - identity resolution helpers;
  - legacy notification queue and sent-state helpers.
- `auth_company_id()` and `is_sephs_admin()` were directly executable by `anon`; both use caller identity but do not need pre-authentication access.

## Remediation decision

`supabase_exposure_security_remediation.sql`:

- removes anonymous mutation grants from public application tables and sequences;
- makes the eight internal helpers service-role only;
- keeps six caller-aware workflow helpers available only to authenticated and service roles;
- removes browser execution from privileged trigger functions;
- fixes privileged function search paths;
- secures defaults for future public tables, sequences and functions;
- preserves authenticated application access and intentional public storage reads.

Broad authenticated revokes were deliberately not applied. AURIS360 is a browser application whose signed-in requests use the `authenticated` Postgres role, with RLS providing the tenant and user boundary.

## Production application and verification

The targeted migration was applied to production on 14 August 2026 and committed successfully. A direct catalog verification returned:

- anonymous mutation tables: `0`;
- anonymous sequence grants: `0`;
- anonymously/PUBLIC-callable `SECURITY DEFINER` functions: `0`;
- authenticated workflow helper access retained: `true`;
- service-role internal helper access retained: `true`;
- browser execution on internal trigger helpers: `false`.

The full audit was then rerun. The former anonymous-mutation, privileged-RPC and unsafe-search-path categories no longer appeared. Remaining rows are the expected RLS-protected SELECT/column grants, authenticated defaults and non-privileged RPC review items:

| Severity | Category | Count |
| --- | --- | ---: |
| Critical | Column privileges | 231 |
| Critical | Default privileges | 12 |
| Review | Column privileges | 246 |
| Review | Default privileges | 12 |
| Review | RPC exposure | 15 |

The two remaining `Critical` labels are conservative audit classifications for anonymous SELECT/default grants. No public table with API grants lacks RLS, so these are retained for the intended public/RLS-controlled read paths and remain subject to periodic review.
