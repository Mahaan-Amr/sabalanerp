# Sabalan ERP

Sabalan ERP manages stone inventory, sales contracts, and related pricing data for Sabalan Stone. This glossary defines project-specific business terms so the product and code use the same language.

**Product Search**:
A product lookup in the price inquiry surface that matches product identity and price-facing product details, regardless of Persian or Arabic character variants.
_Avoid_: treating search as only an exact prefix lookup

**خروجی/ورودی اکسل کاتالوگ**:
A catalog maintenance workflow where each catalog exports, imports, and updates its own records through an Excel file shaped for that catalog's business fields.
_Avoid_: mixing unrelated product, service, tool, stair, layer, and finishing catalogs into one shared Excel file

**قالب اکسل اختصاصی کاتالوگ**:
An Excel format dedicated to one catalog type and based on the fields that catalog already uses in Sabalan ERP.
_Avoid_: reusing an OPC product or service-code workbook for unrelated inventory service catalogs

**کد پایدار کاتالوگ**:
A business identifier used by catalog Excel sync to recognize the same catalog record across imports, even when display names or descriptions change.
_Avoid_: using editable display names as identity when a catalog can be renamed

**ستون‌های مالک اکسل**:
The catalog fields that a specific Excel template is allowed to create or update during import; fields outside that template remain owned by the application or manual editing.
_Avoid_: treating every import as a full replacement of the catalog record

**همگام‌سازی کامل کاتالوگ با اکسل**:
A catalog import mode where the Excel file is the current source of truth for that catalog: rows in the file are created or updated, and existing catalog records missing from the file are removed from active use.
_Avoid_: assuming a full catalog sync is only an additive import

**پیش‌نمایش حذف کاتالوگ**:
A required confirmation step before a full Excel catalog sync removes missing records, showing users which records will be deleted or deactivated before changes are applied.
_Avoid_: silently removing catalog records during import

**خوراک اره**:
A per-contract-product material-consumption adjustment for physical cuttable stone. When enabled, the saved row carries `sawKerfEnabled: true` and `sawKerfCm: 0.3`; each actually cut axis consumes the finished requested dimension plus 3mm for source-material charge, smart packing, and remaining-stone geometry. Finished dimensions, delivery, standalone services, tools, and finishing calculations stay based on the customer-requested size.
_Avoid_: applying kerf to service rows, applying it to a full-width/full-length axis with no cut, or changing printed finished dimensions.

**برش قائم اسلب**:
A paid edge-preparation cut applied to selected sides of each standard/source slab before the slab is cut to the customer's requested finished dimensions.
_Avoid_: charging برش قائم from the finished requested piece dimensions, or applying it to unselected slab sides.

**جزئیات برش اسلب**:
The per-source-slab cutting detail rows for a slab contract product, separated by standard/source dimensions and cut type so accounting and workshop output can see which source slab produced each cutting charge.
_Avoid_: summarizing slab cutting details so early that different source slab sizes or cut types become indistinguishable.

## Language

**فروش همکاری**:
A sales contract kind for selling products or services to a collaborative individual or group, reusing contract pricing and payment behavior while not requiring a normal project/address selection.
_Avoid_: treating it as a normal customer contract with an empty project

**ورود فروش همکاری**:
A dedicated contract-creation entry path that opens the shared sales contract wizard in collaboration mode. The mode is chosen before the wizard starts rather than switched inside a normal contract draft.
_Avoid_: adding a normal-vs-collaboration choice as a required step in every contract

**مشتری همکاری**:
A CRM customer whose relationship to a sales contract is collaborative rather than a normal project customer. A مشتری همکاری can be selected for فروش همکاری without requiring project-address selection.
_Avoid_: creating a separate non-CRM buyer record for collaborators

**معرف مشتری**:
A person who referred or introduced a CRM customer. The referrer belongs to the customer profile, not to one specific project address or contract.
_Avoid_: storing the same referrer separately on every project address

**بازاریاب پروژه**:
The marketer associated with a specific project address for a customer. Different project addresses for the same customer may have different marketers.
_Avoid_: treating the project marketer as a customer-wide referrer or as the project manager

**ردیف خدمات قرارداد**:
A standalone price-bearing contract row for services such as ابزار, برش, پرداخت سنگ, or فرآوری when no stone product is being sold.
_Avoid_: representing a service-only sale as a hidden or fake product

**ردیف کیوبیک و قطعات آماده قرارداد**:
A price-bearing contract product row for cubic stone or ready-made stone pieces selected from the product catalog and sold by the row's chosen unit, such as متر مربع, تن, or تعداد. The row carries a subtype of کیوبیک or قطعات آماده while remaining one product-row family in contract selection, delivery, payment, and output.
_Avoid_: modeling کیوبیک and قطعات آماده as unrelated contract product families, or forcing them through طولی, پله, or اسلب configuration

**زیرنوع ردیف کیوبیک و قطعات آماده**:
The per-contract-row classification that says whether a prepared-product row is کیوبیک or قطعات آماده. It may be inferred from the catalog product's cutting-dimension label when selected, but the saved contract row remains explicit so old contracts do not depend on later catalog wording.
_Avoid_: relying only on a product name search term to decide how a saved contract row behaves

**قیمت واحد ردیف کیوبیک و قطعات آماده**:
The contract-row price for the selected unit of a کیوبیک و قطعات آماده row. The catalog product's base price may prefill it, but the saved contract row owns the selected unit, quantity, unit price, and total price snapshot.
_Avoid_: recalculating an old prepared-product row from later catalog prices, or assuming one catalog price always means متر مربع

**مقدار زمان‌بندی کیوبیک و قطعات آماده**:
The amount of a کیوبیک و قطعات آماده row assigned to delivery dates, using the same unit and total quantity selected on that contract row.
_Avoid_: scheduling a ton-based or count-based prepared-product row as متر مربع, or allowing scheduled amounts to exceed the selected row quantity

**مرز ردیف کیوبیک و قطعات آماده**:
کیوبیک و قطعات آماده rows are main catalog stone product rows for pricing, delivery, discount, and output, but they are not cutting-workflow rows.
_Avoid_: applying smart cutting, saw kerf, remaining-stone usage, stair grouping, slab cutting modes, tools, or stone finishing to prepared-product rows

**خروجی ردیف کیوبیک و قطعات آماده**:
کیوبیک و قطعات آماده rows appear in the main customer-facing product table with their product name, subtype, selected unit, quantity, unit price, total price, and row note when present.
_Avoid_: hiding prepared-product rows in a separate shadow section, or printing row images in PDF/print output

**تکثیر ردیف کیوبیک و قطعات آماده**:
Creating a new editable کیوبیک و قطعات آماده row from an existing row by copying its catalog product, subtype, selected unit, quantity, unit price, total price snapshot, note, and internal row images while giving it independent row identity.
_Avoid_: copying delivery assignments, internal row IDs, or links that make the duplicate depend on the original row

**منبع خدمات قرارداد**:
The catalog a standalone service row is selected from, such as ابزار, برش, or پرداخت سنگ. These catalogs remain separate for management and search, but once selected they become the same ردیف خدمات قرارداد shape for pricing, payment, and print output.
_Avoid_: merging the source catalogs just because contract rows share one shape

**توضیحات ردیف خدمات قرارداد**:
A per-contract note attached to a selected standalone service row, prefilled from the catalog description when available but editable without changing the catalog.
_Avoid_: editing the catalog service description when the user only means the current contract row

**جستجوی عددی محصول**:
A product catalog search that treats Persian, Arabic, and Latin digits as the same value when matching numeric product details such as عرض, ضخامت, کد, and قیمت.
_Avoid_: making users switch keyboard language to find numeric product values

**سنگ مصرفی**:
An informational customer-facing row that shows the full base stone consumed to create a sold cut product. It explains material usage and dimensions but is not a second charged product row.
_Avoid_: adding سنگ مصرفی to contract totals, delivery quantities, or inventory as a separate sale row

**قیمت ردیف‌های توضیحی قرارداد**:
Informational contract output rows such as سنگ مصرفی stay visible for clarity but do not show نرخ or مبلغ کل because they are not price-bearing invoice rows.
_Avoid_: showing prices on explanatory rows, or making visible مبلغ کل values fail to reconcile with جمع کل فاکتور

**قیمت صفر در خروجی قرارداد**:
A zero price is printed as ۰ تومان only for a real price-bearing contract row that participates in invoice calculation with a zero amount.
_Avoid_: using a blank price for zero-charged invoice work, or using ۰ تومان for non-price explanatory rows

**واحد پول در جدول اصلی محصولات**:
Normal price cells in نرخ - تومان and مبلغ کل - تومان show numeric تومان values without repeating تومان in every row. The ریال equivalent is shown only on the final جمع کل فاکتور row, as secondary text beside or under the تومان total.
_Avoid_: repeating تومان inside every normal price cell, showing ریال equivalents on every product/payment row, or hiding ریال from the final invoice total

**تقسیم طول در برش هوشمند طولی**:
در برش هوشمند سنگ طولی، طول درخواستی مشتری می‌تواند به عنوان تقاضای کل فهمیده شود و سیستم آن را با چند قطعه فیزیکی کوتاه‌تر از همان عرض تأمین کند، به شرطی که نتیجه قراردادی همان متراژ و عرض درخواستی باقی بماند.
_Avoid_: نمایش قطعات فیزیکی کوتاه‌تر به عنوان تغییر در سفارش مشتری، یا تقسیم طول در حالتی که کاربر صریحاً قطعه یکپارچه می‌خواهد

**باقی‌مانده برش هوشمند طولی**:
باقی‌مانده سنگ طولی بر اساس بخش فیزیکی سنگ مصرف‌شده در برش هوشمند محاسبه می‌شود، نه بر اساس طول نمایشی سفارش مشتری. اگر تقاضای `18m × 20cm` از سنگ `40cm` با دو نوار فیزیکی `9m × 20cm` تأمین شود، بخش مصرفی `40cm × 9m` است و باقی‌مانده‌ای از همان برش ساخته نمی‌شود.
_Avoid_: ساختن باقی‌مانده `18m × 20cm` وقتی تقاضا با دو نوار فیزیکی کوتاه‌تر کامل شده است

**عرض درخواستی ردیف قرارداد**:
The customer-requested finished width of a contract product row, shown when delivery scheduling needs to distinguish the requested piece from the source stone consumed to make it.
_Avoid_: using this value as the source-material width when the row is cut from a wider stone

**عرض مصرفی ردیف قرارداد**:
The width of the source stone consumed to create a contract product row. It explains material usage and should align with سنگ مصرفی rather than replacing the customer-requested width.
_Avoid_: treating عرض مصرفی as the finished customer-requested width

**ردیف زمان‌بندی تحویل/اجرا**:
A contract row that can be assigned to the delivery schedule because it represents either a physical stone product to deliver or a standalone service row to execute for the customer.
_Avoid_: representing service execution as a fake stone product, or assuming every scheduled row is physical inventory

**مقدار زمان‌بندی خدمات قرارداد**:
The amount of a standalone service row assigned to delivery/execution dates, using the same unit and total quantity as the selected service row.
_Avoid_: scheduling a service in a different unit than its contract row, or allowing scheduled service amounts to exceed the selected service quantity

**ابزار**:
A paid stone edge operation applied during contract pricing, calculated by length or square meter depending on the item.
_Avoid_: ساب as a category, sub-service, tool, پرداخت سنگ

**لبه‌های ابزار در خروجی قرارداد**:
When an ابزار is applied to selected product edges, the chosen edges are part of the contract product detail and should be visible anywhere the contract product details are printed or exported, including customer-facing contracts, accounting copies, and workshop copies. محیط کامل means all relevant edges for that product part; otherwise the exact selected edges such as جلو، عقب، چپ، and راست should be shown with the ابزار name.
Each selected edge operation should appear once per contract product detail, even if older saved snapshots contain the same ابزار in more than one technical source.
_Avoid_: printing only the ابزار name or price when the selected edges explain what work was ordered, or printing the same ابزار-edge combination twice from duplicate saved sources

**پرداخت سنگ**:
A stone finishing or treatment option applied during contract pricing, separate from ابزار, calculated by متر طول or متر مربع depending on the item.
_Avoid_: ابزار, خدمات, فرآوری سنگ

**کد فرآوری سنگ**:
The stable catalog code for a پرداخت سنگ / فرآوری سنگ record. Catalog managers provide it during manual create/edit and Excel sync uses it as the record identity, while historical records may still carry generated fallback codes.
_Avoid_: using the display name as the stable identity for پرداخت سنگ, hiding the code from catalog management, or rewriting historical generated codes during unrelated print changes

**فعال‌سازی پرداخت سنگ**:
فعال‌سازی پرداخت سنگ فقط بخش انتخاب پرداخت را برای همان ردیف قرارداد باز می‌کند و تا وقتی کاربر یک پرداخت مشخص را انتخاب نکند، هیچ آیتم کاتالوگ، قیمت، مقدار یا هزینه‌ای به ردیف اضافه نمی‌شود.
_Avoid_: انتخاب خودکار اولین پرداخت سنگ کاتالوگ پس از فعال‌سازی

**متر طول**:
The canonical unit label for length-based پرداخت سنگ pricing.
_Avoid_: متر when it can be confused with متر مربع

**ساب**:
A specific kind of ابزار, not a separate top-level category.
_Avoid_: using ساب‌ها to mean all ابزارها

**خدمات**:
A non-tool service offered by the business. خدمات is separate from ابزار and should not be used for contract edge or finishing operations.
_Avoid_: using خدمات as a catch-all for ابزار

**جزئیات محصول قرارداد**:
The price-bearing details attached to a contract product for customer-facing contract output, including cuts, services, tools, and stone finishing when they exist.
_Avoid_: printing empty detail groups or using خدمات as the umbrella label for every add-on

**تصویر کاتالوگ**:
An image attached to a product, tool, cutting, finishing, or standalone service catalog item so future contracts can reuse the same visual reference.
_Avoid_: treating catalog images as immutable evidence of what a past contract meant

**تصویر ردیف قرارداد**:
An internal image snapshot attached to a selected contract row so other workspaces can see the exact product or service reference intended for that contract, even if the catalog image changes later. A new row starts with the catalog image URLs and can then be changed independently for that contract.
_Avoid_: relying only on the current catalog image for saved contract interpretation, or showing row images in customer-facing PDF/print output unless explicitly requested

**توضیحات سنگ پله**:
The per-part note attached to a stair contract product row, such as کف پله, خیز, or پاگرد. Each selected stair part carries its own توضیحات so contract output can show the note beside the exact row it describes.
_Avoid_: using one shared stair-system note for all stair parts

**ردیف‌های هم‌نوع سنگ پله**:
A stair contract may contain multiple independent rows of the same stair part type, such as several کف پله rows or several خیز rows, within the same stair session or contract.
_Avoid_: treating stairPartType as a unique key, or overwriting an existing stair part row only because a new row has the same part type

**ویرایش ردیف سنگ پله**:
Editing from the contract list opens the clicked stair product row as an individual row edit, preserving its exact stair part type and details without loading sibling rows from the same stair system.
_Avoid_: opening کف پله when the clicked row is خیز پله, or rebuilding every row that shares the same stairSystemId when the user edits one row

**لبه‌های ابزار پله**:
For stair product tools on کف پله, خیز پله, and پاگرد, جلو and عقب are the long horizontal span of the stair part, while چپ and راست are the short side edges based on the stair part's عرض/depth. The stair UI's طول field is the main horizontal span used by جلو and عقب.
_Avoid_: calculating جلو from عرض/depth, or calculating چپ and راست from the main طول span

**مرز برش و ابزار پله**:
Geometry-driven stair cuts such as برش طولی and برش عرضی are برش rows, not ابزار rows. ابزار is reserved for user-selected edge operations such as نیم لول.
_Avoid_: storing or printing automatic stair cuts as ابزار, automatically selecting a cutting catalog item as an ابزار, filtering real user-selected ابزار only because its name contains برش, or showing the same physical cut once as برش and again as ابزار

**کل دور ابزار پله**:
For stair product tools, کل دور means all four stair-part edges: جلو، عقب، چپ، and راست.
_Avoid_: treating کل دور as only three edges, or excluding عقب from the perimeter

**بازمحاسبه ابزار پله**:
Existing saved or printed contracts keep their saved stair tool totals until the contract is opened for editing and saved again. New contracts and edited-resaved contracts calculate stair tool edges using the current لبه‌های ابزار پله rules.
_Avoid_: silently changing historical contract totals without an edit/save action

**مصرف باقی‌مانده برای سنگ لایه**:
When سنگ لایه uses سنگ اصلی, compatible remaining pieces from the same stair part are consumed before charging any additional سنگ اصلی. Only the layer demand that cannot be supplied from those remaining pieces should count as new main-stone material.
_Avoid_: charging all same-stone لایه as fresh stone while usable same-part remaining pieces exist

**تعداد پارتیشن باقی‌مانده**:
The number of child pieces cut from the selected remaining stone geometry. It is validated by whether those pieces fit inside the remaining stone area, not by requiring one source remaining stone per child piece.
_Avoid_: treating partition quantity as the count of source remaining stones consumed

**تقسیم ظرفیت باقی‌مانده**:
A remaining-stone demand may be fulfilled by multiple physical pieces from the same remaining stone when the requested width fits the source width and the total requested area fits the available capacity.
_Avoid_: rejecting a demand only because its logical length is longer than one source piece when it can be split into valid physical pieces

**وضعیت هنگام چاپ**:
The contract status shown on customer-facing printed or PDF contract output at the moment the document is generated.
_Avoid_: labeling printed status as the general contract status when the timing matters

**شماره تماس فروشنده**:
The seller phone number printed on customer-facing contracts, taken from the contract creator's personal profile phone when available.
_Avoid_: using the current printer's phone or a later approver's phone

**جدول اصلی محصولات**:
The customer-facing contract table that lists product rows and their price-bearing product details as flat invoice rows.
_Avoid_: rendering nested product detail blocks outside the main product table

**ستون‌های مقداردهی جدول اصلی محصولات**:
The customer-facing product table separates physical length, physical width, invoice-pricing measurement, and meaningful count into distinct columns. The متراژ/مقدار column shows the pricing basis for that row, such as متر مربع for stone, متر طول for tools and cuts, or عدد for count-priced services. The تعداد column is filled only when a separate count helps explain the row.
The same structural columns are used in original, accounting, and workshop prints, but workshop removes price columns entirely instead of showing empty price cells.
طول and عرض values in print/PDF output are always normalized to meters and shown as numbers only; the unit belongs in the column header, such as طول - متر and عرض - متر. Centimeter-saved values are converted to meters before printing.
_Avoid_: combining طول and عرض into one ابعاد column, repeating one value across متراژ/مقدار and تعداد, putting count in متراژ/مقدار when the pricing basis is another measurement, reintroducing price columns in workshop print, or mixing cm and m labels inside length/width cells

**حکمی**:
An explicit percentage-based price increase applied to a contract product when the product is marked as mandatory.
_Avoid_: printing or charging حکمی from a default percentage when the product is not explicitly marked mandatory

**تخفیف قرارداد**:
A percentage reduction applied only to the sum of base stone product subtotals in a sales contract, including کیوبیک و قطعات آماده rows when they are sold as main catalog stone products, before payments are compared to the payable total. It does not reduce ابزار, لایه، پرداخت سنگ, cutting, standalone service rows, or حکمی add-on amounts.
_Avoid_: applying تخفیف to the full contract total including add-ons, or selecting discount limits per individual product row

**خروجی تخفیف قرارداد**:
The saved contract discount snapshot shown in PDF and print output, including the applied percentage and amount. Existing contracts keep their saved discount details even when discount ranges change later.
_Avoid_: recalculating old contract discounts from current بازه تخفیف rules

**بازه تخفیف**:
A manager-defined تومان range over the contract base stone subtotal that caps the allowed تخفیف قرارداد percentage. Ranges are non-overlapping, include their lower bound, exclude their upper bound, and allow no discount when no range matches.
_Avoid_: overlapping ranges or fallback discount caps when no range matches

**سقف تخفیف**:
The maximum تخفیف قرارداد percentage configured by managers or admins for a matching بازه تخفیف. Sales users may apply a discount up to this cap during contract creation.
_Avoid_: requiring manager approval for every discount that is already within the configured cap

**تاریخ تحویل چاپی**:
The delivery date shown on printed or PDF contracts, normalized to Persian calendar `YYYY/MM/DD` when valid.
_Avoid_: passing through malformed or partially converted date strings

**وضعیت تایید دیجیتال**:
The customer-facing confirmation state shown after OTP verification. Once verified, it should read as a completed state such as `تایید شده در تاریخ ...`, not as a duplicate-action warning.
_Avoid_: wording like `قرارداد قبلا تایید شده است` when the customer has successfully reached the final confirmation state

**BI فروش**:
A native business-intelligence workspace for analyzing sales-contract performance from sales-owned data such as contracts, payments, customers, products, delivery status, discounts, and seller performance.
_Avoid_: treating it as an embedded external BI tool or as a company-wide analytics workspace

**فروش قطعی در BI فروش**:
The sales value counted as realized sales in BI, limited to sales contracts whose status is `SIGNED` or `PRINTED`.
_Avoid_: counting draft, pending, approved, cancelled, or expired contracts as realized sales

**پایپ‌لاین فروش در BI فروش**:
The sales value still in progress in BI, limited to sales contracts whose status is `PENDING_APPROVAL` or `APPROVED`.
_Avoid_: mixing pipeline value with realized sales

**فروش ازدست‌رفته در BI فروش**:
The sales value excluded from realized sales because the sales contract is `CANCELLED` or `EXPIRED`.
_Avoid_: hiding cancelled or expired value from management analysis

**تاریخ فروش قطعی در BI فروش**:
The business date used for realized-sales trends, taken from the contract signing time and falling back to contract creation time only for older signed or printed contracts without a signing time.
_Avoid_: using print, payment, or delivery dates to trend realized sales

**تاریخ پایپ‌لاین در BI فروش**:
The business date used for sales-pipeline trends, taken from the contract creation time.
_Avoid_: using approval time as the only pipeline date

**دامنه داده در BI فروش**:
The set of sales data a BI viewer may analyze: admins see all sales data, managers with BI view access see department-scoped sales data, and managers with BI admin access see all sales data.
_Avoid_: allowing normal users into BI, or treating every manager as automatically company-wide

**مانده قابل دریافت در BI فروش**:
The outstanding amount for realized sales, calculated as realized sales value minus completed payments and paid installments.
_Avoid_: reducing receivables for pending checks, pending installments, cancelled payments, or unsigned pipeline contracts

**پرداخت معوق در BI فروش**:
A due payment or installment on a realized sales contract that is not completed or paid and whose due date is before today.
_Avoid_: treating check handover date as the due date, or counting cancelled payments as overdue

**فروشنده در BI فروش**:
The sales user credited for a v1 BI sales contract, taken from the contract creator user.
_Avoid_: assuming a separate salesperson assignment exists before the contract model stores one

**ریسک تحویل در BI فروش**:
The management view of delivery exposure, grouped into overdue deliveries, deliveries due today or within seven days, delivered rows without customer confirmation, and completed deliveries.
_Avoid_: treating cancelled deliveries as active delivery risk, or replacing the delivery workspace workflow

**خروجی جاری قرارداد**:
The customer-facing contract output in PDF, print, and confirmation views should reflect the current saved contract details, including edited delivery plans and payment plans.
_Avoid_: generating customer-facing output from an older creation snapshot when the contract has since been edited

**قفل حسابداری قرارداد فروش**:
A sales contract becomes immutable for sales edits only after accounting financially approves an accounting financial record for that contract.
_Avoid_: locking sales edits merely because the contract was sales-approved, digitally signed, or printed

**وضعیت حسابداری در فروش**:
Sales users may view the accounting status of a sales contract as read-only accounting information on the sales contract list and detail pages. The status remains owned by accounting and reflects the current accounting workflow state, including whether the contract is eligible for financial action, already has financial records, or needs accounting correction.
_Avoid_: letting sales users edit accounting status, or showing a stale sales-owned copy of the accounting workflow state

**تاریخ فاکتور سیستمی**:
The Sepidar/system invoice date entered by accounting during financial approval. It may be today, up to two days in the past, or up to thirty days in the future.
_Avoid_: treating future system invoice dates as invalid when they are within the accounting forward-entry window

**حذف پیش‌نویس رکورد مالی**:
An accounting financial record may be physically deleted only while it is still a draft and has not been financially approved, while keeping an audit trail of the deletion. Issued, posted, financially approved, or otherwise submitted records are not deleted; they are voided or corrected through accounting workflows.
_Avoid_: deleting financially approved accounting records, or keeping undeletable draft clutter when a new draft should be regenerated

**درخواست اصلاح حسابداری**:
A correction request created by accounting when a sales contract or related draft accounting data needs correction before accounting can clear it. Sales performs contract corrections through the step-based contract edit flow, and accounting keeps the request open until it reviews the corrected contract and resolves the request.
_Avoid_: accounting silently editing the commercial contract, or closing a correction request before accounting has reviewed the corrected contract

**اصلاح حسابداری پس از تایید مالی**:
A correction request after financial approval is an accounting-side tracking and remediation workflow, not permission for sales to edit the locked contract. Fixing it requires accounting void, reversal, or correction handling instead of the normal sales contract edit flow.
_Avoid_: reopening sales edits after financial approval, or treating post-approval correction as the same workflow as pre-approval correction

**تایید مالی با اصلاح باز**:
Accounting financial approval is blocked while a contract has an open or acknowledged pre-approval correction request. Accounting must review and resolve the correction request before financially approving the invoice candidate.
_Avoid_: financially approving and locking a contract while a requested sales correction is still unresolved

**رسیدگی به اصلاح حسابداری**:
After sales edits a contract for a pre-approval correction request, the request remains open until accounting manually reviews the corrected contract and resolves it with an optional resolution note.
_Avoid_: adding a separate handoff status before the workflow needs it, or auto-resolving a correction request merely because the contract was edited

**عملکرد حسابدار**:
An operational accounting metric for how quickly and consistently an accountant performs auditable accounting workflow actions, measured from accounting records and audit events rather than browser presence.
_Avoid_: treating accountant performance as hidden activity tracking, keystroke monitoring, or time spent with a page open

**ویرایش مرحله‌ای قرارداد فروش**:
Editing a sales contract uses the same step-based contract workflow as creation, with prefilled saved contract details and direct access to any step that may need correction.
_Avoid_: a separate simplified edit form, or forcing linear navigation during edit

**اعتبارسنجی ویرایش قرارداد فروش**:
During sales contract editing, users may jump directly to any step, but saving changes requires the complete contract to be valid; validation should point the user to the first invalid step.
_Avoid_: blocking step jumps in edit mode, or saving partially invalid edited contracts

**اتمام ایجاد قرارداد فروش**:
After a new sales contract has been saved and the workflow reaches the digital confirmation step, the primary completion action means leaving the completed creation flow and returning to the sales contracts list.
_Avoid_: showing ثبت قرارداد again after the contract has already been created, or creating a duplicate contract when the user only wants to leave the completed workflow

**پیش‌نویس بازیابی قرارداد فروش**:
During contract creation, in-progress wizard data is a recoverable local draft for the same browser and device. It should survive accidental reloads, browser closes, and short screen sleeps until the contract is successfully submitted or the user discards the draft.
_Avoid_: expiring meaningful in-progress contract creation data after only a few minutes, requiring users to rebuild large contracts after accidental navigation, or treating local recovery as a cross-device draft-management feature

**لیست ردیف‌های انتخاب‌شده قرارداد**:
During contract creation, the selected product and service rows are a scalable review surface for the contract being assembled. On desktop, large contracts should be reviewed as compact rows with key pricing and quantity fields first, while rich details such as remaining stones, layers, images, notes, and cutting summaries stay available on demand.
_Avoid_: forcing every selected row to appear as a full detail card when the contract contains many rows

**ویرایش جزئیات محصول قرارداد**:
Editing a saved contract product should preserve previously selected ابزار and پرداخت سنگ details from the contract snapshot, even when the current catalog record is missing or inactive. Saved labels, units, prices, and amounts should remain visible instead of being silently dropped.
_Avoid_: resetting selected contract product details only because catalog lookup fails

**تکثیر ردیف محصول قرارداد**:
Creating a new editable contract product row from an existing row by copying its product selection, dimensions, quantities, pricing, mandatory settings, cutting details, tools, finishing, notes, images, and remaining-stone usage settings while giving it independent row identity.
_Avoid_: copying delivery assignments, stair-system grouping, parent-child indexes, or other links that make the duplicate depend on the original row

**تکثیر ردیف خدمات قرارداد**:
Creating a new editable standalone service row by copying its catalog source, quantity, unit price, note, and row images while giving it independent scheduling and row identity.
_Avoid_: copying delivery/execution assignments from the original service row

**نام نمایشی سنگ پله**:
Stair contract product rows use the same compact stone identity style as longitudinal product rows, while stair part, layer, dimensions, and other stair-specific details remain separate row details.
_Avoid_: saving or printing the full catalog product name as the stair product row name

**برچسب نوع ردیف سنگ پله**:
Customer-facing contract lists and printed output label stair product rows by their specific part type: کف پله، خیز پله، or پاگرد.
_Avoid_: showing only the generic سنگ پله label when the row's stair part type is known, or using قائمه instead of خیز پله for riser rows

**نام نمایشی سنگ اسلب**:
Slab contract product rows preserve the full catalog stone identity as the row name, including cut type, material, dimensions, mine, finish, color, and quality. Requested slab dimensions, source slab dimensions, cutting details, and finishing details remain separate row details.
_Avoid_: replacing the slab row name with only a short material/category label such as اسلب - مرمریت, or hiding catalog identity differences inside cutting details

**شماره چک ناقص**:
A check payment saved during sales contract creation without a check number. It remains valid for contract creation and output, while preserving the missing value for later accounting follow-up.
_Avoid_: blocking contract creation only because a check number is empty

**پرداخت مازاد قرارداد**:
A sales contract may receive real payments whose combined amount is greater than the payable contract amount. The contract remains invalid when the combined payment and accepted credit amount is lower than the payable contract amount, but extra real payment may be accepted. The extra amount is calculated from the payment/credit total minus the payable contract amount, must carry a selected explanation, and currently prints as به علت بدهی از قبل rather than as مازاد پرداخت مشتری.
_Avoid_: forcing payment rows to equal the payable contract amount exactly, treating a lower-than-payable payment plan as acceptable, manually typing the extra amount when it can be calculated, or labeling the printed reason as مازاد پرداخت مشتری

**استفاده از باقی مانده مشتری**:
A manually entered payment-plan method that applies a claimed pre-existing customer credit or balance to a sales contract until the accounting system can verify customer balances automatically. It is distinct from new money collected through نقدی شبا، نقدی، or چک, defaults its date to today when entered, appears in contract print/PDF payment output, and warns the user that the contract may expire if accounting finds a mismatch.
_Avoid_: using استفاده از باقی مانده مشتری to record new cash collected now, hiding it from printed payment terms, or treating the manually entered balance as automatically accounting-verified

**نام‌های برنامه تحویل**:
The project manager and receiver names on a delivery schedule are free-text person names. They may be prefilled from project/customer defaults, but multi-part names with spaces are valid and should remain exactly as the user enters them while preparing the delivery plan.
_Avoid_: collapsing multi-part names, removing typed spacing, or replacing an edited delivery name with a default while the user is typing

**برنامه تحویل چاپی**:
The delivery schedule shown in customer-facing PDF and print output. It should prioritize readable delivered item names and a separate delivered amount/metrage column over operational fields that make the table wrap.
_Avoid_: combining item name and delivered amount in one cramped cell when several delivery rows are present

**سربرگ چاپی قرارداد**:
The repeated customer-facing header on every PDF/print page, containing the Sabalan logo, contract number, contract date, print-time status, and page number.
_Avoid_: showing the contract header only on the first page of a multi-page contract output, or letting page content overlap the repeated header

**چاپ حسابداری قرارداد فروش**:
An internal accounting print/PDF version of a sales contract. It removes the branded customer-facing contract header but keeps a compact plain metadata row with contract number, contract date, print-time status, and the sales account/contract creator so accounting can identify the document without relying on the file name. It keeps مشخصات مشتری و پروژه because accounting needs the invoice/receivable party and project context, keeps all price-bearing product/payment columns and totals, and keeps برنامه پرداخت because accounting needs payment method, amount, due or payment date, check details, and notes.
Normal money values in this accounting copy show تومان only, while the final جمع کل فاکتور shows both تومان and the ریال equivalent.
_Avoid_: using the branded customer-facing header in the accounting copy, removing all contract identity metadata from the accounting copy, hiding the sales account/contract creator, hiding the customer/project identity needed for accounting follow-up, removing payment terms from the accounting copy, removing prices from the accounting copy, showing ریال on every dense table row, or hiding ریال from the final invoice total

**چاپ نمره کارگاه**:
A production-facing print/PDF version of a sales contract for workshop execution. It removes the branded/legal customer-facing header and all price-bearing information, but keeps a compact plain metadata row with contract number, contract date, print-time status, customer name only, and project/destination context so workshop sheets can be identified without exposing unnecessary customer or financial details. جدول اصلی محصولات remains the first major section and keeps all non-price production/detail rows, including product rows, سنگ مصرفی, ابزار, خدمات, برش, پرداخت سنگ, and row توضیحات, while removing purely financial total/discount rows. Price columns are removed entirely rather than left blank, and their width is redistributed to شرح، طول، عرض، مقدار/تعداد، and متراژ. It keeps برنامه تحویل with only ردیف، اقلام، متراژ/مقدار، تاریخ تحویل، and توضیحات.
_Avoid_: exposing prices, full customer identity details, payment terms, legal text, signatures, تحویل‌گیرنده, financial total/discount rows, or blank price columns in the workshop copy, or making the workshop copy hard to identify when printed

**انتخاب نسخه چاپ در حسابداری**:
Accounting chooses sales-contract print/PDF variants from a dropdown on the accounting contract detail page. Sales contract detail keeps the customer-facing original version, while accounting can choose نسخه اصلی، چاپ حسابداری، or چاپ نمره کارگاه.
Only چاپ نسخه اصلی marks the commercial contract as printed. چاپ حسابداری and چاپ نمره کارگاه are internal operational outputs and do not change the contract lifecycle status or printedAt. Print and PDF actions from accounting generate from the current saved contract at action time; internal accounting and workshop variants must not be served from a previously generated PDF cache.
_Avoid_: exposing accounting/workshop print variants as ordinary sales-detail actions, scattering print variants across unrelated buttons, changing contract status when an internal operational print is generated, or reusing a stale accounting/workshop PDF after contract details have changed

**چاپ سفارشی حسابداری قرارداد فروش**:
A temporary per-print accounting output configuration for a single sales contract. Accounting can choose visibility, grouping, section, and column options before printing/downloading, including detailed product rows or a summarized add-ons row. The choices are not saved as reusable templates and do not mutate the contract or its lifecycle status.
Custom print may hide or group existing information, but it does not allow manual editing of contract names, quantities, prices, totals, or real saved rows.
_Avoid_: treating custom accounting print as a saved template system, changing contract data through print settings, manually editing financial truth in the output, deleting real contract rows through print settings, or marking the commercial contract as printed from a custom internal output

**ردیف‌های خلاصه افزونه‌های قرارداد**:
A summarized print grouping mode where normal product rows stay visible with their base product price, while attached ابزار، خدمات، برش، پرداخت سنگ، حکمی, and standalone service add-ons are grouped into compact rows by the same catalog identity across the whole contract. The detailed print mode remains available when those add-ons need to be audited line by line.
In summarized mode, each add-on summary row shows the grouped add-on identity, combined amount, rate when it remains truthful, and grouped مبلغ کل. Product rows keep their base product totals, and جمع کل فاکتور reconciles as base products plus grouped add-on rows minus discount.
Catalog codes are part of the summarized add-on identity when available, so the printed summary remains auditable without expanding every product-level detail.
_Avoid_: losing access to the detailed version, changing the saved contract totals while summarizing, rolling add-ons into each product row, collapsing all add-ons into one generic row, hiding available catalog codes, or grouping unrelated catalog items only because their display names look similar

**خلاصه قرارداد فروش سنگ**:
A fixed sales-side customer-facing print/PDF output option beside the full-detail sales contract. It uses the same summarized add-ons meaning as ردیف‌های خلاصه افزونه‌های قرارداد, but sales users cannot customize sections or columns.
_Avoid_: exposing the accounting custom-print controls in sales, replacing the full-detail sales contract, or treating the summary output as a manual edit of contract data

**طول مصرفی سنگ مصرفی**:
The length shown for سنگ مصرفی is the source or standard length consumed from the material, not the finished/customer-requested product length. The product row shows the finished dimensions; سنگ مصرفی explains the material usage that produced it.
_Avoid_: showing the finished product length as the consumed source length when a standard/source length was used, or hiding the standard length consumed by the workshop

**گروه‌بندی سنگ مصرفی**:
Multiple سنگ مصرفی pieces may be grouped in print/PDF output only when they come from the same source material and have the same consumed source dimensions. When consumed pieces come from different source materials, each source is shown separately based on the amount used.
_Avoid_: merging different source materials into one سنگ مصرفی row, or expanding identical source pieces into repetitive rows when a grouped quantity and total area is clearer

**نمایش مقدار سنگ مصرفی**:
A grouped سنگ مصرفی row shows the consumed source width, consumed source/standard length, quantity, and total consumed area in a compact form, such as عرض ۴۰cm × طول ۱.۲m × ۳ عدد، جمع ۱.۴۴ متر مربع. Source dimensions and متر مربع may be shown with up to 4 decimal places when needed so the displayed dimensions and displayed area do not imply different calculations.
_Avoid_: showing only one piece area when multiple source pieces are consumed, adding per-piece area when the compact total area is enough, or rounding source dimensions so aggressively that users infer a different متر مربع than the saved consumed area

**بارگیری**:
A logistics-owned execution document that records what was actually loaded for shipment from one customer project, including the selected contract rows, loaded amounts, driver or vehicle details, and resulting remaining amounts.
_Avoid_: treating بارگیری as the customer-facing برنامه تحویل, or editing the sales delivery promise when logistics is recording actual shipment

**محدوده بارگیری**:
Each بارگیری belongs to exactly one customer project and may include deliverable rows from multiple sales contracts for that same project.
_Avoid_: mixing multiple customer projects in one بارگیری, even when the same driver or vehicle carries them together

**جستجوی پروژه در بارگیری**:
A logistics project lookup matches the project, address, customer identity, company identity, and contact numbers tied to the customer or project.
_Avoid_: forcing logistics users to know the project name when the operational clue they have is a phone number

**شروع پیش‌نویس بارگیری**:
A draft بارگیری starts when logistics selects the customer project, so the in-progress shipment can be resumed before rows, driver, or vehicle details are complete.
_Avoid_: treating بارگیری creation as only the final submit action, or keeping meaningful loading progress as a browser-only form

**ادامه پیش‌نویس بارگیری**:
When logistics selects a project that already has an active draft بارگیری, the normal path resumes that draft; creating another active draft for the same project is an explicit exception for simultaneous operational loading.
_Avoid_: silently creating duplicate active drafts for the same project during ordinary loading creation

**مانده بارگیری**:
The remaining amount for logistics is calculated from eligible contracted amounts minus finalized بارگیری amounts, within compatible contract-row/product groupings.
_Avoid_: using برنامه تحویل, accounting invoice state, draft بارگیری, or unrelated product rows as the source of truth for physical remaining

**گروه مانده بارگیری**:
A logistics display grouping that combines remaining amounts only for contract rows with identical logistics-relevant product specs, while preserving access to the individual source contract rows inside the group.
_Avoid_: losing contract-row traceability when showing a grouped remaining amount, or grouping rows whose physical loading specs differ

**تخصیص منبع بارگیری**:
When a grouped remaining line contains multiple source contract rows, the logistics user manually chooses how much the بارگیری consumes from each source row before finalization.
_Avoid_: automatically consuming contract rows behind the user's back, even when the grouped remaining amount is compatible

**خط راس بارگیری**:
A logistics calculation input for length-based loading that represents the common or average piece length used with a piece count to calculate loaded متر طول.
_Avoid_: treating خط راس as a contract dimension, product catalog field, or separate unit of measure

**اضافه و کسر بارگیری طولی**:
Manual length adjustments applied to a length-based بارگیری calculation after خط راس × تعداد: اضافه increases the loaded متر طول and کسر decreases it.
_Avoid_: hiding these adjustments inside the final amount without preserving how the logistics user calculated it

**تلورانس بارگیری طولی**:
A finalized length-based بارگیری may exceed the current remaining متر طول by up to 0.5m with a warning; under-loading is allowed because it leaves remaining for later shipment.
_Avoid_: blocking small length-based overages caused by normal loading variance, or applying the 0.5m tolerance to unrelated units without a separate business decision

**وضعیت بارگیری**:
Only finalized بارگیری records reduce logistics remaining amounts. Draft بارگیری records are editable preparation records, and cancelled بارگیری records stay in history without reducing remaining.
_Avoid_: reducing remaining from draft loading entries, or deleting cancelled logistics history

**قفل بارگیری نهایی‌شده**:
A finalized بارگیری is immutable because it affects remaining amounts and accounting visibility. Mistakes after finalization are handled through cancellation or correction records rather than silent edits.
_Avoid_: editing finalized loading quantities, driver details, or source rows in place

**اصلاح بارگیری نهایی‌شده**:
Major or document-level mistakes in a finalized بارگیری are handled by cancelling the loading record, while small quantity mistakes are handled by linked correction records that preserve the original finalized document.
_Avoid_: silently changing finalized بارگیری data, or forcing every small quantity adjustment to cancel and recreate the whole loading

**اعتبارسنجی اصلاح بارگیری**:
Correction records follow the same unit, remaining, and tolerance rules as normal بارگیری lines. A correction that increases loaded quantity reduces remaining, and a correction that decreases loaded quantity increases remaining.
_Avoid_: using corrections to bypass loading tolerance or unit compatibility rules

**راننده بارگیری**:
Logistics may select a reusable driver record or enter a temporary driver during بارگیری, but every بارگیری saves its own driver and vehicle snapshot for historical accuracy.
_Avoid_: making old loading documents depend on the current editable driver profile, or requiring every temporary driver to become a reusable driver record

**راننده در نهایی‌سازی بارگیری**:
A draft بارگیری may exist without driver information, but finalization requires a complete driver and vehicle snapshot.
_Avoid_: blocking early loading preparation only because the truck is not known yet, or finalizing shipment evidence without driver details

**ردیف قابل بارگیری**:
A contract row is loadable only when it represents physical cargo leaving Sabalan. Services and operations are not loaded separately, but service/tool/finishing details attached to a physical product should remain visible as part of that product's loading identity.
_Avoid_: creating بارگیری lines for standalone services, or hiding product-attached services that help logistics identify the correct cargo

**مشاهده حسابداری بارگیری**:
Accounting sees finalized logistics loading records as read-only shipment evidence, including customer/project, contract links, loaded amounts, driver snapshot, warnings, and correction history.
_Avoid_: letting accounting directly edit physical loading quantities or driver details

**برگه چاپی بارگیری**:
A printable loading slip is an output of a finalized digital بارگیری, not the source record. It summarizes the loading document for warehouse, driver, or accounting use.
_Avoid_: treating the old paper table as the required digital UI layout, or keeping paper as the source of truth after digital entry

**برنامه تحویل در برابر بارگیری**:
برنامه تحویل is the sales/customer promise for planned delivery timing and amounts; بارگیری is the logistics record of actual loading and shipment.
_Avoid_: merging promised delivery schedule data with actual loading transactions when shipped quantities, dates, or drivers differ
