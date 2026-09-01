# Modular Foundation Phase 12 — Complete Modular Extraction

Phase 12 places the remaining business applications behind one independently loadable runtime boundary. It covers assurance, people, specialist controls, emergency, governance, assets and occupational-health groups while keeping existing page IDs, URLs, deep links, database tables and loader functions compatible.

## Extraction contract

- manifests declare the module group, required platform-service facades and optional lazy assets;
- adapters receive authentication, API, role, audit and notification capabilities only through `AurisPlatformServices`;
- large upgrade scripts for Training, Contractor, Chemical, Tools and Legal are removed from initial execution and loaded on first use;
- asset names are strictly allowlisted to local JavaScript paths and are cached by the offline shell;
- the runtime re-resolves the loader after lazy assets install their compatibility override;
- load failures restore the previous runtime state and render a module-local retry panel;
- released-versus-registered module controls, role checks and dependency checks remain unchanged.

This is a compatibility extraction: existing implementation functions remain valid behind the adapter boundary so records and saved links do not change. Future module packages can replace an adapter group without changing the shell contract.

## Covered modules

Audits & Inspections, Training & Competency, Contractor Management, People, Chemical Control, Tools & Equipment, ATEX, Emergency Management, Fire Certificates, Environmental/ESG, Legal Compliance, Fleet Management and Occupational Health.

## Validation

Run the complete automated suite, `npm run check:sw-manifest`, `npm run release:readiness`, and browser checks for successful lazy load, isolated failure recovery, desktop behavior and mobile recovery layout.
