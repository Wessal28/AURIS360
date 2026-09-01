# Modular Foundation Phase 19 — Governed Automation, Reminders and Escalations

Phase 19 introduces a tenant-admin Automation Centre over fixed, reviewed platform actions.

- The first supported trigger is a Master Action Plan due date; supported actions are reminder and governed escalation.
- Rules are validated, versioned, company-scoped and activated or paused through optimistic-locking RPCs.
- The scheduler uses service-role-only execution, bounded batches and `FOR UPDATE SKIP LOCKED` claiming.
- Every queued result has an idempotency key, exact source relationship and append-only execution evidence.
- Recipient resolution stays inside the selected company and reuses the existing notification queue and escalation hierarchy.
- Read-only preview removes other-company records before evaluating rules and never sends notifications or mutates sources.
- Controlled failures, missing recipients and paused rules remain visible without silently widening access.

This phase does not permit arbitrary SQL, URLs, scripts, generic record mutation, automatic workflow transitions, merge or deployment.
