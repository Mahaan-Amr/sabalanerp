# Server response performance repair

Approved scope on 2026-10-11; review base `c0c5c83f` (main, including ferpheri).

Production profiling located repeated saved technical snapshot decoding in duty
summary reads. A read-only sixteen-row benchmark measured 9629 ms uncached versus
433 ms with the existing operation-scoped resolver. This is a resolver measurement,
not a promise of equivalent acceleration for every API.

## Required behavior

- Reuse source projections only inside one list/summary read operation. Keep all
  existing per-actor authorization, assignments, shared eligibility, expired-work
  rules, history redaction, receipts, due-date and attention counting semantics.
- Reuse protected technical history within one operation and database identity.
  Select the referenced revision before expensive decoding, while retaining full
  envelope, graph, identity, view and submitted-journal integrity validation.
  Preserve candidate order, legacy evidence and rejection of foreign ownership.
- No process-wide source, evidence, permission or settled-count cache. A new
  operation on the same long-lived Prisma client must reread current evidence.
- Coalesce simultaneous frontend count requests by authentication session and
  workspace. A duty mutation during a flight must trigger a fresh read before
  publishing. Ignore obsolete/unmounted hook responses. Keep the last successful
  count on a transient failure within the same session only.
- No business-data rewrite, schema change, integrity shortcut or timeout increase.

## Accepted test seams and release gates

Exercise the actual duty summary and saved technical resolver, concurrent count
requests, and readiness while representative technical evidence is being read.
Use the existing `sabalanerp-local` services for transaction-rolled-back integration
fixtures. Validate types, backend architecture, relevant broad tests and frontend
design-system acceptance. Run independent standards and spec reviews.

Production deployment is authorized after verification and must use the canonical
deployment runner, verified local and remote checkpoint, immutable release images,
maintenance boundary and complete release health gates required by ADR-0039.
Verify live API responsiveness, release identity and container health afterward.
