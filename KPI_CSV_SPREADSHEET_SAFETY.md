# KPI CSV spreadsheet-text protection — preview only

## Scope

Based on tested PR #102. Only the KPI scorecard CSV serializer and its Reports help
text change. No database, dependency, permission, approval, scoring, reporting
cut-off, stored record or configuration changes. Other modules' exporters are not
covered by this phase.

The existing exporter quoted cells but left formula-like text active, including
ordinary exact-target labels such as `=100 count`. Export now prefixes risky text
with a tab inside the quoted field. Quotes are still doubled and embedded line
breaks stay in the same CSV field. Detection covers ASCII and full-width formula
prefixes, leading whitespace and leading control characters.

Only Current Actual and Variance columns can bypass this protection for a strict,
finite decimal/scientific numeric representation. Numeric-looking names remain
text. Signed unit-bearing variances and exact-target labels receive protection.
Measured zeroes, negative actuals, twelve columns, filename, full-register scope,
compiled-period selection and Blob cleanup remain unchanged. No saved strings
are rewritten and repeat exports do not accumulate prefixes.

## Spreadsheet limitations

This is a spreadsheet-oriented CSV mitigation, not a universally safe interchange
format. A leading tab is part of exported data and can affect downstream imports.
Different spreadsheet applications, locale settings and save/reopen workflows
can interpret text differently. Do not strip protection and then open untrusted
values as formulas. This phase does not certify Excel/LibreOffice round trips.
Explicitly typed text cells in a future XLSX export are a separate possible phase.

Reference: [OWASP CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection),
consulted 9 September 2026. Its Excel-resistant tab-prefix guidance and warning
that no single strategy covers all spreadsheet consumers informed this change.
The older private integration-engine CSV helper was not reused because it uses
apostrophes and flattens line breaks; changing it would broaden this KPI-only fix.

## Verification

- New real-script suite: initial 29-case baseline had 25 failures and 4 passes.
- Targeted safety/reporting suite: 48 passed after implementation.
- Harmless sample strings only; no external formula targets or formula execution.
- Loopback `/csv-safety` fixture uses the real application Export CSV route and
  captures its generated Blob into visible text; no tenant API or file download.
- Final local suite: **1,170 tests passed**; **737 readiness checks passed**, no
  failures/skips. Evidence: `release-evidence/csv-safety-baseline.txt`,
  `csv-safety-targeted.txt`, `csv-safety-full-tests.txt`,
  `csv-safety-readiness.json` and `csv-safety-readiness.txt`.
- Browser verification at 390x844 and 768x1024 used native Enter/Space on Export
  CSV, confirming protected objective/code/KPI/indicator/owner/exact-target/
  unit-bearing-variance text and unchanged numeric result cells. Returning to the
  scorecard confirmed original labels, and the fixture confirmed unchanged
  monthly data. Buttons remained 44px; no document overflow or console warnings/
  errors. The task tab was closed, viewport reset and verified helper stopped.
- This is not physical Android, screen-reader, authenticated-role or spreadsheet
  application certification. Hosted outcomes are recorded on the PR/progress log.
- JavaScript key: `20260909-csv-safety-1`; CSS/config keys unchanged. 180 offline
  routes and 22 migrations unchanged.

## Release boundary

Open stacked preview only. No merge, auto-merge, production promotion or SQL.
PR #95 remains the verified production checkpoint; the existing #96 approval
hold and backup/recovery, authenticated-role and physical Android gates remain.
