# ممیزی Product Graph و دو حقیقت مالی Partner

- تاریخ: 2026-08-26
- مسئله: GitHub Issue #299، «ممیزی Product Graph و دو حقیقت مالی Partner»
- نوع کار: تحقیق و طراحی؛ بدون تغییر رفتار production
- مبنا: شاخه‌ی `origin/main` در worktree تمیز `D:\sabalanerp-research-299`

## نتیجه اجرایی

مدل Partner نباید دو `SalesContract` کامل و مستقل با دو کپی از Product Graph، `ContractItem` و Delivery بسازد. grain فعلی سیستم یک ردیف فیزیکی/تجاری با `productRowId` پایدار است؛ همان ردیف در Product Graph، `ContractItem`، Delivery، Accounting seal و Shipment reconciliation دنبال می‌شود. دوبرابر کردن آن، یک سفارش فیزیکی را به دو تعهد قابل‌تحویل و دو baseline کمیت تبدیل می‌کند.

مرز امن پیشنهادی این است:

1. یک `PartnerSaleCase` مالک یک graph/version مشترک از محصول، پیکربندی، هندسه، quantity، processing، tools و Delivery باشد.
2. رکورد داخلی Sabalan تنها operational owner باشد: graph، `ContractItem`، Delivery، fulfillment، Accounting و shipment به آن متصل بمانند.
3. دو price envelope نسخه‌دار و immutable، هر دو با `productRowId` به همان graph revision متصل شوند:
   - `SABALAN_TO_PARTNER`: قیمت و اجزای مورد تأیید استعلام؛ تنها منبع Accounting و بدهی Partner به Sabalan.
   - `PARTNER_TO_CUSTOMER`: قیمت خرده‌فروشی و تخفیف مشتری؛ تنها منبع سند مشتری و گزارش مجاز Partner.
4. رکورد مشتری یک commercial façade/version باشد، نه دومین صاحب Product/Delivery truth. برای reproducibility می‌تواند snapshot مشتق‌شده و hash-linked داشته باشد، اما writer مستقل برای quantity، geometry یا Delivery نداشته باشد.

این طراحی با معماری فعلی کاملاً رایگان نیست: Product Graph امروز خودش `baseAmountToman` و `totalAmountToman` را در همان row نگه می‌دارد (`packages/contract-product-graph/src/productGraph.ts:85-95`) و projection حسابداری pricing components را از همان graph می‌گیرد (`packages/contract-product-graph/src/projections.ts:263-306`). بنابراین برای دو قیمت هم‌زمان باید «shared supply/configuration graph» از «price envelope» به‌صورت صریح جدا یا pricing projection پارامتریک شود؛ اضافه کردن یک `retailTotalPrice` دیگر داخل row، تکرار همان coupling است و توصیه نمی‌شود.

## دامنه و منابع production بررسی‌شده

### قواعد دامنه و ADRها

- stable row identity و replay اتمیک باقی‌مانده: `docs/adr/0007-transactional-remaining-stone-allocation-replay.md:1-3`
- جدایی درخواست مشتری از geometry داخلی optimizer: `docs/adr/0010-preserve-customer-request-across-optimizer.md:1-19`
- جدایی برش فیزیکی از charge قابل‌صورتحساب در محصول حکمی: `docs/adr/0012-bill-longitudinal-not-cross-cutting-for-mandatory-products.md:1-7`
- `productRowId` به‌عنوان تنها هدف canonical تخصیص Delivery: `docs/adr/0013-stable-delivery-product-row-identity.md:7-34`
- seal کمیت optimizer از witnessهای هم‌هویت و نسخه‌دار: `docs/adr/0042-seal-optimizer-derived-longitudinal-quantity-from-agreeing-witnesses.md:1-5`
- precision نسخه‌دار، ممنوعیت derive کمیت از مبلغ و ممنوعیت rewrite سند امضاشده: `docs/adr/0045-version-commercial-quantity-precision-and-automate-evidence-recovery.md:7-21`
- قواعد domain متناظر: `CONTEXT.md:37-47`, `CONTEXT.md:57-74`, `CONTEXT.md:3395-3413`

### مسیرهای production

- state/typeهای wizard و شکل `ContractProduct`/Delivery: `frontend/src/features/contract-creation/types/contract.types.ts:420-558`, `frontend/src/features/contract-creation/types/contract.types.ts:560-580`, `frontend/src/features/contract-creation/types/contract.types.ts:628-676`
- preflight هویت، graph، Delivery و pricing در submit: `frontend/src/features/contract-creation/hooks/useContractSubmission.ts:119-203`, `frontend/src/features/contract-creation/hooks/useContractSubmission.ts:214-290`
- mapping یک state به embedded snapshot و relational rows: `frontend/src/features/contract-creation/hooks/useContractSubmission.ts:307-402`
- backend create/update transaction، relational persistence و graph snapshot: `backend/src/services/contractService.ts:674-870`, `backend/src/services/contractService.ts:1020-1149`
- graph persistence نسخه‌دار و compare-and-set: `backend/src/services/contractProductGraphPersistence.ts:81-159`, `backend/src/services/contractProductGraphPersistence.ts:181-216`
- Product Graph canonical و projectionهای downstream: `packages/contract-product-graph/src/productGraph.ts:70-145`, `packages/contract-product-graph/src/projections.ts:50-82`, `packages/contract-product-graph/src/projections.ts:263-327`
- replay باقی‌مانده: `packages/contract-product-graph/src/remainderPolicy.ts:285-310`, `packages/contract-product-graph/src/remainderPolicy.ts:400-565`
- Contract snapshot boundary و Accounting candidate/approval: `backend/src/services/contractSnapshotBoundary.ts:104-127`, `backend/src/services/accountingService.ts:1426-1513`, `backend/src/services/accountingService.ts:1635-1800`
- approved-pricing validation/seal: `backend/src/services/approvedPricing/domain.ts:459-538`, `backend/src/services/approvedPricing/domain.ts:582-752`
- finalization quantity guard: `backend/src/services/contractQuantityEvidenceGuard.ts:14-94`
- Delivery persistence و print consumers: `backend/src/services/contractService.ts:1043-1077`, `backend/src/services/deliveryService.ts:9-90`, `backend/src/utils/printTemplate.ts:786-807`, `backend/src/utils/printTemplate.ts:995-1035`, `backend/src/utils/printTemplate.ts:1095-1180`, `backend/src/utils/printTemplate.ts:1236-1277`
- schemaهای Contract، graph، items، Delivery، approved pricing و shipment: `backend/prisma/schema.prisma:1737-1825`, `backend/prisma/schema.prisma:2259-2322`, `backend/prisma/schema.prisma:2993-3061`, `backend/prisma/schema.prisma:3762-3820`, `backend/prisma/schema.prisma:4123-4175`

## نقشه حقیقت فعلی

| Fact | مالک canonical فعلی | snapshot / witnessهای دیگر | invariant |
|---|---|---|---|
| row identity | `CanonicalProductRow.productRowId` / `ContractItem.productRowId` | `contractData.products[].rowId`, `DeliveryProduct.productRowId`, approved-pricing row | catalog ID، نام و index هویت row نیستند. schema برای `ContractItem` در هر Contract uniqueness دارد (`backend/prisma/schema.prisma:2259-2288`). |
| geometry/configuration | Product Graph row، catalog snapshot و policy inputs | embedded `contractData.products` برای compatibility/output | رابطه parent/source فقط با stable ID معتبر است (`packages/contract-product-graph/src/graphIntegrity.ts:164-194`). |
| remaining inventory/allocation | graph source batches، remaining stones و allocations | legacy fields در product snapshot | replay به ترتیب پایدار، صریح و all-or-nothing است (`packages/contract-product-graph/src/remainderPolicy.ts:400-565`). |
| requested/commercial quantity | `CanonicalCommercialFacts` با policy نسخه‌دار | `ContractItem.quantity`، invoice item و Delivery witnesses | Piece Count، Measured Quantity و Billable Quantity نباید یکی فرض شوند (`CONTEXT.md:41-43`). |
| base/all-in price | امروز داخل Product Graph row (`baseAmountToman`, `totalAmountToman`) | `ContractItem`, `contractData`, invoice item، approved-pricing row | در مرز approval همه witnessها باید reconcile شوند؛ اختلاف fail-closed است (`backend/src/services/approvedPricing/domain.ts:469-490`, `backend/src/services/approvedPricing/domain.ts:599-660`). |
| pricing components | projection حسابداری از calculation snapshot و operation rows | `meta.pricing` و legacy add-on fields در frontend | component identity باید یکتا باشد و مجموع componentها با all-in total برابر شود (`backend/src/services/approvedPricing/domain.ts:281-318`). |
| Contract total/discount | graph total + discount evidence؛ `SalesContract.totalAmount` مقدار persisted | wizard payment total، invoice amount | graph total باید با ordered row totals برابر باشد (`backend/src/services/approvedPricing/domain.ts:585-597`). |
| Delivery plan | relational `Delivery`/`DeliveryProduct` برنامه جاری Sales؛ graph row ID هدف است | wizard Delivery copy witness تاریخی/compatibility | Delivery scheduling است، نه physical dispatch (`CONTEXT.md:3411-3413`). |
| Accounting approval | immutable `ContractApprovedPricingVersion` و rows | `AccountingFinancialRecord.sourceSnapshot` و invoice items | approval با source snapshot/hash و graph revision seal می‌شود (`backend/src/services/approvedPricing/domain.ts:687-752`). |
| shipment quantity | event evidence + approved-pricing version در grain یک `ContractItem` | projection cache | `Contracted = Reserved + Dispatched + Available`; Delivery مستقیماً bucket را عوض نمی‌کند (`CONTEXT.md:3395-3408`). |

## transitionهای اصلی

### 1. Wizard → Contract write

submit یک `normalizedProducts` می‌سازد، operationها و finishing را دوباره محاسبه می‌کند و `totalPrice` را reconcile می‌کند (`frontend/src/features/contract-creation/hooks/useContractSubmission.ts:214-290`). سپس همان facts را هم‌زمان در سه شکل می‌فرستد:

- `contractData.products` و `contractData.deliveries` (`frontend/src/features/contract-creation/hooks/useContractSubmission.ts:324-337`)
- `_relations.items` (`frontend/src/features/contract-creation/hooks/useContractSubmission.ts:346-360`)
- `_relations.deliveries[].products` با `productRowId` (`frontend/src/features/contract-creation/hooks/useContractSubmission.ts:361-378`)

backend همه را داخل یک transaction می‌نویسد و از snapshot wizard یک canonical graph version و audit می‌سازد (`backend/src/services/contractService.ts:756-870`). در edit، `ContractItem` با `productRowId` synchronize می‌شود، اما Delivery و Payment relational rows حذف و دوباره ساخته می‌شوند (`backend/src/services/contractService.ts:1043-1099`) و graph revision جدید ثبت می‌شود (`backend/src/services/contractService.ts:1123-1148`).

نتیجه: transaction اتمیک است، اما یک fact در چند شکل ذخیره می‌شود. سلامت فعلی حاصل reconciliation و fail-closed guards است، نه نبود duplication.

### 2. Contract → Accounting candidate → approved pricing

invoice candidate یک snapshot محدودشده از Contract کامل و invoice-item rowهای جدا می‌سازد (`backend/src/services/accountingService.ts:1426-1481`). snapshot boundary فقط CRM navigation را حذف می‌کند و Product/Delivery/Payment evidence را نگه می‌دارد (`backend/src/services/contractSnapshotBoundary.ts:104-127`).

approval ابتدا financial record را lock می‌کند، duplicate/void/correction/amount blockers را می‌سنجد، سپس approval time/actor را ثبت و در همان transaction approved-pricing seal را می‌سازد (`backend/src/services/accountingService.ts:1635-1800`). seal موارد زیر را با هم تطبیق می‌دهد:

- تعداد و هویت graph rows، embedded product snapshots و frozen/live ContractItems؛
- invoice items با `contractItemId`؛
- quantity optimizer با graph، ContractItem، invoice item، persisted Delivery و wizard Delivery؛
- component totals، gross، discount و net.

مراجع: `backend/src/services/approvedPricing/domain.ts:469-538`, `backend/src/services/approvedPricing/domain.ts:582-660`.

### 3. Approved quantity → fulfillment

هر approved-pricing row `contractedQuantity`, unit، canonical all-in total و component evidence را به‌صورت immutable نگه می‌دارد و uniqueness آن بر `pricingVersionId + productRowId` است (`backend/prisma/schema.prisma:3024-3050`). shipment evidence و projection نیز `contractItemId + productRowId + unit` را حمل می‌کنند (`backend/prisma/schema.prisma:3762-3820`). این همان boundary است که اجازه نمی‌دهد Partner customer record یک baseline کمیت مستقل بسازد.

### 4. Print/PDF

print وقتی `contractData.products` موجود باشد آن را ترجیح می‌دهد، اما relational fallback item را با `productId + stairPartType` یا index پیدا می‌کند، نه `productRowId` (`backend/src/utils/printTemplate.ts:798-807`). برای Delivery هم embedded snapshot را در صورت وجود کاملاً ترجیح می‌دهد و فقط در fallback/merge به relational rows می‌رسد (`backend/src/utils/printTemplate.ts:1095-1180`). بنابراین print فعلی یک consumer ترکیبی و compatibility-heavy است؛ جای امنی برای انتخاب wholesale/retail truth بر اساس حدس یا catalog identity نیست.

## سناریوهای deterministic تازه

یک harness موقت علیه production exports اجرا و پس از اجرا حذف شد. همچنین focused production tests اجرا شدند. هیچ دیتابیس یا Docker stack ساخته نشد.

### سناریو A — دو row با catalog یکسان

ورودی: graph revision 7 با دو row به شناسه‌های `row-a` و `row-b`، هر دو `catalogProductId = same-catalog`، با quantityهای 2 و 3 و totals برابر 120 و 230.

خروجی:

```text
accounting: row-a / 2 / 120; row-b / 3 / 230
delivery:   row-a / 2;       row-b / 3
delivery pricingComponents: [] برای هر دو row
```

نتیجه: catalog similarity rowها را merge نمی‌کند و audience delivery قیمت را نمی‌گیرد؛ stable identity و audience projection seam مناسب هستند. این رفتار مستقیماً از `projectCanonicalProductGraph` می‌آید (`packages/contract-product-graph/src/projections.ts:263-306`) و با ADR-0013 سازگار است (`docs/adr/0013-stable-delivery-product-row-identity.md:9-23`).

### سناریو B — replay اتمیک باقی‌مانده

ورودی: یک source stock با quantity = 3 و دو child ordered که هر کدام quantity = 2 از همان explicit remainder می‌خواهند.

خروجی:

```text
conflict: selected-remainder-insufficient برای child-second
source quantity after failed replay: 3
```

نتیجه: child اول به‌صورت نیمه‌کاره commit نمی‌شود؛ fail، کل mutation را رد می‌کند. production implementation conflicts را جمع می‌کند و فقط وقتی صفر است result می‌سازد (`packages/contract-product-graph/src/remainderPolicy.ts:400-565`).

### سناریو C — focused suites

- `remainderPolicy.test.ts`: pass
- `projections.test.ts`: pass
- `deliveryProductIdentity.test.ts`: pass

این تست‌ها evidence مکمل‌اند، نه authority. نتیجه‌ی اصلی بر production functions و scenario تازه بالا استوار است.

## failure و duplication riskها

### P0 — دو Contract operational برای یک فروش Partner

اگر هر دو سند ContractItem، Product Graph و Delivery مستقل بگیرند، Logistics/Shipment دو contracted baseline برای یک supply واقعی می‌بیند. `ShipmentQuantityProjection` در grain `contractItemId` است (`backend/prisma/schema.prisma:3799-3817`)؛ در نتیجه duplicate record به‌طور ساختاری double obligation می‌سازد، حتی اگر UI آن‌ها را «linked» نشان دهد.

### P0 — مخلوط شدن debtor و accounting price

`AccountingFinancialRecord` فقط یک `contractId`, `customerId`, `amount` و `sourceSnapshot` دارد (`backend/prisma/schema.prisma:4123-4160`). اگر retail Contract وارد مسیر فعلی candidate شود، end customer و retail amount به Sabalan receivable تبدیل می‌شوند. eligibility باید نوع رکورد/price context را در backend fail-closed کنترل کند؛ UI hiding کافی نیست.

### P0 — graph فعلی فقط یک monetary truth دارد

`CanonicalCommercialFacts` یک `baseRateToman/baseAmountToman/totalAmountToman` دارد (`packages/contract-product-graph/src/productGraph.ts:85-95`) و approved-pricing head نیز برای هر Contract فقط یک current version نگه می‌دارد (`backend/prisma/schema.prisma:3053-3061`). افزودن wholesale و retail به همان فیلدها یا ساخت دو graph، به‌ترتیب overwrite یا drift ایجاد می‌کند. price-context باید first-class و row-keyed باشد.

### P1 — standalone Delivery writer بدون stable row identity

API/service مستقل Delivery فقط `productId` و quantity می‌پذیرد و `productRowId` نمی‌نویسد (`backend/src/services/deliveryService.ts:9-33`, `backend/src/services/deliveryService.ts:71-86`). این با ADR-0013 در تضاد است و برای catalog تکراری مبهم می‌شود. Partner fulfillment نباید از این writer استفاده کند تا زمانی که harden یا retire شود.

### P1 — print با catalog/index fallback

product print embedded snapshot را ترجیح می‌دهد و relation item را با catalog/stair/index fallback وصل می‌کند (`backend/src/utils/printTemplate.ts:798-807`). Delivery print هم snapshot را ترجیح می‌دهد و compatibility fallback دارد (`backend/src/utils/printTemplate.ts:1095-1180`). برای Partner، یک output resolver صریح باید `(caseId, graphVersionId, priceContextVersionId, audience)` دریافت کند؛ wholesale/retail نباید با fallback انتخاب شود.

### P1 — edit Delivery identity را بازسازی می‌کند

Contract edit تمام DeliveryProduct/Delivery relational rows را delete/recreate می‌کند (`backend/src/services/contractService.ts:1043-1077`). بنابراین linkage Partner به `deliveryId` mutable یا array position شکننده است. linkage باید به shared Delivery plan version یا stable delivery-plan row identity متصل شود، نه DB rowی که در edit عوض می‌شود.

### P1 — component-level retail ambiguity

Accounting seal برای هر row component identities و component sum را validate می‌کند (`backend/src/services/approvedPricing/domain.ts:281-318`). template استاندارد نیز base، cutting، tools، services و mandatory را جدا render می‌کند (`backend/src/utils/printTemplate.ts:1236-1270`, `backend/src/utils/printTemplate.ts:1530-1640`). اگر Partner فقط یک retail all-in price وارد کند، هنوز معلوم نیست اعداد component rows در سند استاندارد چه باشند. derive نسبتی یا استفاده از wholesale componentها ممکن است margin را افشا کند یا جمع visible rows را خراب کند.

### P2 — embedded snapshot در برابر current relation

امروز `contractData.products`, `ContractItem`, graph، `contractData.deliveries`, relational Delivery، invoice source snapshot و approved-pricing evidence، شاهدهای متعدد هستند. این duplication برای audit/compatibility قابل‌قبول است فقط وقتی owner روشن، hash/version ثبت و validation قطعی باشد. Partner نباید شکل هشتمی بسازد که writer مستقل داشته باشد.

## تناقض‌ها و شکاف‌ها

1. ADR-0013 می‌گوید Delivery canonical target همیشه `productRowId` است (`docs/adr/0013-stable-delivery-product-row-identity.md:13-34`)، اما standalone Delivery service هنوز `productId`-only است (`backend/src/services/deliveryService.ts:9-33`, `backend/src/services/deliveryService.ts:71-86`).
2. domain می‌گوید هر downstream output باید همان saved row facts/totals را reconcile کند، ولی print relation fallback با catalog/stair/index انجام می‌شود (`backend/src/utils/printTemplate.ts:798-807`). این برای repeated catalog rows امن نیست.
3. quantity/Delivery boundary نسبتاً عمیق و fail-closed شده، اما price ownership هنوز در legacy snapshot، `ContractItem` و graph تکرار دارد. approved-pricing seal اختلاف را دیرتر می‌گیرد؛ Partner باید write boundary مشترک را قبل از ایجاد دو سند enforce کند، نه اینکه Accounting اولین detector باشد.
4. مدل Partner در production schema وجود ندارد. `ContractKind` فعلی فقط `standard | collaboration` است (`frontend/src/features/contract-creation/types/contract.types.ts:628-632`) و approved-pricing فعلی contract kindهای غیرstandard را رد می‌کند (`backend/src/services/approvedPricing/domain.ts:232`). پس reuse ضمنی `collaboration` برای Partner هم از نظر معنایی و هم از نظر Accounting نادرست است.

## مرز طراحی/repair پیشنهادی، به‌ترتیب ایمنی

### 1. P0 — aggregate و ownership را قبل از UI تعریف کنید

`PartnerSaleCase` باید aggregate root با یک `sharedGraphHead` باشد. دو commercial record فقط party/lifecycle/output/payment/price-context خود را داشته باشند. internal record تنها `operationalContractId` باشد. customer record هرگز `ContractItem`, Delivery, shipment evidence یا Accounting candidate مستقل نسازد.

### 2. P0 — price context را از graph جدا کنید

یک مدل نسخه‌دار مانند زیر لازم است:

```text
PartnerSaleCase
  sharedGraphVersionId
  operationalContractId
  customerCommercialRecordId

PartnerPriceVersion
  caseId
  graphVersionId
  context: SABALAN_TO_PARTNER | PARTNER_TO_CUSTOMER
  currency
  gross / discount / net
  inquiryEvidenceId?       # برای wholesale
  rows[] keyed by productRowId
  integrityHash
```

quantity، geometry، unit، processing و Delivery در price row کپی نشوند؛ فقط identity/hash references و issued evidence snapshot نگه داشته شود. `SABALAN_TO_PARTNER` باید component evidence مورد تأیید استعلام را seal کند. `PARTNER_TO_CUSTOMER` باید retail facts صریح و discount خود را seal کند.

### 3. P0 — create/commit/cancel/correct را یک transaction کنید

create case باید graph + هر دو price versions + هر دو commercial records را all-or-nothing بسازد. commitment فقط یک transition هماهنگ داشته باشد. product/quantity/configuration correction یک graph revision جدید و دو price version هماهنگ می‌سازد؛ retail-only correction نباید graph یا Sabalan receivable را touch کند.

### 4. P0 — Accounting eligibility را backend-enforced کنید

فقط `operationalContractId` و context `SABALAN_TO_PARTNER` اجازه candidate/approval/receivable/tax integration داشته باشد. customer record باید حتی با ID مستقیم API fail شود. approved-pricing head باید یا روی `(caseId, priceContext)` dimension بگیرد یا wholesale head فعلی فقط روی internal record باقی بماند و retail seal مدل جدا داشته باشد.

### 5. P1 — projection/output boundary صریح بسازید

یک resolver واحد:

```text
renderPartnerCommercialDocument(caseId, graphVersionId, priceVersionId, audience)
```

باید graph مشترک را با price envelope مجاز join کند، allowlist audience را اعمال کند و immutable issued snapshot/hash بسازد. customer output هرگز wholesale price، inquiry evidence، margin یا internal record ID را serialize نکند. Accounting/workshop/delivery فقط operational record را ببینند.

### 6. P1 — Delivery writerها را یکپارچه کنید

standalone Delivery payload باید `productRowId` را required کند، catalog-only writes را برای new data رد کند و همان reconciliation مرز Contract submit را reuse کند. Partner فقط یک Delivery plan روی operational side دارد؛ customer side status projection است.

### 7. P1 — regression matrix اجباری

حداقل پوشش:

- دو row با catalog یکسان و دو retail price متفاوت؛
- remaining child با source explicit و add-on مستقل؛
- optimizer quantity-zero با Delivery چندردیفی؛
- تغییر geometry که replay child دوم را fail می‌کند و هیچ‌یک از دو سند تغییر نمی‌کنند؛
- retail-only price/discount correction بدون تغییر wholesale/fulfillment؛
- product correction با inquiry جدید و version هماهنگ هر دو price context؛
- Accounting candidate فقط برای internal record؛
- customer PDF/public confirmation بدون wholesale leakage؛
- one shipment baseline و one Delivery plan در تمام lifecycleها.

## تصمیم‌های کسب‌وکاری باقی‌مانده

1. **grain قیمت retail چیست؟** توصیه: هر `productRowId` یک retail all-in amount صریح داشته باشد. اگر template باید component-level prices نشان دهد، Partner باید component prices را صریح تعیین کند یا یک allocation policy کسب‌وکاری نسخه‌دار تصویب شود؛ proportional derivation نباید حدس زده شود.
2. **آیا discount retail روی همه rowهاست یا eligibility مستقل دارد؟** توصیه: retail discount evidence کاملاً جدا از Sabalan discount policy باشد و net retail فقط از retail envelope مشتق شود.
3. **آیا مالیات/عوارض retail در ERP فقط نمایش/track می‌شود یا سند مالی مستقل Partner است؟** تا تصمیم روشن نشده، به Sabalan Accounting و tax records وارد نشود.
4. **customer commercial record دقیقاً چه lifecycle statusهایی دارد؟** باید روشن شود آیا `APPROVED`, `SIGNED`, `PRINTED`, correction و cancellation با Contract فعلی هم‌معنا هستند یا state machine مخصوص aggregate لازم است.
5. **قیمت استعلام component-level است یا all-in؟** چون Product Graph ابزار، finishing، برش و mandatory را componentized می‌کند، approval evidence باید دقیقاً تعیین کند کدام componentها frozen هستند و تغییر کدام field inquiry جدید می‌خواهد.
6. **standalone services در نسخه اول مجازند؟** توصیه: تا ownership و fulfillment آن‌ها مشخص نشده خارج از shared graph و Partner workflow بمانند.
7. **issued document retention:** آیا snapshot کامل render DTO نگه داشته می‌شود یا فقط version references + hash؟ توصیه: هر دو؛ reference/hash truth و render snapshot immutable برای بازتولید حقوقی.
8. **Delivery plan identity:** قبل از Partner rollout باید تصمیم شود آیا Delivery rows stable logical ID می‌گیرند یا edit همچنان delete/recreate می‌کند. برای cross-record status reflection، stable plan-row identity امن‌تر است.

## معیار پذیرش معماری Partner

طراحی فقط وقتی امن است که این معادلات و assertions برقرار باشند:

```text
one case -> one graph head -> one set of productRowIds
one productRowId -> one quantity/geometry/fulfillment lineage
two price contexts -> same graphVersionId + same productRowIds
Accounting amount = SABALAN_TO_PARTNER net only
Customer output amount = PARTNER_TO_CUSTOMER net only
Shipment contracted quantity = approved operational row quantity only
```

هر snapshot اضافی باید derived، immutable، version/hash-linked و فاقد writer تجاری مستقل باشد. هر اختلاف identity/quantity/component/total باید در create/commit boundary fail-closed شود؛ نه با merge، catalog matching، index fallback یا derive از پول.

## فرمان‌های verification اجراشده

```text
production-function disposable harness: PASS
packages/contract-product-graph/src/__tests__/remainderPolicy.test.ts: PASS
packages/contract-product-graph/src/__tests__/projections.test.ts: PASS
frontend/src/features/contract-creation/services/__tests__/deliveryProductIdentity.test.ts: PASS
```

Harness موقت پس از ثبت خروجی حذف شد. original dirty worktree تغییر نکرد و هیچ GitHub Issue mutation انجام نشد.
