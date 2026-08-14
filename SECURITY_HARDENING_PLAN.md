# AURIS360 security hardening plan

## Current position — 14 August 2026

- `auris360.app` serves HTTPS with Vercel HSTS.
- Baseline CSP, clickjacking, MIME-sniffing, referrer and browser-permission protections are deployed.
- The complete CSP remains report-only until inline scripts and observed dependency violations are removed.
- The browser uses the Supabase anonymous/publishable client role; elevated service credentials remain server-side.

## Gate 2 — Supabase exposure audit

Run `supabase_exposure_security_audit.sql` in the Supabase SQL Editor. It is transactionally read-only and reports:

- public tables reachable without RLS;
- RLS-enabled tables with missing policies;
- anonymous mutation rights and direct column grants;
- views that may bypass underlying RLS;
- exposed `SECURITY DEFINER` functions and unsafe search paths;
- broad default privileges affecting future objects;
- storage object RLS state.

Do not apply blanket revokes. Export the result, classify intended public workflows, and implement a targeted rerunnable corrective migration. Re-run the audit and Supabase Security Advisor after remediation.

## Remaining gates

1. Correct confirmed RLS, grants, views and RPC findings.
2. Complete unsafe HTML/XSS review and remove inline application scripts progressively.
3. Move the complete CSP from report-only to enforced.
4. Require MFA for privileged AURIS360, Supabase, Vercel and source-control accounts.
5. Migrate legacy Supabase `anon`/`service_role` keys to publishable/secret keys and rotate elevated credentials safely.
6. Protect preview deployments and verify production/preview environment-variable separation.
