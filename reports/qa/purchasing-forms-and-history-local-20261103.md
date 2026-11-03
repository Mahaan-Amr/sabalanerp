# Purchasing form simplification, readable specification summary and saved-inquiry access

## Delivered

- Removed manual draft save/recovery controls from Purchasing start and operational forms. No persisted purchasing records, prior evidence or historical draft storage were deleted. In-flight and uncertain command protections retain their existing behavior.
- Removed the price-scope dropdown and previous-inquiry specification-copy selector. Catalog fields remain authoritative; optional «مشخصات اضافهٔ موردنیاز» selects specific scope when nonblank and general scope otherwise. Backend matching and explicit supplier confirmation of general pricing against specific requirements remain enforced.
- Removed the new-offer validity selector. The form explicitly submits `valid: true`; historical invalid/superseded offers and expiry semantics are preserved. Working-day lead-time defaults remain unchanged.
- Replaced the dense specification sentence with canonical labeled summary fields for code, quantity, dimensions, stone type, finish, sort and extra requirements. Codes retain leading zeros; quantities/prices retain exact decimal grouping.
- Grouped supplier badges; omitted the empty operations column for valid-only offers. Material/transport totals have an explicit basis and separately explain unquoted freight rather than presenting it as zero.
- Renamed the existing Purchasing inquiry register entry to «استعلام‌های ثبت‌شده» and added a dashboard link. The register retains the existing authorized population, search, status filters and loaded-record limits. Viewing a case/item retains the previously verified browser history hierarchy.

## Local acceptance

- Design-system check: no new violations; foundation/adoption suites passed.
- Frontend production build passed; task-generated Next config drift removed.
- Quotation UX suite: 4 passed, covering Persian input grouping, removed fields, catalog families, identifier hiding, direct-entry/history behavior and mobile rendering.
- Real command lifecycle: 2 passed (46.3s). Includes new-offer VALID/working defaults, RFQ → Request → Order → partial acceptance/rejection → actual return → replacement, and independent general pricing reused for a later specific need only with explicit confirmation.
- Existing workspace browser suite passed, covering saved-inquiry navigation links, stat links, contracts, compact centered overlays, accessibility, 390px layout, 200% zoom and sidebar routes.
- Visual screenshots inspected at desktop and mobile; preview capture waits for overlay exit to avoid a fading dialog in the image.
- `git diff --check`: passed.

Evidence: `tmp/qa/purchasing-cleanup-{ux,lifecycle,workspace,preview}` and `/tmp/purchasing-cleanup-*.log`. Only the approved `sabalanerp-local` frontend was rebuilt/refreshed; no backend/schema or production changes, no Git delivery.
