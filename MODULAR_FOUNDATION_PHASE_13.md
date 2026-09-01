# Modular Foundation Phase 13 — Application Lifecycle and Enterprise Operations

Phase 13 makes the modular platform version-aware and operationally governable.

- Module manifests publish semantic versions, platform/dependency ranges and reviewed migrations.
- `AurisApplicationLifecycle` blocks incompatible upgrades, reports migration readiness, aggregates module/workflow/approval health and redacts client errors.
- Supabase stores tenant-scoped installed versions, pilot activation, migration status, append-only upgrade evidence and bounded health events under RLS.
- Atomic, idempotent RPCs begin upgrades, record success/failure and restore the previous usable version.
- Applications administration displays version compatibility, while Settings exposes selected-company lifecycle evidence.
- Runtime configuration exposes the deployed build, platform and registry versions.
- Release readiness includes performance, accessibility, migration, RLS, tenant and recovery contracts.

No automatic merge, deployment, database migration or production rollback is performed by this phase.
