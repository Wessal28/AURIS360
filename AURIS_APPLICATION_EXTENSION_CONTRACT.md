# AURIS360 Application Extension Contract

Future applications must integrate through the shared platform boundary rather than mutable core globals.

## Required manifest

Every application declares a stable key, semantic `version`, company scope, loader, dependencies, platform range and reviewed migration identifiers. Dependencies use semantic-version ranges. The registry rejects unknown dependencies and freezes the published manifest.

## Runtime and services

Applications activate through `AurisModuleRuntime`, implement cancellable lifecycle hooks and obtain authentication, API, RBAC, audit and notification capabilities through `AurisPlatformServices`. Applications must preserve exact record deep links, company isolation and controlled empty/error states.

## Data and upgrades

- Database changes are ordered Supabase migrations with a recorded checksum.
- An upgrade starts only after platform, dependency and migration compatibility succeeds.
- Tenant upgrades start in `pilot`; broader activation follows health evidence.
- Failed upgrades pause the module and retain the previous usable version.
- Rollback uses the governed RPC and produces append-only evidence.
- Schema changes must remain backward-compatible for the previous release during the rollback window.

## Security and observability

New tables require RLS and explicit tenant policies. Governed writes use validated RPCs, idempotency keys and exact authority checks. Client errors are reduced to bounded codes and safe context; credentials, personal data and record payloads are forbidden. Modules contribute runtime, workflow, approval-backlog, accessibility and performance signals to the shared operations view.

## Release evidence

Each application change must pass complete automated tests, migration validation, release readiness, performance/accessibility budgets, browser checks and staging acceptance before production promotion. Production smoke must prove the build, registry and application-lifecycle assets from the canonical domain.
