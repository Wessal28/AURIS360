# Modular Foundation Phase 21 — Governed Import Execution

Phase 21 advances Phase 20's validation-only CSV import into a controlled, evidence-backed execution workflow.

- Action imports remain company-scoped, field-allowlisted, capped at 500 rows and limited to 1 MiB.
- Every row must pass reviewed reference, status, priority and date validation before a batch can be staged.
- Staging never mutates source records and stores only normalized reviewed fields plus fingerprints.
- A different authorized administrator must approve or reject the batch; requesters cannot approve their own imports.
- Only the service-role worker can claim and atomically apply approved batches.
- Reference conflicts or execution errors leave no partially imported actions and retain controlled failure evidence.
- Imported actions retain their exact batch relationship, requester and approver evidence.
- Safe rollback is limited to 24 hours and is blocked when a record changed or produced outbound delivery evidence.
- Tenant-readable tables remain RLS protected and all mutation paths are security-definer RPCs with explicit grants.

This phase does not permit arbitrary tables, fields, update/upsert imports, browser-side direct writes, self-approval, cross-company execution, destructive rollback of changed records, automatic merge or deployment.
