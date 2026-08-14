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

The legacy interface still contains 2,114 inline event-handler attributes. They remain temporarily permitted through the narrower `script-src-attr 'unsafe-inline'` directive. Migrating these handlers must be performed module by module with interaction regression tests; a single broad replacement would create disproportionate risk across the application.

The interface also contains inline style attributes. Style CSP remains report-only with `'unsafe-inline'` until these declarations are moved into reusable classes or a nonce/hash strategy is adopted.

## Security effect

Injected inline `<script>` elements can no longer execute under the enforced policy. Existing action buttons continue to work while event-handler migration proceeds in controlled batches.
