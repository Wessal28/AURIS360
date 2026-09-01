# Modular Foundation Phase 15 — Reusable Application View Engine

Phase 15 introduces a shared, read-only presentation engine for modular records.

- Applications may declare list, card, board, calendar and activity views from reviewed field metadata.
- Sorting, grouping and named personal views are stored by company, user and application without storing record content.
- The engine removes records outside the selected company before sorting, grouping, rendering or dispatching actions.
- Empty datasets, invalid view definitions and unavailable storage remain controlled states.
- My Work is the reference adoption. Its existing filters, exact source reopening, comments, evidence and delegation callbacks remain authoritative.
- Responsive board and table containers preserve touch scrolling without widening the application shell.

This phase does not introduce generic record mutation, bypass module-specific validation, change RLS, enable applications, merge, or deploy automatically.
