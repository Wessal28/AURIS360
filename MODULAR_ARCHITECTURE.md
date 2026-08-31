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

## Next slices

1. Extract the application shell, authentication, API, RBAC, audit, and notification services from `auris-core.js`.
2. Define a shared module layout contract for dashboard, register, kanban, form, reports, activities, and configuration.
3. Migrate Incident Management as the reference application.
4. Introduce the configurable workflow and approval engine.
5. Convert Risk Assessment, Permit to Work, Document Control, MOC, and Master Action Plan to the shared engine.

Every slice must preserve company isolation, role enforcement, offline field drafts, deep links, audit evidence, and release-readiness contracts.
