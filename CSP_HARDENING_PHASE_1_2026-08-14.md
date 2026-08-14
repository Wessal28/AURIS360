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

Phase 2A migrated all 1,458 static-page event attributes into 1,261 precompiled handlers in `auris-static-event-handlers.js`. Phase 2B migrated another 470 static-behaviour attributes from generated markup into 386 precompiled handlers in `auris-generated-event-handlers.js`. The remaining 178 attributes inject runtime record values and require explicit data arguments. They remain temporarily permitted through the narrower `script-src-attr 'unsafe-inline'` directive until that migration is complete.

The interface also contains inline style attributes. Style CSP remains report-only with `'unsafe-inline'` until these declarations are moved into reusable classes or a nonce/hash strategy is adopted.

## Security effect

Injected inline `<script>` elements can no longer execute under the enforced policy. Existing action buttons continue to work while event-handler migration proceeds in controlled batches.
