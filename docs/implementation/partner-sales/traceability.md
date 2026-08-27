# Partner foundation traceability

Package 1.0.0 / schema 1. Latest final resolutions, not early proposals, define the baseline.

| Approved source | Evidence |
| --- | --- |
| [#301: طراحی مدل داده و چرخه اتمیک پرونده فروش همکار](https://github.com/Mahaan-Amr/sabalanerp/issues/301) | [Final decision](https://github.com/Mahaan-Amr/sabalanerp/issues/301#issuecomment-5422807930) |
| [#302: طراحی شواهد و چرخه استعلام قیمت Partner](https://github.com/Mahaan-Amr/sabalanerp/issues/302) | [Final decision](https://github.com/Mahaan-Amr/sabalanerp/issues/302#issuecomment-5422769607) |
| [#303: طراحی حسابداری و دو برنامه پرداخت پرونده Partner](https://github.com/Mahaan-Amr/sabalanerp/issues/303) | [Final decision](https://github.com/Mahaan-Amr/sabalanerp/issues/303#issuecomment-5423101100) |
| [#304: طراحی خروجی مشتری و محرمانگی دو سند Partner](https://github.com/Mahaan-Amr/sabalanerp/issues/304) | [Final decision](https://github.com/Mahaan-Amr/sabalanerp/issues/304#issuecomment-5423119790) |
| [#307: طراحی اصلاح، لغو و rollout پرونده Partner](https://github.com/Mahaan-Amr/sabalanerp/issues/307) | [Final decision](https://github.com/Mahaan-Amr/sabalanerp/issues/307#issuecomment-5425298038) |
| [#308: تثبیت مرزهای پیاده‌سازی و معیارهای پذیرش Partner](https://github.com/Mahaan-Amr/sabalanerp/issues/308) | [Final decision](https://github.com/Mahaan-Amr/sabalanerp/issues/308#issuecomment-5434917540) |
| [#309: طراحی مجوزها و مالکیت داده فروشنده همکار](https://github.com/Mahaan-Amr/sabalanerp/issues/309) | [Final decision](https://github.com/Mahaan-Amr/sabalanerp/issues/309#issuecomment-5422812831) |
| [#310: ثبت ADR معماری دوسندی و چرخه اتمیک Partner Sale Case](https://github.com/Mahaan-Amr/sabalanerp/issues/310) | [Final decision](https://github.com/Mahaan-Amr/sabalanerp/issues/310#issuecomment-5422882257) |
| [#312: رفع تعارض قواعد ADMIN و اصلاح قرارداد میان Partner و مجوزهای سراسری](https://github.com/Mahaan-Amr/sabalanerp/issues/312) | [Final decision](https://github.com/Mahaan-Amr/sabalanerp/issues/312#issuecomment-5435527796) |

## Requirement to delivery

| Requirement | Contract / test | Runtime acceptance owner |
| --- | --- | --- |
| Exact pair, Case graph/revision, immutable attribution | `case.ts`, `graph-adapter.ts`; `case-contract.test.ts`, `graph-adapter.test.ts` | #315/#320 |
| Immutable reusable 48h approval, exact identity, independent batch results | `inquiry.ts`, `commands.ts`; `inquiry.test.ts`, `backend-consumer.test.ts` | #318 |
| Four ADMIN/correction exceptions, hidden/missing parity | `authorization.ts`, `errors.ts`; `authorization.test.ts` | #319/#328/#329 |
| Purpose-specific output, private snapshot, no nested leakage | `projections.ts`; `customer-output.test.ts`, `purpose-views.test.ts`, `snapshot.test.ts`, `frontend-consumer.test.ts` | #319/#325 |
| Separate payment truths, commitment versus official receivable, dated adjustments | `events.ts`; `events.test.ts` | #321/#322/#324/#328/#329 |
| Versioned command, expected state/revision/hash, idempotency | `commands.ts`, `integrity.ts`; `command.test.ts` | #318/#320/#321 |
| Working calendar/test clock, sandbox gateway, readable fixture adapters | `ports.ts`, `/testing`; `adapters.test.ts` and compiled consumer tests | #314 and each adapter lane |
| Ownership, schema sequence, all child consumers | `ownership.md`, `migration-sequence.md`; Epic/child version comments | #313 then #334 |

## Selective approved baseline publication

Before implementation, local `CONTEXT.md` had exactly a 264-line Partner glossary addition and `docs/adr/0046-own-partner-sale-pair-in-one-atomic-case.md` was untracked. These were inspected against the final #301–#310 and #312 decisions, including the explicit ADMIN-precedence section; only that approved baseline is included. Existing upstream glossary changes are preserved. Deleted screenshots, generated frontend tsbuildinfo, tmp artifacts and concurrent #314 work are excluded.

Upstream also contains `docs/adr/0046-use-workspace-scoped-shared-duty-decisions.md`. The numeric prefix collides, so all Partner references must use the **full filename/title and issue #310**; this delivery does not renumber an already-approved linked ADR or overwrite the unrelated ADR. #312 explicitly resolves Partner exceptions to the global rule documented in ADR-0044; the ordinary Sales correction workflow remains unchanged.

No tests here prove transaction atomicity or live permission enforcement: they prove the shared interface and consumer contracts. Real-schema failpoints, concurrency, full Product families/remainder replay, live outputs, permissions and release acceptance remain mandatory in the named dependent tickets.

