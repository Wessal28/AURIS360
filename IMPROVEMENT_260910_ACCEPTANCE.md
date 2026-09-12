# Improvement 260910 acceptance

Source: the seven-page AURIS360 Improvement 260910 document, reviewed from its rendered pages on 2026-09-13.

## Production phase one — complete

PR 118 was merged and promoted by the owner. The approved seven-column migration was applied to production and its columns verified: planned KPI months, chemical SDS file URL/path/MIME, and SDS-version file URL/path/MIME. Existing storage permissions were retained. Scheduled KPI reporting, retained PDF preview, completed minutes and command search were delivered in phase one.

## Remaining document implementation — complete in PR 119

| Requirement | Implementation and verification |
| --- | --- |
| Register columns | Per-company/user visibility controls in legacy tabular registers; existing view-engine column controls retained. Browser verified hiding a column. |
| Duplicate action/risk tabs | One shared risk navigation bar, synchronized register selection; duplicate legacy MAP tabs hidden. Required risk header retained to prevent module-entry failure. |
| Master Action Plan records and links | Edited talks transfer new source-linked actions. Exact source IDs work without a reference label. Retry, failure disclosure and duplicate avoidance verified by behavior tests. Existing cross-module source adapters retained. |
| Own RA templates | Save a current assessment as a company template; import/export validated JSON; create a fresh draft from the saved definition. Company template saved and reloaded through staging UI. Existing PDF/Word/Excel template uploads retained. |
| Own risk matrices | Configurable 5x5 cells and criteria, JSON import/export, validated monotonic levels. Each assessment retains its matrix snapshot, including printed criteria. Staging UI saved a custom-matrix draft; authenticated round-trip verified persistence. |
| MSB certificate preview | Validated stored base64 PDFs converted to blobs for the existing PDF canvas viewer; malformed/active data URLs rejected. Behavior tests pass. |
| Slow loading | Concurrent risk assurance loads share their two requests. Stale company responses cannot update the current view. Behavior test verifies both. |
| Pre-start team | Employee multi-select with historical-name preservation. Selection, save and reset covered by inspection behavior tests. |
| Compact pre-start checklist | Smaller type and title/answer row; independent answer/comment persistence retained. Browser fixture visually checked. |
| Pre-start row viewing | Register rows open an exact tenant-scoped read-only record. |
| Work-order TBT register visibility | Canonical saved talk is shown in the shared register; legacy presenter/duration fields remain visible. Created TBT-2026-001 from the staging work order and verified it appears in the toolbox register. |
| Work-order TBT/pre-start/site links | Exact record reads with account/company checks; linked records open read-only. Staging TBT link verified, showing saved content and no edit action. |
| TBT attendance photo | Camera/upload controls compress the image; JSON field retains it under existing toolbox RLS. Authenticated staging save/reload passes. Actual retained synthetic JPEG visually verified in the document viewer. |
| App icons | Catalogue cards use the same icon mapping as sidebar items. |

## Release evidence

- Draft implementation PR: https://github.com/Wessal28/AURIS360/pull/119
- Release readiness and migration replay passed on commit 4fbb35f: https://github.com/Wessal28/AURIS360/actions/runs/34717280968
- Authenticated staging acceptance passed on that commit: https://github.com/Wessal28/AURIS360/actions/runs/34717308871
- Later work-order summary and photo-panel handoff refinements have passing focused tests; PR checks verify the final revision.
- Staging uses the existing signed-in preview, mirrored from the completion branch: https://auris-360-git-codex-improvemen-be038d-salomon-wesley-s-projects.vercel.app/

## Production rollout remaining

PR 119 is not merged or promoted. Its additional migration `20260913010000_improvement_document_completion.sql` adds three nullable JSON fields: toolbox attendance_photo, assessment risk_matrix_snapshot, and document template_definition. It has been applied to staging, and all three pass authenticated save/reload checks. Apply it to production before promoting PR 119. It changes no RLS or storage policies and does not rewrite existing records.

Structured matrix import uses the supported 5x5 scoring model. Company PDF/Word/Excel forms remain layout references; structured JSON templates populate the editable assessment fields. A group photo is supporting attendance evidence and does not fabricate individual confirmations.
