# AURIS360 security hardening plan

## Current position - 14 August 2026

- `auris360.app` serves HTTPS with Vercel HSTS.
- Baseline CSP, clickjacking, MIME-sniffing, referrer and browser-permission protections are deployed.
- The complete CSP remains report-only until inline scripts and observed dependency violations are removed.
- The browser uses the Supabase anonymous/publishable client role; elevated service credentials remain server-side.
- Database-provided links and media now pass through a shared protocol allowlist before entering `href` or `src` attributes.
- Stored SOP HTML is sanitized before print rendering; active elements, event handlers and unsafe URLs are removed.

## Gate 2 - Supabase exposure audit

Run `supabase_exposure_security_audit.sql` in the Supabase SQL Editor. It is transactionally read-only and reports:

- public tables reachable without RLS;
- RLS-enabled tables with missing policies;
- anonymous mutation rights and direct column grants;
- views that may bypass underlying RLS;
- exposed `SECURITY DEFINER` functions and unsafe search paths;
- broad default privileges affecting future objects;
- storage object RLS state.

Do not apply blanket revokes. Export the result, classify intended public workflows, and implement a targeted rerunnable corrective migration. Re-run the audit and Supabase Security Advisor after remediation.

Live audit and targeted production remediation completed on 14 August 2026. The classified evidence and post-change results are recorded in `SUPABASE_EXPOSURE_AUDIT_REPORT_2026-08-14.md`; the rerunnable migration is `supabase_exposure_security_remediation.sql`. Live verification confirmed zero anonymous mutation tables, zero anonymous sequence grants and zero anonymously/PUBLIC-callable privileged functions while retaining required authenticated and service-role workflows.

## Gate 3 - client content and URL hardening

Completed safeguards:

- reject `javascript:`, `vbscript:`, HTML data URLs, credential-bearing URLs and insecure external HTTP links;
- permit HTTPS, same-origin relative URLs, local development HTTP, blob media and narrowly scoped raster/video data URLs;
- validate document previews, e-learning media, certificate links and company logos;
- isolate database-driven new-window links with `noopener noreferrer`;
- sanitize stored SOP print HTML before it is written into a new window.

This is a targeted high-risk sink remediation. The remaining inline-script migration is tracked separately because it is required before the full CSP can be enforced.

## Remaining gates

1. Review the remaining non-privileged RPC and intentional public/RLS-controlled SELECT grants during each database release.
2. Remove inline application scripts progressively and continue reviewing module-specific rich-content renderers.
3. Move the complete CSP from report-only to enforced after inline migration.
4. Require MFA for privileged AURIS360, Supabase, Vercel and source-control accounts.
5. Migrate legacy Supabase `anon`/`service_role` keys to publishable/secret keys and rotate elevated credentials safely.
6. Protect preview deployments and verify production/preview environment-variable separation.
