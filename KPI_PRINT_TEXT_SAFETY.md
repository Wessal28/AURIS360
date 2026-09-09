# KPI print text safety — preview only

The existing KPI print builders inserted target formatter output, fallback
target/unit text, unknown status labels, raw monthly actual/YTD values and the
selected year directly into HTML. Markup-like values could change the report
document. This phase escapes those six output boundaries with the existing
`kpiPrintEsc` helper. Existing names/company/owner escaping stays unchanged.

No records, formatting rules, target operators, status mappings, approval states,
permissions, grouping, twelve-month columns, YTD selection, report routing or
shared print-window implementation change. No SQL/dependencies or production
promotion. Treat values as plain text, including literal entity-looking strings;
do not interpret entered target/unit/status text as authored HTML.

## Evidence

The real print functions are extracted from the checked-out `auris-core.js` for
the behavioural suite and local browser fixture; they are not rewritten mocks.
The 19-case baseline reproduced 14 failures and 5 preservation passes. Targeted
print/reporting/client-hardening suites pass 41 cases after the fix.

Local browser route `/print-safety` runs through actual KPI/CSP print actions with
synthetic records and the actual print builders. Only `aurisPrint` is replaced
with visible HTML capture, so no operating-system print dialog, popup or real
record/API is used. Inert `b` and closing-cell samples test literal text without
running scripts or requesting external resources. This verifies generated HTML,
not paper/PDF pagination or physical Android/screen-reader acceptance.

Final local suite: **1,189 tests passed**; **756 readiness checks passed**, zero
failures/skips. The first full run hit eleven older core-cache-prefix contracts;
the final unique key retains the established `20260903-29` base prefix and adds
`-kpi-print-text-1`. No contracts were bypassed. Logs:
`release-evidence/print-text-safety-baseline.txt`,
`print-text-safety-targeted.txt`, `print-text-safety-full-tests.txt` (initial),
`print-text-safety-full-tests-final.txt`, `print-text-safety-readiness.json`
and `print-text-safety-readiness.txt`.

Phone 390x844 and tablet 768x1024 checks used native Enter/Space on the real Reports
Print button. Generated target/unit, status, actual and YTD probes stayed literal
text with zero probe elements; the fixture confirmed unchanged source records.
The button stayed 44px, no document overflow or console warnings/errors. Overview
coverage is behavioural-unit coverage; the upgraded scorecard header's Export
Report action is CSV, not a print route. Browser coverage does not certify print
pagination: only the final print window is captured. The temporary tab was
closed, viewport reset and verified loopback helpers stopped.

Hosted outcomes are retained on the PR and in the progress log.

## Remaining report semantics — not changed here

Inspection also found older print behaviours that deserve a separate tested
consistency phase: Reports defaults to the monthly layout when Overview is
hidden; print status uses stored `k.status`, and printed YTD takes the last
available value across all twelve months rather than the published compilation
cut-off. Raw month columns have no N/A/not-due explanation. Do not call this an
alignment of printed reports with the current scorecard or change calendar/
approval semantics silently.

## Release

Stacked preview on PR #103, open/unmerged, no auto-merge. Core cache key:
`20260903-29-kpi-print-text-1`; KPI assets unchanged, 180 offline routes and 22
migrations retained. PR #95 remains production; the #96 promotion hold and
verified backup/recovery, signed-in disposable-role and physical Android gates
still apply.
