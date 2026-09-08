# KPI recovery action form reliability

The existing **Create Action** form in Objectives & KPIs still creates an open corrective action in Master Action Plan, with the existing KPI source fields and verification requirement. This change does not introduce a second workflow, change approval permissions, or require SQL.

## Improvements

- Clicking the background no longer closes the form. Opening another recovery action cannot silently replace an existing draft. Explicit Close remains available while idle.
- Required-field and service errors appear in one focused alert inside the form, with entered values retained. Text is inserted as text, not executable HTML.
- Inputs and close/save controls are disabled during a save. Repeated dispatch cannot start another pending request.
- The form captures the company, account and KPI when opened and checks them before reference allocation and again before creating the record. A changed context or removed KPI blocks the write. Field values are captured before asynchronous work.
- Once a returned record id confirms persistence, a failed optional relationship or display update cannot re-enable action creation. Partial success is explicitly explained; a late response does not refresh the new company's screen or create another relationship there.
- Field fonts are consistent, inputs/buttons have at least 44px targets, form columns can shrink without overflow, and narrow layouts retain the single-column rule.

## Verification and limits

- Sixteen behavior tests exercise the real module functions; fifteen regressions failed against the baseline and the established action payload/link preservation test already passed. A deferred test was tightened to wait for POST entry before simulating a company switch.
- Full automated suite: **791 passed**. Release readiness: **358 passed**, with **179 offline routes** and **22 migrations** unchanged.
- The synthetic browser fixture uses the actual module and event dispatcher, without an external API. At 1280x720, validation and connection-error alerts were visible/focused inside the retained form, optional-link failure retained a disabled saved action, and controls remained within the panel. Physical Android and signed-in tenant acceptance remain pending.
- Draft retention applies while this form stays open, not after explicit Close, navigation or browser restart. This is not a new persistent draft store.
- Client-side duplicate protection is not server-side idempotency. If a network error leaves persistence uncertain, users are told to check Master Action Plan before retrying; the application does not automatically resubmit.
- Reference allocation, server authorization, source-table naming and existing business field semantics are unchanged. No production business records were created by these tests.
