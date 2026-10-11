# Partner Seller evidence and interview — 2026-10-11

Status: the product owner confirmed all ten decisions and authorized implementation. Local implementation and targeted regression verification are complete, with the unresolved checks below explicitly retained. Production inspection used bounded SSH logs, metadata, explicit read-only SQL transactions, and pure decoding of retained evidence. No production deployment, database mutation, service restart, migration or authenticated application request was performed. Credentials are excluded.

## Evidence boundaries

Local source findings below were inspected independently of production. The production checkout is `24426ebf2d8bcb2ed8ab604ee3f94175a6af9b8b`; running containers were healthy at inspection. Checkout identity alone does not prove equality with compiled runtime source. Production logs showed repeated transaction failures. Case 00010, retained projections and snapshots, live Accounting grants and runtime metadata were inspected read-only; details and remaining uncertainty are recorded below.

## Recorded pricing comparison

Inputs: `/Users/ferferi/Downloads/partner_internal_PI-100683.pdf` and `/Users/ferferi/Downloads/sales_contract_100691_accounting.pdf`.

| Document / row | Physical area | Recorded billing formula | Recorded amount (rial) |
| --- | --- | --- | --- |
| Partner 100683 / first stone | 200 m × 0.4 m = 80 m² | 200 × 18,000,000 | 3,600,000,000 |
| Partner 100683 / second stone | 75 m × 0.4 m = 30 m² | 75 × 14,800,000 | 1,110,000,000 |
| Ordinary 100691 | 250 m × 0.4 m = 100 m² | 100 × 12,000,000 | 1,200,000,000 |

Partner 100683 records 4,710,000,000 rial using linear quantities. If its displayed rates were intended per square meter, these simple dimensions instead produce 1,884,000,000 rial. This conditional comparison does not establish the historical negotiated rate unit or authorize changing a finalized agreement.

Current ordinary pricing multiplies billable material area by the square-meter rate. Requested finished area and consumed mother-stone area can differ. Tools, cutting, finishing, and independent services retain their own price units.

| Family | Current canonical material formula | Evidence |
| --- | --- | --- |
| Longitudinal | consumed material area × square-meter rate | `packages/contract-product-graph/src/longitudinalPolicy.ts:325`; ordinary `remainingStoneService.ts:339` |
| Stair | consumed mother area × square-meter rate | `packages/contract-product-graph/src/stairPolicy.ts:455`; ordinary `CreateContractWizardClient.tsx:1735` |
| Slab | canonical material area × square-meter rate | `packages/contract-product-graph/src/slabPolicy.ts:314` |
| Prepared / volumetric | configured ordinary commercial unit | ADR-0111; `backend/src/services/partnerSales/cases/technicalEvidence.ts:260` |

ADR-0111 already specifies ordinary-sale pricing for new Partner cut-stone technical revisions. `technicalGraph.ts:225` marks this basis `ordinary-sale-v1`; `canonicalWholesale.ts:27` uses canonical quantities for that basis but retains legacy fallback semantics. The broader `commercialQuantityPolicy.ts:34` still maps historical longitudinal evidence to meters and stair evidence to count. A global policy replacement would risk reinterpreting frozen historical evidence.

## Initial diagnosis before local changes

- **Case list:** `backend/src/routes/partner-cases.ts:718–836` locks candidate roots and can reject the entire response for one invalid authorized projection. Its catch maps any thrown exception to `INTEGRITY_CONFLICT`, including a potential timeout, without the equivalent sanitized diagnostic. Frontend `PartnerCaseRuntime.tsx:120` appends generic connection guidance. The screenshot is not proof of stale case evidence. Merging pages alone will not repair this path.
- **Needs support / 00010:** `partnerWizardEntry.ts:59` supplies the message; `PartnerCreationRuntime.tsx:1151` hydrates case, wizard, and graph through separate reads. Schema, identity, saved-state, or price-read integrity errors can produce this message. Subsequent read-only checks validated the retained case and technical snapshots; a failed inquiry read could be misreported as integrity failure. The local fix preserves transient read errors, while the underlying production timeout cause remains unresolved.
- **Catalog and recovery:** existing production logs show `Partner technical request failed`, `TEMPORARY_FAILURE`, `databaseCode: P2028`. Accounting authorization and background jobs also show expired transactions. Access logs show both successful and 503 catalog/recovery-acquire requests around the supplied recovery URL. This establishes transaction failures, but not their underlying lock/query/pool cause or every screenshot's exact cause.
- **Product cards:** `PartnerTechnicalDraftEditor.tsx:234` shows lightweight retained title/rate cards while the catalog is unavailable. Once ready it renders catalog selection and detailed configured rows. Prefer retaining detailed saved rows during loading/error, with a catalog retry and disabled evidence-dependent progression; ordinary Seller workflow must remain intact.
- **Customer seller name:** `PartnerCustomersRuntime.tsx:121` hardcodes «حساب همکار من». CRM service scopes and creates customers using the Partner profile's user identity. This is a confirmed display defect; ownership corruption is not demonstrated. The authorized actual owner name should be projected instead of hardcoding Fariba.
- **Accounting visibility:** ordinary Accounting query excludes Partner contracts. Partner internal documents require `ACCOUNTING_READ`; `authorization/workspaceAuthority.ts` does not bridge ordinary accounting features to that action. ADMIN bypasses grants; MANAGER requires relevant authority. Live read-only inspection confirmed Samaneh is active, has Accounting workspace/admin and contract-view access, and has no active Partner-domain grants; the absent read bridge explains this split.

## Money and audience consistency

Partner Accounting consumes the Sabalan→Partner wholesale agreement. Customer confirmation consumes Partner→Customer retail evidence. Their amounts may legitimately differ; consistency means identical values across outputs of the same agreement, without exposing wholesale prices or margin to customers.

`accounting/internalDocument.ts:158` writes raw Decimal strings in the internal PDF appendix; PDF 100683's final appendix total lacks three-digit grouping and the toman equivalent. `presentation.ts:17` groups Partner money but preserves its currency. Partner public confirmation uses that helper, while ordinary confirmation uses `formatPriceWithRial`. Accounting and sales-list display therefore need deliberate audience-specific normalization and cross-output verification.

## Accepted interview decisions

The product owner answered all seven initial questions:

1. Unified list includes all states belonging to that Partner, including recovery drafts; one row per case, no duplicated linked customer contract and no other Partner's private records.
2. Correct new/editable data; approved or financially recorded cases require the authorized correction workflow and preserved history rather than silent recalculation.
3. Existing Accounting view permission covers internal and Partner wholesale documents within its existing scope. Viewing does not independently grant editing, approval, or cancellation.
4. Preserve independent wholesale and retail agreements; each agreement must remain consistent across its own outputs.
5. Match ordinary billable mother-stone consumption, displaying finished/requested area separately.
6. Longitudinal, stair, and slab material use square-meter rates. Prepared/volumetric products retain their defined commercial units.
7. Accounting and Accounting PDFs use grouped rial, with the final total showing toman in parentheses. Partner sales entry/list uses toman. Customer confirmation uses toman with the rial equivalent in the final total.

## Accepted dependent decisions

8. A problematic case must remain visible in the unified list alongside valid cases. Show verified case identity and a needs-review status; do not show unverified economics or permit finalization. One invalid case must not blank other authorized cases.
9. Changing a price basis in editable data requires fresh inquiry evidence only for affected rows, preserving valid unchanged rows. Changed commercial evidence requires fresh approvals for the new version; historical evidence remains intact.
10. If catalog loading fails when reopening a draft, retain all saved configured product rows and their details. Show the catalog error with retry on the same page, preserve entered data, and prevent adding new stone or continuing to inquiry until the required catalog evidence loads successfully. Do not replace the saved rows with lightweight title/rate-only cards or send the user backward because of that failure.

## Confirmed implementation scope

- Merge the Partner case/recovery presentation into the Partner Sales Contracts list, with one row per case, all owned states, and visible problematic cases. Preserve case history and private ownership.
- Diagnose exact list, saved-case/00010, catalog, and recovery failures using bounded evidence, distinguishing transient transaction failures from commercial-integrity errors. Repair source locally without bypassing finalization/evidence guards or mutating production.
- Enforce the accepted ordinary consumed-material pricing basis for new/editable cut-stone Partner revisions, retain prepared/volumetric units and separate ancillary charges, and refresh affected inquiry/approval evidence. Approved historical contracts change only through the authorized correction workflow.
- Normalize audience-specific money presentation and verify consistency across Partner customer confirmation, Sales list, Accounting, and PDFs within each agreement.
- Display the authorized actual responsible seller identity in customer management.
- Bridge existing scoped Accounting contract-view authority to Partner wholesale reads without granting mutation rights.
- Retain detailed saved product rows during catalog failures and provide inline retry; compare the configured Partner product workflow against ordinary Sale without changing ordinary Seller behavior.

All ten interview decisions and overall shared understanding are accepted. Local implementation is authorized. No production mutation or remote Git delivery is included. Acceptance must include pricing/quantity cases across longitudinal, stair and slab, remainder/service separation, permission scope and audience isolation, invalid-case list visibility, saved-draft catalog recovery, money formatting, and ordinary Seller regression checks. Use the existing `sabalanerp-local` project for runtime QA and required repository checks.


## نتیجه بررسی و اصلاحات محلی

| مشکل گزارش‌شده | نتیجه و مرز اصلاح |
| --- | --- |
| خطای فهرست و دو فهرست جدا | فهرست قراردادهای همکار، پرونده‌های سالم، ردیف نیازمند بررسی و پیش‌نویس خصوصی را یکپارچه می‌کند. پرونده مرتبط با پیش‌نویس دوباره نمایش داده نمی‌شود. مسیر قدیمی برای همکار به همین صفحه هدایت می‌شود. ردیف خراب فقط هویت قابل‌اعتماد دارد. |
| پیام بررسی پرونده ۰۰۰۱۰ | هفت نمای ذخیره‌شده پرونده و سه نسخه فنی بازیابی با ۱۳ ردیف معتبر بودند. در رابط، شکست دریافت قیمت به اشتباه به خرابی شواهد تبدیل می‌شد؛ طبقه‌بندی اصلی خطا حفظ شد. این بررسی، بازتولید دقیق درخواست زمان اسکرین‌شات نیست. |
| مبنای قیمت سنگ | مبلغ جاری قبلاً از محاسبه متعارف مصرف سنگ مادر استفاده می‌کرد، اما مقدار تجاری ذخیره‌شده هنوز می‌توانست متر طول یا تعداد باشد. در نسخه قابل‌ویرایش جاری، مقدار تجاری هم مترمربع مصرف سنگ است. سابقه قطعی بازنویسی نمی‌شود. |
| مسئول فروش مشتری | نام واقعی مالک مجاز از رابطه کاربر در CRM خوانده می‌شود؛ نام ثابت «حساب همکار من» حذف شد. فریبا یا هر مالک جاری دیگری از داده واقعی نمایش داده می‌شود. |
| شکست کاتالوگ و بازگشت از صفحه | جزئیات ردیف ذخیره‌شده در همان صفحه حفظ می‌شود؛ پیام دریافت و تلاش مجدد نمایش داده می‌شود. ویرایش وابسته به کاتالوگ، تکثیر، مصرف باقی‌مانده و ادامه وابسته به شواهد تا آماده‌شدن منابع محدود می‌ماند. |
| کارت خلاصه تکراری محصولات | هنگام انتظار یا خطای کاتالوگ، ردیف ذخیره‌شده دارای جزئیات نمایش داده می‌شود؛ نمای انتخاب کاتالوگ و ردیف‌های پیکربندی‌شده، ساختار اصلی صفحه هستند. مساحت سفارش و مصرف مادر جدا نمایش داده می‌شوند. |
| حسابداری کاربر غیر ADMIN | مجوز مشاهده قراردادهای حسابداری به خواندن قرارداد داخلی همکار متصل شد. منع صریح و دامنه محدود مجوز حفظ می‌شود؛ این اتصال مجوز نوشتن، تأیید یا لغو ایجاد نمی‌کند. |
| نمایش پول | حسابداری و PDF حسابداری ریال گروه‌بندی‌شده و جمع نهایی با تومان داخل پرانتز دارند. فهرست فروش تومان است؛ جمع تأیید مشتری تومان با معادل ریال دارد. تبدیل نمایشی رشته اعشاری دقیق است. |

## مقایسه محاسبات با فروش عادی سبلان

| موضوع | فروش عادی | فروش همکار جاری |
| --- | --- | --- |
| سنگ طولی | مصرف قابل‌صورتحساب سنگ مادر × نرخ مترمربع | همان قاعده؛ مقدار تجاری نسخه جدید هم مترمربع است |
| کف پله، خیز و پاگرد | مساحت مادر مصرف‌شده، جدا از تعداد پله و ابعاد نهایی | همان مالک محاسبه؛ تعداد قطعه و ابعاد در شواهد فنی باقی می‌مانند |
| اسلب | مساحت مادر مصرف‌شده در برنامه برش × نرخ مترمربع | همان قاعده؛ مساحت خروجی مشتری جای مصرف مادر را نمی‌گیرد |
| آماده و حجمی | واحد تجاری تعریف‌شده، مثل عدد یا وزن | واحد خودش حفظ می‌شود |
| ابزار، برش و پرداخت | نرخ و واحد هر عملیات؛ طول فقط برای خدمت طولی | همان تفکیک، با نرخ‌های مشتری و سبلان متعلق به توافق خودشان |
| باقی‌مانده پرداخت‌شده | ماده اولیه دوباره فروخته نمی‌شود؛ عملیات جدید قابل‌محاسبه‌اند | منبع و ردیف فرزند با شناسه ثابت حفظ می‌شوند؛ ماده دوباره شارژ نمی‌شود |
| لایه با سنگ مستقل | ماده و عملیات لایه از شواهد همان سنگ | نرخ و تأیید خرید جداگانه همان ماده؛ از نرخ سنگ اصلی کپی نمی‌شود |
| تخفیف و قیمت خرید | یک توافق مشتری | تخفیف مشتری روی توافق مشتری است؛ خرید همکار از سبلان مستقل است |
| مبلغ ردیف | مبلغ محاسبه‌شده قطعی مرجع است | مبلغ دقیق canonical مرجع است؛ ضرب نرخ مؤثر گرد‌شده جایگزین آن نمی‌شود |
| سابقه و اصلاح | نسخه تأیید‌شده با گردش اصلاح | همان اصل، با جدایی شواهد مشتری، سبلان و حسابداری |

فرمول نمونه: ۴۰ قطعه با طول ۱٫۱ متر و عرض نهایی ۰٫۳۵، مساحت سفارش ۱۵٫۴ مترمربع دارد. اگر برای هر قطعه عرض مادر ۰٫۴ مصرف شود، مبنای ماده ۱۷٫۶ مترمربع است، پیش از اعمال قواعد معتبر برش و عملیات. عدد ۴۰ یا طول ۴۴ متر، نرخ مترمربع ماده را ضرب نمی‌کند. مقدار دقیق مادر از برنامه canonical برش خوانده می‌شود.

## Dependency and relation coverage

| Relation | Guard / verification |
| --- | --- |
| Actor → Partner profile → case / recovery | List filters owned roots before locking and authorizes each root; healthy/damaged/foreign integration test passes. Context list does not delete draft records. |
| Root → revision → hash → projections | Healthy projections validate individually. Invalid rows retain trusted root identity only; detail/finalization remain fail-closed. |
| Technical row → mother consumption → material amount → commercial measure | Current cut-stone measures use canonical material quantity in m². Three-family replay tests verify unchanged predecessor and exact measure/amount. |
| Source → remainder inventory → allocation → child operations | Existing canonical ordered replay and immutable identity tests run; no source/child mutation implementation changed. |
| Stair → independent layers → material subjects | Existing different-material, layer and ancillary pricing checks run; no identity collapse or inherited parent operations added. |
| Inquiry → current price approval → editable successor | Infrastructure/permission errors retain their code. Quantity-only main-material identity remains stable; affected changed identities retain existing re-inquiry rules. |
| Retail / wholesale → exact row totals → agreement projections | Financial/output tests retain separate audiences, discounts and exact totals; currency conversion changes display only. |
| Payment plan / receipt → case revision → financial source | Existing correction, loading and payment-source checks run. New view bridge does not add ACCOUNTING_WRITE. |
| Accounting feature → central grants → explicit deny / narrow scope | Real local database test verifies view only, explicit DENY and PURPOSE_BOUND override. Partner persona remains excluded from internal authority. |
| Customer → current responsible user | CRM integration checks actual owner identity plus existing ownership/CAS behavior. |
| Catalog / lease → saved wizard / detailed rows | Loading/error render tests retain name, price and quantity, and disable catalog-dependent edit/duplicate; 24 recovery integration checks pass. |
| Ordinary Seller → unchanged component and pricing engine | Ordinary contracts component stays intact behind persona selection. Shared graph tests and ordinary pricing regression checks verify calculation semantics. |

## Confirmed production evidence

The supplied case is tracking 00010, `partner-recovery-6886b825-9a27-4c0e-8d65-7e137579017e`. Its retained case views passed schema validation; recovery revision 16 contains 13 rows. Retained technical snapshots 14, 15 and 16 decode successfully, use `ordinary-sale-v1`, and share the same graph hash. Current inquiry rate identities are square-meter identities. No repair or repricing was executed on production.

Logs contain repeated P2028 transaction expirations for technical requests and Accounting authorization. The local changes reduce Partner list query scope and supplementary reads, provide a bounded list transaction, preserve retryable failure classification, and retain saved UI state. The underlying production lock/query/pool cause has not been established conclusively. A single pg_stat_activity sample showed idle connections rather than an active blocker; that does not rule out transient contention. Production behavior remains unverified after these local changes.

## Verification ledger

- 31 targeted backend timeout, technical pricing and internal-document checks passed before the commercial-measure extension; the extended three-family checks and graph reuse checks also passed.
- 24 technical recovery database tests passed with the corrected m² save assertion.
- 54 financial, canonical graph, customer total/output, policy and service checks passed after updating the agreed commercial-unit expectations.
- 66 Partner frontend checks passed, including retained details, disabled dependent actions, transient error classification, unified list and exact money conversion.
- Real database Accounting bridge, actual CRM owner and healthy/damaged/foreign list checks passed.
- Existing real-schema customer correction HTTP successor and loading/dispatch evidence tests passed.
- Canonical product graph suite passed, covering longitudinal/stair/slab and remainder/allocation invariants.
- Architecture, Design System changed-file check, foundation (25 checks), adoption (14 checks), frontend production build and whitespace checks passed. Final backend and frontend production builds passed.
- Five browser acceptance checks passed: unified healthy/damaged/private-recovery lists and legacy redirect at desktop/mobile widths, reviewed correction payment preservation at both widths, and independent-service defaults, rates and recovery identity.
- Ordinary Seller canonical longitudinal pricing, all-family pricing, remaining-stone allocation replay and stair identity regression files passed (8 reported test cases).
- Follow-up: the explicit-resume browser check now passes with valid retained technical recovery, real-shaped wizard GET/PUT fixtures and an actor-isolation assertion. The earlier stale/null mock did not describe a valid resumable draft. A separate browser regression reproduced repeated idle autosaves and passed after the persistence fix and local image rebuild.
- Local Docker verification passed. The final backend image was rebuilt in the same Compose project after the last route-admission change; `/api/ready` returned 200. First build encountered npm ECONNRESET and was retried; subsequent test fixture TypeScript errors were repaired. An early browser run overlapped service recreation and was interrupted; it is not acceptance evidence.
- Broad lifecycle run: 22/24 initially passed. Loading/PDF failed due to missing host Puppeteer Chrome; rerunning with installed Chrome passed. Follow-up repaired the legacy lifecycle authority escalation and updated the Accounting probe to test the accepted view bridge with explicit DENY/revocation while retaining grant history. The durable queue and Partner lifecycle checks now pass; four selected real HTTP/lifecycle checks passed together.
- An existing workspace route matrix also fails its unrelated HR performance admission assertion. The new isolated Partner lifecycle list-admission test passes; the broad matrix is not claimed as passing.

No production change, Git push, merge or deployment is part of this result. Generated QA PDFs, images and scripts remain local under `tmp/qa/partner-sales-2026-10-11/`.


Follow-up performance evidence and the final exclusion of Cross-workspace Duties are recorded in [performance-audit-2026-10-11.md](./performance-audit-2026-10-11.md). All subsequent fixes and Docker rebuilds remain local.


## پوشش قرارداد قطعی در قاعده مترمربع

وضعیت قطعی، استثنایی برای محاسبه سنگ نیست. مقدار تجاری سنگ طولی، پله و اسلب در گراف جاری مبتنی بر ordinary-sale-v1 از مصرف قابل‌صورتحساب سنگ مادر به مترمربع گرفته می‌شود؛ همان شواهد هنگام ذخیره و نهایی‌سازی حفظ می‌شوند. آماده و حجمی همچنان واحد تعریف‌شده خودشان را دارند و ابزار/برش واحد خدمت مستقل دارند.

قرارداد قطعی تاریخی به‌صورت خودکار محاسبه و بازنویسی نمی‌شود. اگر مبلغ یا واحد ذخیره‌شده آن نادرست باشد، اصلاح باید از گردش رسمی و با حفظ نسخه و شواهد مالی پیشین انجام شود. بنابراین این اصلاح به معنی صحیح‌شدن خودکار همه قطعی‌های قبلی یا تغییر قراردادهای سرور نیست.
