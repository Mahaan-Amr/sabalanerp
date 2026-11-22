# Purchasing offer lead times use working days

Decision: new supplier offers created through the Purchasing form use working days. The day-kind selector is removed; lead inputs explicitly say «روز کاری تا آماده‌شدن» and «روز کاری تا رسیدن». The submitted offer command includes `dayKind: working`, using the existing backend behavior. Fixed dates and the lead-time starting basis retain their meanings. Previously stored offers retain their original day kinds.

The catalog-dimensions field was inspected only: catalog width/thickness/type/finish/quality are read from Product, while free-text dimensions add optional specific requirements to the technical snapshot. No catalog dimensions, quote scope, draft recovery or validity controls were changed in this follow-up.

Local validation:
- Sabalan design-system check, foundation and adoption suites: passed.
- Frontend production build: passed; generated task-specific Next config drift removed.
- Existing `sabalanerp-local` frontend image rebuilt and refreshed; backend and database schema unchanged.
- Quotation UX browser suite: 2 passed (19.2s), including absent day-kind selector and explicit working-day field labels.
- Real local RFQ lifecycle: new offers checked for persisted `dayKind=working` and visible working-day promise; purchase, partial quality acceptance/rejection, actual return, replacement and late accepted return exercised.

Evidence: `tmp/qa/purchasing-working-day-ux`, `tmp/qa/purchasing-working-day-lifecycle`; logs `/tmp/purchase-working-day-*.log`. No production changes or Git delivery.
