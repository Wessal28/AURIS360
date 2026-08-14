# Content Security Policy hardening — phase 1

Date: 14 August 2026

## Applied change

- Extracted the 2,974,839-character core inline script into `auris-core.js`.
- Extracted the detached-module placement helper into `auris-detached-modules.js`.
- Preserved their original parse and execution positions in `index.html`.
- Removed two generated SOP print-window script blocks and trigger printing from the trusted opener instead.
- Enforced `script-src-elem` for same-origin assets and the approved PDF.js CDN.
- Removed `'unsafe-inline'` from the report-only `script-src` directive.
- Added both external assets to the generated offline application-shell manifest.

## Residual migration

Phase 2A migrated all 1,458 static-page event attributes into 1,261 precompiled handlers in `auris-static-event-handlers.js`. Phase 2B migrated another 470 static-behaviour attributes from generated markup into 386 precompiled handlers in `auris-generated-event-handlers.js`. Phase 2C migrated all 178 remaining core handlers into 150 runtime-argument handlers plus a strict allowlist for ten complex actions. `index.html` and `auris-core.js` now contain no inline event attributes and the shipped registries do not use `eval` or `Function`.

Phase 2D migrated the first ten separately loaded module bundles: 83 attributes were replaced by 65 precompiled handlers plus a strict command parser for the two reusable module button factories. Those ten bundles now contain no inline event attributes, reducing the active loaded-module backlog from 419 to 336. The remaining bundles stay temporarily permitted through the narrower `script-src-attr 'unsafe-inline'` directive and will be migrated in controlled batches before that directive is removed.

Phase 2E migrated another 71 attributes from Document Control, Risk Assessment and Chemical Control into 50 precompiled handlers plus the existing strict command parser. A strengthened scan also found and removed two escaped corrective-action row handlers from the core script. The core remains free of executable inline event attributes and the loaded-module backlog is now 265.

Phase 2F migrated all 99 attributes from Objectives & KPIs, SWMS, Contractor Management and Tools & Equipment into 76 precompiled handlers. No dynamic-command fallback was required. The loaded-module backlog is now 166 across Training & Competency, BBS Observations and Safety Engagement.

Phase 2G migrated all 75 attributes from Training & Competency and BBS Observations into 53 precompiled handlers plus the strict namespace dispatcher for two reusable BBS render helpers. Only the 91 Safety Engagement handlers remain before `script-src-attr 'unsafe-inline'` can be removed.

The interface also contains inline style attributes. Style CSP remains report-only with `'unsafe-inline'` until these declarations are moved into reusable classes or a nonce/hash strategy is adopted.

## Security effect

Injected inline `<script>` elements can no longer execute under the enforced policy. Existing action buttons continue to work while event-handler migration proceeds in controlled batches.
