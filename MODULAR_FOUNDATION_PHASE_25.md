# Modular Foundation Phase 25 — Shared Master Data Centre

Phase 25 establishes one company-scoped reference-data contract for sites and locations, departments, organisations, responsible roles, assets, risk classifications, action classifications, and document categories.

- Canonical values move through draft, independent review, active, inactive, archived, and merged states.
- Every change creates an immutable revision snapshot and audit event.
- Effective dates retain historical meaning without silently rewriting source records.
- Explicit dependencies preserve the exact source table, record, field, and reference; active dependencies block unsafe deactivation or archival.
- Duplicate detection is tenant and domain scoped. Controlled merging requires an exact inactive/draft source and active target, transfers dependency links, and retains the source as merged history.
- CSV intake reuses the Phase 23 bounded mapping parser, permits only reviewed master-data fields, and stages an exact mapping fingerprint.
- A different administrator must approve a staged import before its records are inserted atomically.
- Exact deep links reopen the canonical value, and company/role checks remain enforced in both the interface and database.

This phase does not automatically rewrite legacy module data, broaden tenant access, expose direct table mutation, self-approve imports, merge a pull request, or deploy to production.
