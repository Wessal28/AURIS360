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
