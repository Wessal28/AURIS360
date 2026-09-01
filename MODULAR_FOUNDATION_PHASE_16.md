# Modular Foundation Phase 16 — Reusable Record Workspace Engine

Phase 16 standardises the governed record experience after a user opens a result from an AURIS application view.

- The workspace requires an exact module, table, record ID and company scope before it renders.
- Cross-company sources and payloads fail closed before details, activity, evidence, approvals or actions are exposed.
- Reviewed adapters declare safe fields, role-aware edit handoff and optional module-owned actions.
- Workflow state, available transitions and approval evidence are explained through the shared workflow and Approval Centre contracts.
- Comments, evidence, transitions and editing remain callbacks into authoritative module services; the workspace never performs generic record mutation.
- My Work is the reference adoption and retains its existing deep-link fallback, offline restrictions, comment, evidence and delegation behavior.
- Desktop uses an accessible side workspace; mobile uses a bounded bottom sheet without page-level horizontal overflow.

This phase does not change RLS, bypass module validation, merge, deploy or transition records automatically.
