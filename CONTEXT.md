# Sabalan ERP

Sabalan ERP manages stone inventory, sales contracts, and related pricing data for Sabalan Stone. This glossary defines project-specific business terms so the product and code use the same language.

**Product Search**:
A product lookup in the price inquiry surface that matches product identity and price-facing product details, regardless of Persian or Arabic character variants.
_Avoid_: treating search as only an exact prefix lookup

**خوراک اره**:
A per-contract-product material-consumption adjustment for physical cuttable stone. When enabled, the saved row carries `sawKerfEnabled: true` and `sawKerfCm: 0.3`; each actually cut axis consumes the finished requested dimension plus 3mm for source-material charge, smart packing, and remaining-stone geometry. Finished dimensions, delivery, standalone services, tools, and finishing calculations stay based on the customer-requested size.
_Avoid_: applying kerf to service rows, applying it to a full-width/full-length axis with no cut, or changing printed finished dimensions.

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

**پرداخت سنگ**:
A stone finishing or treatment option applied during contract pricing, separate from ابزار, calculated by متر طول or متر مربع depending on the item.
_Avoid_: ابزار, خدمات, فرآوری سنگ

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

**ویرایش مرحله‌ای قرارداد فروش**:
Editing a sales contract uses the same step-based contract workflow as creation, with prefilled saved contract details and direct access to any step that may need correction.
_Avoid_: a separate simplified edit form, or forcing linear navigation during edit

**اعتبارسنجی ویرایش قرارداد فروش**:
During sales contract editing, users may jump directly to any step, but saving changes requires the complete contract to be valid; validation should point the user to the first invalid step.
_Avoid_: blocking step jumps in edit mode, or saving partially invalid edited contracts

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

**شماره چک ناقص**:
A check payment saved during sales contract creation without a check number. It remains valid for contract creation and output, while preserving the missing value for later accounting follow-up.
_Avoid_: blocking contract creation only because a check number is empty

**برنامه تحویل چاپی**:
The delivery schedule shown in customer-facing PDF and print output. It should prioritize readable delivered item names and a separate delivered amount/metrage column over operational fields that make the table wrap.
_Avoid_: combining item name and delivered amount in one cramped cell when several delivery rows are present

**سربرگ چاپی قرارداد**:
The repeated customer-facing header on every PDF/print page, containing the Sabalan logo, contract number, contract date, print-time status, and page number.
_Avoid_: showing the contract header only on the first page of a multi-page contract output, or letting page content overlap the repeated header
