# Modular Foundation Phase 20 — Governed Integrations and Data Exchange

Phase 20 replaces the legacy API-key guidance with a tenant-scoped Integration Centre over reviewed platform contracts.

- Outbound webhooks support four explicit event schemas: actions, incidents, permits and documents.
- Company administrators may draft and request review; only a SEPHS platform administrator may approve the exact destination host and credential reference.
- Secret values remain in the server environment and are never persisted in browser state or tenant-readable database rows.
- The worker requires public HTTPS, rejects credentials, custom ports, redirects and private DNS results, signs each bounded payload with HMAC-SHA256 and uses short timeouts.
- Delivery jobs use service-role-only claiming, leases, idempotent event keys, bounded exponential retries and controlled blocked or failed states.
- Every payload retains an exact company-bound source relationship, and delivery outcomes create audit evidence without exposing payloads or credentials in the UI.
- CSV export is company-filtered, field-allowlisted, capped and protected from spreadsheet-formula injection.
- Import is intentionally dry-run only in this phase: it validates reviewed fields and records evidence but cannot create or change source records.

This phase does not permit arbitrary URLs, public service credentials, generic SQL, redirects, unreviewed event schemas, cross-company exchange, automatic merge or deployment.
