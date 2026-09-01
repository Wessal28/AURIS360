# AURIS 360 Modular Architecture

## Foundation 1

`auris-module-registry.js` is the canonical application catalogue. A module manifest declares its route key, display names, category, icon, colour, loader, dependencies, and whether it is configurable per company or belongs to the platform.

The registry now supplies:

- the desktop Apps launcher;
- the mobile module directory;
- company module-access catalogues;
- module colours and labels;
- route loader resolution; and
- dependency metadata for future installation and workflow checks.

Do not add another standalone module catalogue. Add or change the manifest in the registry, then use `AurisModuleRegistry.get()`, `list()`, `keys()`, or `dependenciesOf()`.

## Compatibility boundary

Existing page elements, route keys, company `module_access` values, role rules, and module loader functions remain authoritative. The registry adapts those existing contracts rather than renaming stored data or rewriting business modules.

`LAUNCHED_MODULES` remains the controlled production-release policy. A registered application is discoverable metadata; it is not automatically released to clients.

## Foundation 2

`auris-module-runtime.js` is the shared application lifecycle boundary. Routing now activates registered modules through four cancellable lifecycle phases: `beforeLeave`, `leave`, `beforeEnter`, and `enter`. Modules can register hooks without changing the router, and the runtime emits matching `auris:module-*` DOM events for shell-level integrations and diagnostics.

The registry also supplies dependency and workflow services:

- `dependencyClosure()` returns a deterministic, dependency-complete module selection;
- `missingDependencies()` and `dependantsOf()` support activation and administration diagnostics;
- company module access automatically includes required dependencies and removes dependants when a requirement is disabled;
- every manifest declares a shared layout contract; and
- `workflowOf()`, `nextStates()`, and `canTransition()` expose declarative workflow metadata.

Incident Management is the reference workflow manifest. Its current production record handlers remain authoritative; the declarative map documents the target states and allowed transitions without silently rewriting stored records. Later slices will move mutation enforcement behind the shared workflow service.

## Foundation 3

`auris-platform-services.js` is the stable service boundary for independently loaded applications. It exposes `auth`, `api`, `rbac`, `audit`, and `notifications` facades without giving modules direct access to mutable core globals. The existing production implementations are registered as compatibility adapters by `auris-core.js`, allowing modules to migrate incrementally without changing authentication, tenant isolation, role rules, audit evidence, or notification delivery.

Every module lifecycle context now receives the same service container as `context.services`. New module code should use that container (or `AurisPlatformServices`) instead of calling core globals such as `api`, `prof`, `tok`, `canAccessPage`, `auditLogEvent`, or `queueNotification` directly.

The service container publishes readiness through `health()`, `ready()`, `subscribe()`, and the `auris:service-ready` DOM event. This makes missing platform capabilities diagnosable before a module starts.

## Foundation 4

`auris-module-layout.js` renders the shared application workspace declared by a module manifest. It supplies a consistent module identity header, Apps breadcrumb, dependency context, grouped view navigation, primary action, refresh action, keyboard navigation, active-view state, and responsive mobile treatment without owning module data or workflow decisions.

Incident Management is the reference implementation. Its dashboard, personal work, reporting, registers, triage, investigations, actions, regulatory work, lessons, reports, and configuration now use the same layout contract while retaining the existing record handlers and tenant controls.

## Next slices

1. Enforce Incident Management transitions through a tenant-configurable workflow service.
2. Connect the reusable Approval Centre rules to the workflow service.
3. Convert Risk Assessment, Permit to Work, Document Control, MOC, and Master Action Plan to the shared engine.

Every slice must preserve company isolation, role enforcement, offline field drafts, deep links, audit evidence, and release-readiness contracts.

## Foundation 5

`auris-workflow-service.js` is the tenant-aware enforcement boundary for module state changes. It resolves the effective company policy, validates tenant overrides against the module's declared state model, blocks undeclared transitions, identifies approval-gated transitions, enforces module access, and records successful transitions through the shared audit service.

Incident Management is the first enforced module. Existing production incident states remain declared as compatibility states so the service centralises control without silently invalidating stored records. Tenant policy changes can narrow or route allowed transitions but cannot invent states outside the reviewed module contract.

## Foundation 6

`auris-approval-centre.js` connects approval-gated workflow transitions to one reusable decision service. It registers the existing module adapters, retains an exact source page, table, record id, reference and company on every request, rejects cross-company queue items, records governed decisions, and supplies approved evidence back to the workflow service before a status mutation is persisted.

The existing Approval Centre remains the production queue and exact-record navigation interface. Its specialised openers are preserved; the shared service adds tenant and source assertions around them rather than replacing their proven module-specific behavior.

## Foundation 7

Risk Assessment, Permit to Work, Document Control, Management of Change and Master Action Plan now declare their layouts, lifecycle ownership, workflow states, allowed transitions and approval gates in the canonical registry. `auris-priority-module-adapters.js` mounts the shared module shell while routing view selections and commands back to each application's established loaders and record handlers.

The workflow service now reads approval gates directly from reviewed manifests. Existing record vocabularies and dedicated approve, reject, verification and closure handlers remain compatible, while new independently loaded views receive the same registry, service, navigation and tenant enforcement contracts as Incident Management.

## Foundation 8

`auris-applications-admin.js` and `auris-applications-admin.css` provide an Odoo-style Applications administration layer for each company. Applications are shown as Installed, Available or Blocked with dependency, lifecycle, release and shared-service diagnostics. Install plans automatically include dependencies; uninstall plans include recursive dependants so administrators see and apply one controlled rollback impact instead of leaving broken navigation.

The administration layer persists only the existing `companies.module_access` contract through the established tenant-admin path. `LAUNCHED_MODULES` remains the production release boundary, Dashboard remains mandatory, role enforcement still applies after installation, and unreleased modules cannot be enabled from the interface.

## Foundation 9

`auris-governance-persistence.js` supplies the production persistence adapters for the shared workflow and Approval Centre services. Published company workflow policies are hydrated after authentication and whenever a SEPHS administrator changes company context. Once persistence is configured, governed mutations fail closed until that company's policy and pending approval queue have loaded successfully.

`workflow_policy_versions` stores immutable, versioned drafts and published policies with optimistic revision checks, one active policy per company and module, append-only lifecycle evidence, and rollback by creating a new published version from reviewed history. Atomic Supabase RPCs serialise draft numbering, publication, rollback, approval requests and decisions so retries cannot create duplicate pending approvals or decide a request twice.

The existing `approval_requests` and `approval_decisions` tables remain authoritative. Foundation 9 extends them with exact text record identity, source page and reference, transition evidence, idempotency keys and revision numbers. Company RLS remains the first tenant boundary; security-definer functions also make explicit company and management-role checks before performing governed writes.

## Foundation 10

`auris-workflow-studio.js` and `auris-workflow-studio.css` provide a tenant-aware Visual Workflow Studio inside Settings. Company administrators and HSE managers can start from reviewed Incident, Permit, Risk, Document and MOC templates; configure transition roles, required fields, ordered approval stages, SLA targets and escalation roles; simulate access; review active-record impact; save drafts; publish; clone; export/import reviewed JSON; and restore historical policy versions.

The Studio stores declarative JSON only. The shared workflow service rejects executable expressions and undeclared states, validates graph reachability and terminal states, and enforces roles, required fields and approval gates during transitions rather than relying on hidden UI controls. Publication and rollback continue through the Phase 9 atomic persistence functions, retaining tenant RLS, optimistic locking and append-only lifecycle evidence.
