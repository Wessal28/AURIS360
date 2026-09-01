# Modular Foundation Phase 14 — Unified Application Shell and Command Centre

Phase 14 adds one governed navigation surface across the modular platform.

- `AurisCommandCentre` searches the canonical registry instead of maintaining another application catalogue.
- Ctrl/Cmd+K and `/` open an accessible command palette; the top bar exposes the same action without a hidden shortcut dependency.
- Favourites and recent applications are stored by company and user, with bounded metadata and no record content.
- Every navigation request rechecks role/module access, dependency readiness and company context before calling the existing router.
- Record-aware requests reuse the established deep-link normalisation and exact-record restoration path.
- Missing dependencies, unavailable services, empty search results and cross-company requests produce controlled states instead of blank modules.
- Desktop and phone layouts share the same keyboard and touch-safe command result model.

The existing sidebar, Apps launcher, `showPage`, module runtime, company access and release policy remain authoritative. This phase does not merge, deploy, enable applications or migrate production data automatically.
