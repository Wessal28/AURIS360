# Improvement 260910 acceptance

Source: seven rendered pages in the 2026-08-31 task, reviewed 2026-09-13.

## Completed phase one (PR 118)
- Planned periodic KPI reporting months, persistent save and input schedule.
- Saved SDS upload, retained document and actual PDF preview.
- Completed meeting occurrence opens stored minutes.
- Top command search opens and accepts input.
- Production schema migration applied and seven columns verified 2026-09-13. Production commit 30631ad; previous live smoke verified 36 assets.

## Remaining implementation and acceptance
- Column visibility in chemical, risk, audit, inspection and all tabular registers, scoped to user/company.
- Master Action Plan missing records/source links; duplicated action tabs.
- Risk duplicate tabs; company-created/imported templates and risk matrices.
- PPE MSB certificate preview for existing uploaded attachments.
- Slow module loading: profile and eliminate redundant blocking loads.
- Pre-start team selection from employees; compact checklist title/answer row.
- Pre-start row opens a full read-only record.
- Toolbox records created from Work Schedule appear in the toolbox register.
- Work-order links open TBT, pre-start and site inspection read-only records.
- Toolbox group attendance photo upload/capture, retained on the record.
- App catalogue icons match sidebar icons.

Implementation branch: codex/improvement-260910-completion, based on merged main.
Do not claim completion until each remaining item has recorded implementation and verification evidence.

## Completion implementation (2026-09-13)
- Shared per-user/company column controls for legacy registers; existing view-engine controls retained.
- Duplicate MAP and risk register tabs hidden when the shared navigation is present. Risk module preserves its required shared header, fixing a module-entry failure.
- Company risk matrix editor and JSON import/export; structured assessment templates created from the current form and imported/exported. Assessments retain their own matrix snapshot; printing uses the saved record matrix.
- Existing base64 PDF attachments are validated and converted to a PDF blob for the existing canvas viewer.
- Pre-start employee multi-select, compact checklist rows, read-only register opening and exact read-only work-order inspection links.
- Legacy work-order toolbox fields display correctly in the shared register. Work-order links use the exact read-only talk workspace.
- Group attendance capture/upload is compressed and saved within the toolbox record's existing RLS boundary.
- Edited toolbox talks now transfer newly added actions to MAP. Failures keep the saved talk open; retry skips already transferred source-linked descriptions.
- App catalogue uses the sidebar icon mapping. Concurrent risk assurance loads are coalesced and stale sessions cannot update the current view.

## Verification in progress
- 42 toolbox checks passed; 22 inspection behavior checks passed; 7 added matrix/PDF/photo checks passed.
- Three added action-transfer recovery checks passed.
- Full local suite: 1,282 passed; stale asset manifest failure resolved and standalone asset check passed (184 routes). Final immutable CI run still required.
- Local browser: columns hide correctly; matrix editor saves a complete synthetic definition; compact checklist visually inspected.
- Completion migration applied to staging only: attendance_photo, risk_matrix_snapshot, template_definition. Success confirmed in staging SQL editor.
- Live staging acceptance and final release review remain outstanding.
