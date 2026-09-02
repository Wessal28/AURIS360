# Modular Foundation Phase 22 — Governed Exact-Record Reconciliation

Phase 22 extends governed imports with tenant-scoped updates to existing Action Register records.

- Users export an update template containing the exact action UUID, immutable action reference and expected `updated_at` revision.
- Client validation allowlists editable fields, rejects invalid identities and controlled values, and never mutates records.
- Staging resolves every UUID and reference inside the active company and saves a before-state snapshot without applying changes.
- The Phase 21 separation-of-duties workflow remains mandatory: a different authorized reviewer approves each batch.
- Only the service-role worker executes approved batches, in one database transaction with row locks and a second revision check.
- Missing, stale, renamed or cross-company records fail safely without partial updates.
- Every completed batch retains requester, approver, exact-record, before-state and audit evidence.
- Rollback is limited to 24 hours and restores snapshots only while records remain unchanged and no later delivery, notification, approval or activity evidence exists.
- Create imports remain supported through the same governed executor and their existing safe rollback rules.

This phase does not provide arbitrary upserts, action creation through the update path, self-approval, browser-side record mutation, cross-company reconciliation, silent conflict resolution, rollback over later work, automatic merge or deployment.
