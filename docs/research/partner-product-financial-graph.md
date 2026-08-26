# ممیزی Product Graph و دو حقیقت مالی فروشنده همکار

تاریخ پژوهش: ۱۴۰۵/۰۶/۰۴ (2026-08-26)  
Ticket: [#299](https://github.com/Mahaan-Amr/sabalanerp/issues/299)

## جمع‌بندی اجرایی

جریان production فعلی بر یک فرض بنیادی بنا شده است: هر `SalesContract` یک Product Graph قیمت‌دار، یک مبلغ نهایی، یک طرف حساب، یک مجموعه `ContractItem` و یک مانده فیزیکی برای تحویل/بارگیری دارد. این فرض برای قرارداد عادی درست است، اما برای پرونده Partner که دو معامله مالی و فقط یک تعهد فیزیکی دارد کافی نیست.

مدل امن این است که **یک `PartnerSaleCase` مالک یک Product Graph و یک مجموعه ردیف فیزیکی باشد** و دو سند فقط دو projection مالی مستقل و immutable از همان ردیف‌ها باشند:

- سند داخلی سبلان: بدهکار = حساب تجاری Partner، قیمت = snapshot استعلام معتبر؛ تنها سند مجاز برای Accounting و receivable سبلان.
- قرارداد مشتری: طرف = مشتری نهایی، قیمت = قیمت آزاد Partner و تخفیف مشتری؛ تنها سند عمومی/PDF/SMS.

دو سند نباید هرکدام `ContractItem`، Delivery و Product Graph مستقل داشته باشند. این کار علاوه بر divergence، مانده قابل بارگیری را دو برابر می‌کند. رابطه همه قیمت‌ها، استعلام‌ها، deliveryها و snapshotها باید با `caseProductRowId` پایدار انجام شود، نه index، نام یا catalog product ID.

## مسیرهای production و invariantهای فعلی

### ۱. Product Graph

مدل canonical، ردیف‌های محصول، روابط parent/source، پله و لایه، source batch، remainder، allocation، operation group، ابزار و پرداخت را در یک aggregate نسخه‌دار نگه می‌دارد. هر ردیف `productRowId` دارد و روابط از همان هویت استفاده می‌کنند؛ مبلغ پایه و مبلغ کل نیز امروز داخل `commercial` همان ردیف قرار دارند ([productGraph.ts](../../packages/contract-product-graph/src/productGraph.ts#L111), [productGraph.ts](../../packages/contract-product-graph/src/productGraph.ts#L154)).

ویرایش منبع، موجودی را از شواهد منبع بازسازی و مصرف‌کنندگان را به ترتیب قطعی replay می‌کند. failure پیش از ساخت graph جدید برمی‌گردد؛ سپس integrity کل graph بررسی می‌شود. این رفتار با تصمیم replay اتمیک هم‌راستاست ([ADR-0007](../adr/0007-transactional-remaining-stone-allocation-replay.md)).

مهم‌ترین invariantها:

1. `productRowId` هویت تجاری/فیزیکی ردیف است؛ index و `productId` فقط اطلاعات سازگاری یا catalog هستند.
2. روابط remainder و layer به row پایدار متصل‌اند و تغییر منبع باید کل allocationها را اتمیک replay کند.
3. درخواست مشتری، هندسه مصرف و breakdown داخلی optimizer سه حقیقت متفاوت‌اند؛ optimizer نباید خواسته تجاری را بازنویسی کند ([ADR-0010](../adr/0010-preserve-customer-request-across-optimizer.md)).
4. عملیات فیزیکی برش با مبلغ billable آن یکی نیست؛ به‌ویژه حکمی برش طولی را billable و برش عرضی را non-billable نگه می‌دارد ([ADR-0012](../adr/0012-bill-longitudinal-not-cross-cutting-for-mandatory-products.md)).
5. ابزار، پرداخت و pricing component دقیقاً یک مالک row دارند و total باید فقط یک بار آن‌ها را بشمارد.

Projection فعلی برای همه audienceها همان `baseAmountToman` و `totalAmountToman` را بازمی‌گرداند؛ فقط جزئیات `pricingComponents` به audience حسابداری محدود است ([projections.ts](../../packages/contract-product-graph/src/projections.ts#L263)). بنابراین audience فعلی یک boundary محرمانگی برای دو قیمت Partner نیست.

### ۲. write boundary قرارداد

Wizard پیش از ارسال، هویت ردیف‌ها، semantic repair، graph reconciliation، delivery reference و override عملیات را بررسی می‌کند؛ سپس products، HTML، `contractData`, relational items، Deliveryها و Paymentها را از یک state تولید می‌کند ([useContractSubmission.ts](../../frontend/src/features/contract-creation/hooks/useContractSubmission.ts#L119), [useContractSubmission.ts](../../frontend/src/features/contract-creation/hooks/useContractSubmission.ts#L214), [useContractSubmission.ts](../../frontend/src/features/contract-creation/hooks/useContractSubmission.ts#L307)).

Backend همه بخش‌ها را در یک Prisma transaction ایجاد می‌کند: `SalesContract`، `ContractItem`، `DeliveryProduct`، `Payment` و canonical graph؛ سپس quantity evidence را پیش از commit کنترل می‌کند ([contractService.ts](../../backend/src/services/contractService.ts#L674), [contractService.ts](../../backend/src/services/contractService.ts#L756), [contractService.ts](../../backend/src/services/contractService.ts#L795), [contractService.ts](../../backend/src/services/contractService.ts#L853)). این transaction مرز مناسب ایجاد اتمیک پرونده Partner است، اما service ویژه Partner باید aggregate کامل را بسازد؛ دو بار فراخوانی create-contract اتمیک نیست.

Graph persistence مبلغ graph را از `row.commercial.totalAmountToman` جمع می‌زند و همان مقدار را روی `SalesContract.totalAmount` می‌نویسد ([contractProductGraphPersistence.ts](../../backend/src/services/contractProductGraphPersistence.ts#L81), [contractProductGraphPersistence.ts](../../backend/src/services/contractProductGraphPersistence.ts#L181)). پس graph فعلی ذاتاً فقط یک حقیقت مالی را مالک است و نمی‌تواند هم‌زمان مبلغ خرید Partner و مبلغ فروش مشتری را نمایندگی کند.

### ۳. Quantity و Delivery

در persistence فعلی، `ContractItem` و `DeliveryProduct` هر دو `productRowId` و quantity scale-three دارند، ولی Delivery خود زیر `contractId` قرار می‌گیرد ([schema.prisma](../../backend/prisma/schema.prisma#L2259), [schema.prisma](../../backend/prisma/schema.prisma#L2291)). ADR-0013 نیز target canonical هر تخصیص تحویل را `productRowId` می‌داند و index/catalog equality را برای تشخیص row رد می‌کند ([ADR-0013](../adr/0013-stable-delivery-product-row-identity.md)).

کمیت حسابداری برای optimizer row از graph، snapshot محصول، relational item و Delivery witnesses با policy نسخه‌دار reconcile می‌شود؛ raw zero فقط sentinel است و معادل صفر تجاری نیست ([accountingService.ts](../../backend/src/services/accountingService.ts#L842), [ADR-0042](../adr/0042-seal-optimizer-derived-longitudinal-quantity-from-agreeing-witnesses.md), [ADR-0045](../adr/0045-version-commercial-quantity-precision-and-automate-evidence-recovery.md)). در نتیجه دو سند Partner باید دقیقاً یک quantity evidence lineage داشته باشند؛ clone کردن witnessها به دو contract مجاز نیست.

یک شکاف production مهم وجود دارد: Delivery UI مرجع پایدار را reconcile می‌کند، اما print و Logistics هنوز در بعضی مسیرها به index یا `productId` fallback می‌کنند ([deliveryScheduleController.ts](../../frontend/src/features/contract-creation/utils/deliveryScheduleController.ts#L92), [printTemplate.ts](../../backend/src/utils/printTemplate.ts#L1097), [logistics.ts](../../backend/src/routes/logistics.ts#L154)). در Logistics، مانده از `ContractItem`های contract محاسبه و به `contractItemId` منتسب می‌شود ([logistics.ts](../../backend/src/routes/logistics.ts#L284)). بنابراین اگر هر دو سند ContractItem داشته باشند، هر دو به‌عنوان تعهد قابل بارگیری دیده می‌شوند.

### ۴. Pricing snapshot و Accounting approval

Accounting invoice candidate امروز مستقیماً از `SalesContract` ساخته می‌شود؛ `contractId`، `customerId`، amount و snapshot همان contract را می‌گیرد ([accountingService.ts](../../backend/src/services/accountingService.ts#L1435)). Snapshot، customer محدودشده و تمام items/deliveries/payments/commercial evidence را فریز می‌کند ([contractSnapshotBoundary.ts](../../backend/src/services/contractSnapshotBoundary.ts#L104)).

هنگام approval، مبلغ draft با مبلغ net قرارداد و gross ردیف‌ها reconcile می‌شود؛ سپس invoice قفل، شماره‌گذاری و financially approved می‌گردد و approved-pricing seal ساخته می‌شود ([accountingService.ts](../../backend/src/services/accountingService.ts#L1655), [accountingService.ts](../../backend/src/services/accountingService.ts#L1778)). Seal به graph revision/hash، `contractItemId`, `productRowId`, quantity، pricing components، discount و invoice snapshot متصل و immutable است ([approvedPricing/domain.ts](../../backend/src/services/approvedPricing/domain.ts#L470), [approvedPricing/domain.ts](../../backend/src/services/approvedPricing/domain.ts#L687), [schema.prisma](../../backend/prisma/schema.prisma#L2993)).

این approved pricing، **تأیید مالی پس از قرارداد** است و نباید با «استعلام قیمت ۴۸ساعته پیش از قرارداد» reuse یا نام‌گذاری مشترک شود. استعلام expiration و پاسخ‌دهنده دارد؛ approved-pricing seal تاریخ مالی قطعی و مبنای Logistics/Accounting است.

## بازتولیدهای قطعی

در worktree مستقل، `npm run test:contract-product-graph` پس از نصب dependency همان package اجرا شد و تمام suiteهای canonical decimal، command، packing/pricing، longitudinal، operations، remainder، stair، stair-layer، slab، legacy migration و projections پاس شدند.

سناریوهای production-function که در این اجرا پوشش داده شدند:

- add/replace row با revision و hash؛
- اضافه‌کردن source و remainder child، replay موفق پس از ویرایش سازگار، و رد کامل ویرایش ناسازگار بدون تغییر graph؛
- جلوگیری از حذف source دارای child؛
- projection یک graph یکسان برای step5/PDF/Accounting/Workshop/Delivery/Logistics؛
- صفرماندن material charge برای remaining stone قبلاً پرداخت‌شده و حفظ cutting/add-on charge.

تست‌ها فقط evidence اجرای فعلی‌اند؛ invariantهای بالا از production code و ADRها استخراج شده‌اند، نه از fixtureها.

## مدل داده پیشنهادی

### Aggregate و مالکیت حقیقت

```text
PartnerSaleCase
  ├─ one ProductGraph revision lineage
  ├─ canonical CaseProductRow[] (physical/configuration/quantity truth)
  ├─ PartnerSupplyDocument (Sabalan → PartnerBusinessAccount)
  │    └─ immutable SupplyPriceVersion/Row[]
  └─ PartnerCustomerContract (Partner → owned EndCustomer)
       └─ immutable RetailPriceVersion/Row[]

CaseProductRow
  ├─ QuoteLineSnapshot (approved, configurationHash, approvedAt, expiresAt)
  ├─ DeliverySchedule/DeliveryProduct
  └─ ContractedQuantityVersion → Logistics/Shipment evidence
```

مالک canonical هر fact:

| Fact | مالک واحد |
|---|---|
| نوع، ابعاد، فرآوری، ابزار، source/remainder/layer relation | Product Graph پرونده |
| quantity/unit و delivery allocation | CaseProductRow + quantity version |
| قیمت سبلان، مبنای قیمت و استعلام مصرف‌شده | SupplyPriceVersionRow |
| قیمت آزاد مشتری و تخفیف مشتری | RetailPriceVersionRow |
| بدهی/وصول سبلان | Supply document + Accounting record |
| وصول مشتری از Partner | customer-contract payment plan؛ خارج از Accounting سبلان |
| اختلاف/سود Partner | projection مشتق‌شده از دو price version؛ نه ledger درآمد سبلان |

### fingerprint استعلام

هر Quote Line باید `configurationHash` از canonical seller intent و policy snapshot داشته باشد: catalog snapshot، نوع، ابعاد و unit، quantity basis، cutting/mandatory، operation groups، ابزار، پرداخت، layer/remainder source rule و هر جزء مؤثر بر قیمت. `productRowId` هویت داخل پرونده است، اما به‌تنهایی برای reuse استعلام میان پرونده‌ها کافی نیست؛ `configurationHash` برابری پیکربندی را ثابت می‌کند.

در transaction ثبت نهایی:

1. Partner فعال، مالکیت customer و پاسخ‌دهنده رسمی بررسی شود.
2. برای هر row یک Quote Line تأییدشده با hash برابر و `expiresAt > serverNow` قفل و بررسی شود.
3. Product Graph و quantity version یک بار ساخته شوند.
4. Supply price از Quote Line snapshot شود؛ Retail price با همان row id و مقدار مستقل ذخیره شود.
5. دو سند و شماره‌هایشان، delivery/payment projections و audit در یک transaction commit شوند.
6. هیچ consumption counter برای Quote ساخته نشود؛ reuse تا انقضا آزاد است.

انقضای بعد از commit فقط Quote را برای پرونده جدید نامعتبر می‌کند و snapshot Supply را تغییر نمی‌دهد.

### سازگاری با Accounting، Delivery و خروجی

- Accounting eligibility باید روی `documentKind = PARTNER_SUPPLY` fail-closed باشد. `PARTNER_CUSTOMER` هرگز invoice candidate سبلان نسازد و `customerId` مشتری نهایی را بدهکار سبلان نکند.
- فقط Case/Supply rows وارد ContractItem/Shipment lineage شوند. قرارداد مشتری reference/read model همان rows را دارد، نه ContractItem دوم.
- Delivery یک owner دارد و customer contract فقط همان برنامه را برای نمایش projection می‌کند.
- PDF/SMS/public confirmation از DTO اختصاصی customer ساخته شود که فقط Retail price و هویت Partner دارد. ارسال raw case، graph یا Supply price به frontend عمومی ممنوع است.
- template بصری فعلی قابل reuse است، اما normalization باید ورودی typed و audience-safe بگیرد. projection کنونی کافی نیست، چون base/total را برای همه audienceها برمی‌گرداند.
- پس از قطعی‌شدن، تغییر فقط retail price/payment یک RetailPriceVersion جدید می‌سازد؛ تغییر product/quantity/delivery یک case revision مشترک، استعلام تازه و قواعد correction رسمی می‌خواهد.

## یافته‌های ریسک‌دار و ترتیب اصلاح

1. **بحرانی — دوبرابرشدن تعهد فیزیکی:** ساخت دو `SalesContract` کامل، دو مجموعه ContractItem و دو مانده Logistics می‌سازد. مرز repair: ابتدا case-owned row/quantity/delivery و accounting eligibility را تعریف کنید.
2. **بحرانی — بدهکار اشتباه:** Accounting اکنون `customerId` را مستقیم از contract می‌گیرد. مرز repair: Supply document باید party type و PartnerBusinessAccount صریح داشته باشد؛ customer contract باید برای Accounting سبلان ineligible باشد.
3. **بالا — افشای قیمت خرید:** projection عمومی همچنان base/total graph را حمل می‌کند و print از `contractData` کامل می‌خواند. مرز repair: دو price ledger و serializer allowlistشده برای customer/public.
4. **بالا — واگرایی row identity:** print/Logistics fallbackهای index/catalog دارند. مرز repair: قبل از rollout Partner، consumerهای جدید فقط stable row identity را بپذیرند؛ fallback فقط legacy-read کنترل‌شده بماند.
5. **بالا — یک total برای دو معامله:** graph persistence مبلغ graph را روی contract total می‌نویسد. مرز repair: case graph از price versions جدا شود و هر document total از ledger خودش مشتق گردد.
6. **متوسط — اشتباه مفهومی دو approval:** Quote approval و Accounting approved-pricing lifecycle متفاوت دارند. مرز repair: نام‌ها، schemaها، permissionها و audit eventهای جدا.

## مرز implementation پیشنهادی

ترتیب کم‌ریسک:

1. ADR برای «یک Product/Quantity aggregate، دو سند مالی و یک fulfillment lineage».
2. schema additive برای Case، document links، Quote/QuoteLine، Supply/Retail price versions و business-account party.
3. service اتمیک `createPartnerSaleCase` با row lock روی Quote Line و idempotency key؛ بدون استفاده از دو endpoint create-contract.
4. Accounting eligibility و receivable party برای Supply document.
5. Delivery/Logistics فقط روی case row؛ حذف fallback از مسیر Partner.
6. customer/public/PDF DTO مستقل و تست عدم افشای Supply price.
7. correction/versioning و سپس report projection سود Partner.
8. rollout فقط برای Partnerهای فعال؛ contractهای عادی و تاریخی بدون migration معنایی باقی بمانند.

## تصمیم‌های حل‌نشده فنی

این پژوهش تصمیم دامنه‌ای تازه‌ای لازم نمی‌بیند، اما specification پیاده‌سازی باید سه قرارداد فنی را صریح کند:

- Quote price «نرخ واحد» است یا «all-in line amount»؛ پیشنهاد: هر دو basis و quantity/unit snapshot شوند تا ابهام محاسباتی وجود نداشته باشد.
- Product Graph فعلی price-bearing است؛ پیشنهاد: برای Partner یک case aggregate additive با configuration/quantity graph و price-versionهای جدا بسازید، سپس در آینده seam مشترک graph را عمیق‌تر کنید. تغییر سراسری graph قراردادهای عادی در اولین نسخه پرریسک است.
- قرارداد مشتری از نظر schema یک `SalesContract` با `documentKind` جدید باشد یا document projection جدا؛ پیشنهاد: اگر reuse PDF/SMS نیاز به SalesContract دارد، آن record نباید ContractItem/Delivery/Accounting ownership داشته باشد و باید فقط به case rows reference دهد.

## معیارهای پذیرش ضروری

- یک تغییر row در هر دو سند دقیقاً همان `caseProductRowId` و quantity version را نشان دهد.
- هیچ row یا مقدار در customer contract نتواند مستقل از Supply/case تغییر کند.
- دو سند فقط یک مانده Logistics تولید کنند.
- Accounting فقط PartnerBusinessAccount و Supply amount را ببیند.
- public/SMS/PDF در payload و UI هیچ Supply price، margin یا سند داخلی نداشته باشد.
- Quote منقضی در commit fail شود؛ Quote معتبر snapshot شود و پس از commit با انقضا تغییر نکند.
- Retail زیر Supply فقط warning بدهد و ثبت را مسدود نکند.
- failure در هر مرحله transaction هیچ case یا سند نیمه‌کاره باقی نگذارد.
- concurrency دو submit با idempotency key فقط یک پرونده و یک جفت سند بسازد.
