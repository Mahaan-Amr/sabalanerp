# Sabalan ERP

Sabalan ERP manages stone inventory, sales contracts, and related pricing data for Sabalan Stone. This glossary defines project-specific business terms so the product and code use the same language.

**Product Search**:
A product lookup in the price inquiry surface that matches product identity and price-facing product details, regardless of Persian or Arabic character variants.
_Avoid_: treating search as only an exact prefix lookup

**Canonical OPC Product Name**:
The saved catalog product name generated from the product's coded stone attributes in the order cut type, stone material, width label, thickness label, mine, and finish; when attributes are missing, the name is generated from the available attributes without placeholder text.
_Avoid_: saving a manually shortened family label such as only cut type plus stone material when the full coded attributes are available

**Incomplete Product Attribute Set**:
A product catalog row missing one or more attributes normally used to form the Canonical OPC Product Name, while still being allowed as a deliberate catalog exception after the missing attributes are made visible.
_Avoid_: silently accepting incomplete product identity, or blocking every partial product row as invalid

**Catalog Code**:
A text business identifier whose characters and leading zeros are meaningful for product catalog identity and coded product attributes.
_Avoid_: treating catalog codes as numbers, trimming leading zeros, or comparing only their numeric value

**Canonical OPC Product Code**:
The product catalog code generated from the product's coded attributes when the required component codes are available; if required component codes are missing, the current product code remains the best available identity for that partial row.
_Avoid_: leaving a stale generated product code after the coded attributes change

**Product Code Conflict**:
An Excel import row where the uploaded product code and the generated Canonical OPC Product Code identify two different existing products; the row cannot be applied until the conflict is corrected.
_Avoid_: silently merging product identities, overwriting the uploaded-code product, or overwriting the generated-code product

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
A per-contract-product material-consumption adjustment for physical cuttable stone. When enabled, the saved row carries `sawKerfEnabled: true` and `sawKerfCm: 0.3`; each actually cut axis consumes the finished requested dimension plus 3mm for source-material charge, smart packing, and remaining-stone geometry. Stair layers cut from the parent row's stone inherit that row's active saw kerf for packing, so a 35cm source fits seven finished 5cm strips without kerf but only six with 0.3cm kerf. Finished dimensions, delivery, standalone services, tools, and finishing calculations stay based on the customer-requested size.
_Avoid_: applying kerf to service rows, applying it to a full-width/full-length axis with no cut, or changing printed finished dimensions.

**برش کالیبر**:
A cutting-charge modifier for طولی and stair product rows that adds one paid side-edge longitudinal cut for each consumed source band while leaving material area, delivery dimensions, and remaining-stone geometry unchanged. It is included inside the normal برش total and printed cutting details rather than shown as a separate add-on. A newly configured row starts without calibration because this paid operation requires explicit selection; an existing or restored row preserves its saved choice, and a legacy missing choice retains the historical enabled meaning until an authorized edit and save.
_Avoid_: treating برش کالیبر as extra consumed material, a separate service row, or a separate printed line item; enabling it implicitly on a new row; or interpreting a missing legacy value as a silent price reduction

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

**فضای کاری CRM**:
The workspace for both customer registry management and pre-contract sales pipeline management, covering customer profiles, project addresses, contacts, ownership, leads, opportunities, follow-up tasks, and handoff into sales contracts.
_Avoid_: limiting CRM to customer CRUD only, or moving pre-contract sales pipeline work into the sales contract workspace.

**مخاطب در حال پیگیری**:
A person or organization recorded in CRM because Sabalan sellers are pursuing possible work with them, even when they have not made a final purchase or signed a sales contract.
_Avoid_: treating every CRM person as a finalized buyer, or requiring a sales contract before seller follow-up can be recorded.

**هشدار تکراری CRM**:
When a seller tries to create a CRM person/customer that matches an existing record, the system warns them and shows a limited summary such as name, matched phone, active potential-project count, and responsible seller or managed-by-CRM-team indicator. Creating a duplicate despite the match requires CRM manager or admin approval.
_Avoid_: silently creating duplicate CRM people, or exposing detailed follow-up history during duplicate checking.

**افزودن پروژه احتمالی به مخاطب موجود**:
When a seller finds an existing CRM person/customer but has a genuinely new potential project for them, the seller should add or request a new potential project under the existing CRM record instead of creating a duplicate person. If permitted, the seller can create the project directly and become responsible for it; otherwise they submit a CRM manager/admin request to attach it.
_Avoid_: duplicating the person/customer record just because a new seller or new project appears.

**پروژه احتمالی**:
A potential customer project being pursued by sellers before it becomes a priced sales contract. It belongs in CRM while the work is still being discovered, followed up, or negotiated.
_Avoid_: creating a sales contract just to track an unconfirmed project, or losing the project context inside generic customer notes.

**فیلدهای پروژه احتمالی**:
A potential project requires project title, CRM person/customer, responsible seller, project status, and work/deal type. Address or location, including city, estimated value, probability, expected close date, description, source or referrer, and next follow-up are optional at creation; an unknown city remains unspecified.
_Avoid_: blocking early project capture with forecasting or location details that the seller may not know yet, or inferring a city such as Tehran when none was provided.

**برآورد پروژه احتمالی**:
Optional CRM forecasting fields on a potential project, such as estimated value, probability, and expected close date or month. They help managers forecast pipeline value but should not block sellers when early project details are unknown.
_Avoid_: requiring estimated value or probability before a seller can start tracking a real potential project.

**وضعیت پروژه احتمالی**:
The Persian-first lifecycle status of a potential project in CRM before or during conversion to sales work: جدید, در حال پیگیری, نیازمند پیشنهاد, آماده قرارداد, برنده شده, از دست رفته, and راکد.
_Avoid_: exposing English status labels to operators, or treating every paused project as permanently lost.

**قوانین پایان پروژه احتمالی**:
A potential project becomes برنده شده only when a Sales Contract is created from it or explicitly linked as the winning contract. It becomes از دست رفته when a seller or CRM manager marks it lost with a required reason. It becomes راکد when there is no active follow-up for now but the project is not truly lost; راکد requires a reason and may include a revisit date. برنده شده and از دست رفته do not require a next action; راکد makes next action optional while a revisit date is recommended.
_Avoid_: marking projects as won without a linked sales contract, marking projects lost without a reason, or treating راکد as the same as از دست رفته.

**تبدیل پروژه احتمالی به قرارداد فروش**:
When a potential project reaches آماده قرارداد, the responsible seller may create a draft Sales Contract from it. Approval remains in the existing Sales and Accounting contract workflow rather than adding a separate CRM approval gate.
_Avoid_: requiring CRM-manager approval just to start a draft contract, or bypassing the normal Sales and Accounting approval controls after the draft exists.

**فروشنده مسئول پروژه احتمالی**:
The seller responsible for following up one specific potential project. The same CRM contact can have multiple potential projects with different responsible sellers, and one seller can follow multiple projects for the same contact.
_Avoid_: assuming customer ownership and project ownership are always the same, or forcing all of a contact's potential projects to belong to one seller.

**تغییر مسئول پروژه احتمالی**:
CRM managers and admins can reassign a potential project to another seller with a required reason. The current responsible seller can request or suggest reassignment but cannot silently transfer ownership without manager-level permission.
_Avoid_: quiet seller-to-seller handoffs without accountability, or blocking legitimate manager-driven reassignment when workloads or relationships change.

**تاریخچه پروژه احتمالی پس از تغییر مسئول**:
Potential-project follow-up history stays attached to the project after reassignment. The new responsible seller can see prior project-level reports for context, each report keeps its author and timestamp, and the reassignment reason appears in the project timeline.
_Avoid_: hiding prior project context from the new seller, rewriting authorship, or treating reassignment as an invisible metadata change.

**گزارش پیگیری CRM**:
A dated record of a seller's follow-up activity for a CRM contact, customer, or possible project, such as a call, office visit, message, meeting, or other communication attempt and its outcome.
_Avoid_: storing follow-up history only as free-text customer fields, or mixing pre-contract follow-up reports with approved sales contract events.

**فیلدهای گزارش پیگیری CRM**:
A CRM follow-up report requires the related customer/person, seller/reporter, communication type, work/deal type, follow-up date/time, summary of what happened, and outcome. A related potential project is optional when the follow-up is a general customer-level follow-up rather than project-specific.
_Avoid_: recording follow-up reports without a clear event summary, outcome, author, date/time, communication type, or business context.

**نوع ارتباط پیگیری CRM**:
The Persian-first communication type recorded on a CRM follow-up report or next action. V1 types are تماس تلفنی, پیامک / پیام‌رسان, مراجعه حضوری به دفتر سبلان, بازدید از پروژه, جلسه حضوری, ارسال پیش‌فاکتور / پیشنهاد, پیگیری مالی, and سایر.
_Avoid_: using only free-text communication types, or exposing English activity labels to operators.

**نوع کار/معامله پیگیری CRM**:
The Persian-first business opportunity type recorded separately from communication type on a CRM follow-up report or next action. V1 types are فروش سنگ پروژه ساختمانی, فروش همکاری, خدمات / ابزار / فرآوری, بارگیری یا تحویل مرتبط با فروش قبلی, استعلام قیمت, and سایر.
_Avoid_: mixing how the seller contacted the person with what business opportunity is being pursued.

**اقدام بعدی پیگیری CRM**:
The next required action created from a CRM follow-up report, including a due date, communication type, intended deal/work type, and clear Persian instructions for what the seller should do next. A follow-up report should normally have a next action unless there is no next follow-up or the tracked customer/project work is finished.
_Avoid_: recording follow-up history without an actionable next step when the pursuit is still active, or leaving the next step as vague free text without date and action type.

**فیلدهای اقدام بعدی پیگیری CRM**:
When a CRM follow-up report needs a next action, the next action requires title or action type, due date, next communication type, and clear Persian instructions.
_Avoid_: creating vague reminders that only say follow up without explaining what the seller should do next.

**نمای پیگیری‌های سررسیدشده CRM**:
Sellers see their own overdue and upcoming CRM next actions, while CRM managers and admins see team-level overdue and upcoming follow-ups for oversight.
_Avoid_: relying only on individual seller memory for follow-up discipline, or exposing team-level task oversight to sellers without management responsibility.

**یادآوری پیگیری CRM در نسخه اول**:
V1 CRM reminders appear on the CRM dashboard and as in-app notification badges or counts. Due and overdue items are calculated automatically from the next-action due date/time, and the manager dashboard highlights overdue follow-ups by seller. V1 does not send SMS, email, WhatsApp, or repeated noisy alerts.
_Avoid_: launching external-message reminders before the in-app follow-up discipline is stable.

**داشبورد فروشنده CRM**:
The seller CRM dashboard shows today's follow-ups, overdue follow-ups, upcoming follow-ups, the seller's active potential projects by status, recently updated customers or projects, and quick actions to add a follow-up, add a potential project, or create a customer.
_Avoid_: making sellers search through manager-level analytics before seeing their own next work.

**داشبورد مدیر CRM**:
The CRM manager/admin dashboard shows team overdue follow-ups, follow-ups due today, active projects by seller and status, dormant projects, won/lost counts, estimated pipeline value, recent reassignment/activity timeline, and quick filters by seller, status, and work/deal type.
_Avoid_: giving managers only individual task lists without team-level pipeline and follow-up oversight.

**دسترسی گزارش پیگیری CRM**:
Project-level CRM follow-up reports are visible by default to the responsible seller, CRM manager, and admins. Other sellers can see enough customer and potential-project summary to avoid duplicate pursuit, but not detailed follow-up reports unless assigned to that project or explicitly granted access.
_Avoid_: making all seller follow-up details globally visible, or hiding potential project existence so completely that sellers unknowingly pursue the same work twice.

**راهنمای بخش CRM**:
A Persian user-facing guide attached to each CRM section so operators can open it from that section and understand the purpose, fields, workflow, permissions, and expected usage of the section.
_Avoid_: relying only on training outside the application, or placing one generic CRM manual that does not explain each section in its own context.

**راهنمای متمرکز CRM**:
A contextual CRM guide mode where the rest of the page is visually de-emphasized while the relevant field, table, action, or section stays clear and the Persian explanation appears beside or near it.
_Avoid_: showing detached help text that is not visually connected to the part of the page being explained.

**محتوای راهنمای CRM**:
CRM guide text is static product content shipped with the codebase for V1, so each UI change can update the matching Persian guide in the same code change.
_Avoid_: making guide content admin-editable before the guided UI patterns and section workflows are stable.

**ساختار راهنمای CRM**:
Each CRM guide section should explain what the section is for, who should use it, required fields, optional fields, what happens after saving, who can see or edit it, common mistakes, and mobile usage notes when relevant.
_Avoid_: inconsistent guide content where some sections explain workflow and others only define fields.

**طراحی CRM موبایل‌پسند**:
All CRM section implementations must work on mobile and follow Sabalan ERP's existing design system, shared components, RTL layout behavior, and Persian-first visual language.
_Avoid_: building desktop-only CRM tables, introducing a separate visual style, or bypassing existing ERP components without a concrete reason.

**خارج از محدوده CRM نسخه اول**:
CRM V1 excludes external reminders such as SMS, email, or WhatsApp; admin-editable guide content; AI lead scoring; marketing campaigns; complex sales forecasting; commission management; a separate mobile app; and Excel import for CRM data.
_Avoid_: expanding CRM V1 beyond customer/person records, potential projects, follow-up reports, next actions, dashboards, permissions, guided help, and Sales Contract conversion.

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

**تفکیک جمع محصولات و خدمات وابسته قرارداد**:
The customer-facing confirmation and print summary show the non-service product subtotal separately from billable cutting, tools, finishing, and standalone service rows, while the persisted product `totalPrice` remains the canonical all-in product amount. The final payable total counts every billable fact exactly once.
_Avoid_: omitting a priced operation from the final payable amount, adding a displayed dependent service on top of an already all-in product total, presenting non-billable حکمی cross-cutting as a customer charge, or silently rewriting a finalized historical contract

**توضیحات ردیف خدمات قرارداد**:
A per-contract note attached to a selected standalone service row, prefilled from the catalog description when available but editable without changing the catalog.
_Avoid_: editing the catalog service description when the user only means the current contract row

**توضیحات خروجی محصول قرارداد**:
A product-level description printed inside the product's own output group as the last row for that product, after related explanatory, mandatory, cutting, tool, service, and finishing rows.
_Avoid_: printing the product description before the product's related detail rows, or moving standalone service notes into a product group

**جستجوی عددی محصول**:
A product catalog search that treats Persian, Arabic, and Latin digits as the same value when matching numeric product details such as عرض, ضخامت, کد, and قیمت.
_Avoid_: making users switch keyboard language to find numeric product values

**سنگ مصرفی**:
An informational customer-facing row that shows the full base stone consumed to create a sold cut product, including a quantity-zero longitudinal product. It explains actual source width, consumed source length, source quantity, and consumed area, but is not a second charged product row or a workshop cutting instruction; internal production-piece and remainder breakdowns stay outside customer PDF/print.
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
وقتی کاربر عرض و طول محصول طولی را صریحاً وارد می‌کند، هر دو بعد قید قطعه فیزیکی هستند و برش هوشمند باید هر قطعه را یکپارچه نگه دارد. تقسیم یک طول صریح به چند قطعه کوتاه‌تر فقط با انتخاب روشن «تقسیم فیزیکی مجاز» انجام می‌شود.
_Avoid_: فهمیدن طول صریح به عنوان تقاضای کل قابل تقسیم، تبدیل خودکار یک قطعه به چند قطعه کوتاه‌تر، یا پنهان‌کردن مجوز تقسیم در تنظیمات فنی

**بعد مشتق‌شده در برش هوشمند**:
وقتی یکی از ابعاد محصول صفر یا خالی است و عرض، متراژ کل، تعداد یا اطلاعات دیگر برای محاسبه کافی هستند، برش هوشمند می‌تواند بعد نامشخص را برای چیدمان بهینه محاسبه کند. بعدی که کاربر صریحاً وارد کرده قید باقی می‌ماند و نتیجه محاسبه‌شده پیش از ذخیره به کاربر نشان داده می‌شود.
_Avoid_: تغییر بی‌صدای یک بعد صریح، حدس‌زدن با اطلاعات ناکافی، یا ذخیره نتیجه بهینه‌سازی بدون نمایش ابعاد و قطعات فیزیکی محاسبه‌شده

**تعداد صفر در برش هوشمند طولی**:
فقط برای محصول سنگ طولی، تعداد خالی یا صفر اجازه یک برآورد داخلی برای جلوگیری از بیش‌برآورد هزینه است؛ محصول طولی که تازه از کاتالوگ برای یک ردیف جدید انتخاب می‌شود با تعداد واقعی صفر آغاز می‌شود تا این برآورد بدون تعامل اضافی فعال باشد. تعداد، طول و عرض واردشده همچنان عین درخواست مشتری باقی می‌مانند. برای نمونه درخواست `40cm` منبع، `7cm` عرض، `50m` طول و تعداد صفر در همه ردیف‌ها و خروجی‌ها همان `0 / 50m / 7cm` می‌ماند و نتیجه بهینه‌ساز جایگزین آن نمی‌شود. در مقابل، تعداد مثبت صریح است و طول را به طول هر قطعه تبدیل می‌کند؛ `2 / 50m` یعنی دو قطعه 50 متری و مجموع 100 متر. ردیف و پیش‌نویس موجود و ردیف تکثیرشده مقدار خود را حفظ می‌کنند. ردیف قدیمی که مقادیر صفر را با خروجی بهینه‌ساز جایگزین کرده، هنگام خواندن از provenance بازسازی می‌شود و فقط با ذخیره صریح قرارداد اصلاح پایدار می‌گردد.
_Avoid_: تبدیل تعداد خالی یا صفر به یک یا تعداد محاسبه‌شده، تبدیل طول کل مشتری به طول قطعه محاسبه‌شده، تعمیم این معنا به انواع دیگر محصول، نمایش برآورد داخلی به‌عنوان خواسته مشتری، یا مهاجرت بی‌صدای قراردادهای نهایی‌شده

**چیدمان عرضی قطعات صریح سنگ طولی**:
تعداد مثبت، تعداد قطعات مشتری و طول واردشده، طول هر قطعه است؛ بهینه‌ساز این مقادیر را تغییر نمی‌دهد اما هر تعداد قطعه هم‌طول که با عرض و خوراک اره فعال در سنگ منبع جا شود کنار هم می‌چیند. برای نمونه دو قطعه `20cm × 10m` از سنگ `40cm` بدون خوراک اره، یک منبع `40cm × 10m` مصرف می‌کنند، نه `40cm × 20m`؛ برش جداسازی `10m` است و کالیبراسیون فعال فقط `10m` دیگر به هزینه برش اضافه می‌کند، نه به طول سنگ مصرفی. با خوراک اره `0.3cm`، این دو قطعه دیگر در یک عرض `40cm` جا نمی‌شوند و دو منبع `40cm × 10m` مصرف می‌شود؛ ردیف «سنگ مصرفی» همین مصرف واقعی و خوراک اره را به مشتری نشان می‌دهد، در حالی که ردیف محصول همچنان `2 × 20cm × 10m` است.
چیدمان عرضی چند قطعه صریح همیشه خودکار است و به مجوز تقسیم فیزیکی نیاز ندارد؛ آن مجوز فقط برای تبدیل یک قطعه صریح به چند قطعه کوتاه‌تر است.
_Avoid_: جمع‌کردن طول قطعاتی که در یک ردیف عرضی منبع جا می‌شوند، تغییر تعداد یا طول هر قطعه مشتری، نادیده‌گرفتن خوراک اره فعال، استفاده از مجوز تقسیم برای چیدمان قطعات مستقل، یا ترکیب بی‌صدای ردیف‌های محصول جداگانه؛ استفاده بین ردیف‌ها فقط از مسیر انتخاب صریح باقی‌مانده انجام می‌شود

**ردیف تجاری و خروجی فیزیکی برش هوشمند**:
ردیف قرارداد در فروش، حسابداری، تحویل و کارگاه همان خواسته ثبت‌شده مشتری است. نتیجه بهینه‌ساز دستور تولید نیست، اما حقیقت داخلی هندسی برای برآورد مصرف ماده، موجودی باقی‌مانده و قیمت عملیات وابسته به هندسه است؛ برای نمونه `5 × 10m × 7cm` یک لبه طولی را `50m` و یک لبه کوتاه را `0.35m` محاسبه می‌کند، بدون تغییر ردیف `0 / 50m / 7cm` مشتری. برش طولی همین چیدمان را مبنا می‌گیرد و فقط در صورت فعال‌بودن کالیبراسیون، طول کالیبراسیون را جداگانه اضافه می‌کند؛ بنابراین نمونه می‌تواند `50m` یا با کالیبراسیون `60m` باشد. breakdown چیدمان فقط در پنجره ساخت/ویرایش فروش با عنوان «مبنای محاسبات داخلی» دیده می‌شود، اما ردیف اعتمادساز «سنگ مصرفی» در چاپ/PDF همچنان ابعاد و مقدار واقعی سنگ منبع مصرف‌شده را نشان می‌دهد.
_Avoid_: جایگزین‌کردن خواسته مشتری با قطعات برآوردشده، قیمت‌گذاری عملیات از ردیف صفر به‌جای هندسه داخلی، نمایش breakdown قطعات در PDF مشتری، حسابداری، تحویل یا کارگاه، پنهان‌کردن سنگ مصرفی واقعی، معرفی برآورد به‌عنوان دستور کارگاه، یا ساختن چند حقیقت متناقض از یک ردیف قرارداد

**باقی‌مانده برش هوشمند طولی**:
باقی‌مانده سنگ طولی بر اساس چیدمان داخلی بهینه‌ساز محاسبه می‌شود، حتی وقتی آن چیدمان دستور کارگاه نیست و ردیف قرارداد عین درخواست مشتری می‌ماند. این باقی‌مانده یک موجودی معتبر، قابل‌نمایش و بلافاصله قابل‌انتخاب برای ساخت محصول دیگر است؛ برای نمونه برآورد `5 × 10m × 7cm` می‌تواند باقی‌مانده `5cm × 10m` بسازد.
_Avoid_: پنهان‌کردن باقی‌مانده بهینه‌ساز، وابسته‌کردن قابلیت استفاده آن به تأیید کارگاه، یا محاسبه دوباره آن از تعداد و طول نمایشی ردیف مشتری

**عرض درخواستی ردیف قرارداد**:
The customer-requested finished width of a contract product row, shown when delivery scheduling needs to distinguish the requested piece from the source stone consumed to make it.
_Avoid_: using this value as the source-material width when the row is cut from a wider stone

**عرض مصرفی ردیف قرارداد**:
The width of the source stone consumed to create a contract product row. It explains material usage and should align with سنگ مصرفی rather than replacing the customer-requested width.
_Avoid_: treating عرض مصرفی as the finished customer-requested width

**ردیف زمان‌بندی تحویل/اجرا**:
A contract row that can be assigned to the delivery schedule because it represents either a physical stone product to deliver or a standalone service row to execute for the customer.
_Avoid_: representing service execution as a fake stone product, or assuming every scheduled row is physical inventory

**هویت پایدار تخصیص تحویل**:
A delivery quantity belongs to one exact contract product row through `productRowId`; `productIndex` and catalog `productId` are compatibility snapshots, not canonical identity. A legacy assignment is migrated automatically only when its saved index still points to a row with the same catalog product ID. A missing, duplicated, or contradictory identity blocks save and remains visibly invalid until the operator explicitly chooses «حذف تخصیص نامعتبر»; the removed quantity becomes unallocated and must be assigned manually.
Commercial product rows remain independent even when their catalog stone, dimensions, description, unit price, or total price are identical. If independent rows accidentally share an internal `productRowId`, every row in that collision receives a new unique identity without changing commercial data; any assignment carrying the old ambiguous identity remains invalid and must be removed and entered manually. If the duplicated identity is referenced by a layer or remaining-stone child as its parent/source, automatic repair is forbidden and the relationship must be reviewed explicitly.
_Avoid_: treating similar commercial rows as duplicates, merging or deleting them, preserving one ambiguous row as the presumed delivery target, or guessing which duplicate parent owns a dependent child
_Avoid_: matching deliveries by array position after products change, guessing from a similar stone, silently transferring quantity to another row, deleting an invalid assignment without confirmation, or allowing an unresolved/unallocated quantity through final save

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

**مجموعه لایه پله**:
The customer-facing quantity of a stair layer row: the parent stair quantity multiplied by تعداد لایه برای هر پله. Selected edges such as جلو and چپ are the physical pieces contained in each layer set, while their piece count and the number of source stones consumed remain separate production facts.
_Avoid_: multiplying the layer-row quantity by the number of selected edges, or treating physical edge pieces as complete source stones

**سنگ پرداخت‌شده و سنگ جدید لایه پله**:
Layer pieces allocated from parent or remaining stone whose material was already charged add no second material charge; only their cutting, layer type, tools, and finishing remain billable. A layer shortage consumes and charges complete new source stones including unavoidable packing waste, saves every usable remainder as already-paid material, and does not charge that material again when the remainder is later allocated. Customer output distinguishes layer sets supplied from already-paid stone, layer sets supplied from new stone, and the quantity and area of new source stone consumed.
_Avoid_: charging parent or reusable remaining material twice, charging only finished strip area when complete new source stones are consumed, discarding usable new-stone remainder, or hiding the material-source split from the customer

**طول منبع لایه پله**:
The charged and packed length of stone supplying stair layers. Automatically procured new stone uses the catalog standard/source length, while parent or remaining stone uses its exact saved available length and manually selected warehouse stone uses the explicitly entered available length; finished layer-piece lengths remain based on the stair's actual geometry.
_Avoid_: charging automatic new stone at only the finished strip length, replacing exact remainder or warehouse dimensions with a catalog default, or printing the source length as the finished layer length

**تخصیص منبع لایه پله**:
A deterministic allocation from already-paid or new stone to one layer row. Compatible remainder owned by the exact parent row is consumed automatically first; compatible remainder from another contract row is only offered and consumed through explicit user selection, after which new source stone supplies any shortage. Every allocation keeps stable source-row identity, and a parent edit that invalidates an allocation rejects the complete edit with the affected layer identified instead of silently moving it to another source.
_Avoid_: gathering and consuming sibling-row remainder automatically, identifying a source by stair part type or array position, changing allocation order during recalculation, partially applying an invalid parent edit, or silently replacing invalidated remainder with new stone

**چرخه عمر لایه پله وابسته**:
An attached layer belongs to one exact parent stair row through stable row identity. Parent edits atomically preview and recalculate attached layers, source allocations, remainders, cuts, add-ons, and totals while preserving independent layer selections and requiring renewed confirmation for affected manual overrides; any allocation conflict rejects the whole edit. Confirmed parent deletion removes its layers together, layer-only deletion restores its allocated remainder, and explicit duplication with layers creates new identities and recalculates allocations instead of sharing links.
_Avoid_: linking a layer by stair type or position, partially saving a parent edit, leaving orphan layers, deleting attached layers without confirmation, losing restored remainder after layer deletion, or copying parent/layer source relationships into a duplicate

**تحویل لایه پله وابسته**:
A stair layer is a non-independent child manufactured and delivered as part of its exact parent stair row. Customer output nests its layer-set quantity and auditable material, cutting, tooling, finishing, and price details beneath the parent; accounting retains the linked pricing breakdown, workshop retains the physical strip plan, and logistics includes layer details in the parent loading identity without creating a separate delivery or loading balance.
_Avoid_: scheduling or loading layer strips as independent cargo, printing physical strip count as layer-set quantity, hiding the child price breakdown, omitting production geometry from workshop output, or allowing parent delivery or deletion to leave an independent layer balance

**دروازه تطبیق گراف محصول قرارداد**:
A product-configuration change is complete only when one canonical recalculation produces a valid atomic parent/child graph and screen totals, saved contract data, reload state, customer and accounting output, workshop truth, delivery, and logistics reconcile exactly. Saving is blocked by orphan or unstable relationships, invalid source allocations, incompatible processing, unconfirmed stale overrides, or pricing mismatches; finalized history remains unchanged until authorized explicit edit and save.
_Avoid_: accepting a UI-only correction, partially saving a graph mutation, duplicating formulas across consumers, treating passing legacy tests as sufficient evidence, or releasing without deterministic complex-scenario and rendered-output verification

**برش مستقل لایه پله**:
The physical and billable cutting plan owned by a stair layer row. It records actual longitudinal saw passes that create layer strips and cross cuts that shorten them from source length to finished edge-piece length, uses the applicable cutting catalog rates, and keeps saw kerf as source-consumption geometry rather than a separate service; layer cuts remain separate from parent cuts and ابزار.
_Avoid_: returning zero or empty cutting details for physically cut layers, copying parent cutting totals, storing automatic layer cuts as ابزار, charging saw kerf as a service, or printing one cut in more than one category

**ابزار و پرداخت مستقل لایه پله**:
Tooling and stone finishing selected specifically for a stair layer row and calculated from that layer's finished physical pieces. A new layer starts without parent add-ons; copying selections from the parent stair row is an explicit user action and creates independently editable layer selections. Each layer ابزار or پرداخت explicitly targets one or more existing layer sides, such as جلو or چپ. ابزار meterage includes only targeted physical pieces; پرداخت quantity follows its catalog unit using the targeted finished geometry: area for متر مربع, length for متر طول, or physical-piece count for تعداد. A layer may carry multiple cumulative پرداخت selections, each with independent targets, quantity, unit price, and total; catalog-defined incompatibility prevents combinations that cannot coexist.
_Avoid_: automatically inheriting parent ابزار or پرداخت, charging layer add-ons from full source-stone area, keeping copied add-ons linked to later parent changes, applying an add-on to untargeted layer sides, ignoring the پرداخت catalog unit, or collapsing cumulative processing into one finishing field

**پرداخت‌های چندگانه محصول قرارداد**:
A shared collection of independently priced stone-finishing selections available to طولی, main پله, لایه پله, اسلب, and remaining-stone child rows. Each selection preserves its catalog item, calculation unit, automatic quantity, optional explicit override, applicable target geometry, unit price, and total; کیوبیک and قطعات آماده remain outside this processing workflow. Non-overridden quantities recalculate with their geometry and targets. An explicit override remains unchanged after a relevant change, shows the current automatic comparison, and blocks final save until the user confirms the override or resets it to automatic; changing the catalog item creates a new selection without the old override. Legacy rows with one finishing are read as a one-entry collection without rewriting saved data; finalized historical contracts change shape only through an authorized explicit edit and save while retaining financially identical pre-save outputs.
_Avoid_: implementing a different finishing shape for each supported product family, replacing cumulative operations with one finishing field, calculating a remaining-stone child's finishing from its parent, enabling cutting-workflow finishing on کیوبیک and قطعات آماده, silently replacing an explicit override, allowing a stale override through final save without confirmation, carrying an override to a different catalog item, silently migrating stored contracts, or changing historical totals merely by opening or printing a contract

**سازگاری پرداخت‌های محصول قرارداد**:
Explicit catalog-owned rules describing which stone-finishing operations may coexist on one contract product. Contract selection blocks a newly incompatible combination with its reason, while a later catalog-rule change does not rewrite finalized history; an authorized edit exposes any current conflict and requires resolution before save.
_Avoid_: inferring incompatibility from names, hard-coding different compatibility rules in each product UI, removing historical processing after a catalog change, or saving a newly edited row with an unresolved conflict

**مقدار دستی ابزار محصول قرارداد**:
An explicit user quantity that replaces geometry-derived ابزار meterage for طولی, main پله, لایه پله, اسلب, or a remaining-stone child. After relevant geometry or target changes, the manual value remains visible beside the new automatic value and blocks final save until confirmed or reset; replacing the ابزار catalog item clears the old override.
_Avoid_: silently recalculating an explicit tool override, accepting it after geometry changes without renewed confirmation, or transferring it to another tool

**ویرایش ردیف سنگ پله**:
Editing from the contract list opens the clicked stair product row as an individual row edit, preserving its exact stair part type and details without loading sibling rows from the same stair system.
_Avoid_: opening کف پله when the clicked row is خیز پله, or rebuilding every row that shares the same stairSystemId when the user edits one row

**لبه‌های ابزار پله**:
For stair product tools on کف پله, خیز پله, and پاگرد, جلو and عقب are the long horizontal span of the stair part, while چپ and راست are the short side edges based on the stair part's عرض/depth. The stair UI's طول field is the main horizontal span used by جلو and عقب.
_Avoid_: calculating جلو from عرض/depth, or calculating چپ and راست from the main طول span

**مرز برش و ابزار پله**:
Geometry-driven stair cuts such as برش طولی and برش عرضی are برش rows, not ابزار rows. ابزار is reserved for user-selected edge operations such as نیم لول.
_Avoid_: storing or printing automatic stair cuts as ابزار, automatically selecting a cutting catalog item as an ابزار, filtering real user-selected ابزار only because its name contains برش, or showing the same physical cut once as برش and again as ابزار

**متراژ برش خودکار سنگ پله**:
For a stair part cut from a wider and/or longer source stone, paid برش طولی follows the actual requested stair pieces produced, while برش کالیبر remains one extra paid longitudinal side cut per consumed source stone. Paid برش عرضی follows the full source width for each consumed source stone when the standard/source length is shortened to the requested actual length.
_Avoid_: charging stair برش طولی only once per source stone when multiple requested pieces are produced from that source, charging برش عرضی only across the requested piece width, or changing material pricing/base-stone count while correcting cutting meters

**کل دور ابزار پله**:
For stair product tools, کل دور means all four stair-part edges: جلو، عقب، چپ، and راست.
_Avoid_: treating کل دور as only three edges, or excluding عقب from the perimeter

**بازمحاسبه ابزار پله**:
Existing saved or printed contracts keep their saved stair tool totals until the contract is opened for editing and saved again. New contracts and edited-resaved contracts calculate stair tool edges using the current لبه‌های ابزار پله rules.
_Avoid_: silently changing historical contract totals without an edit/save action

**باقی‌مانده عرضی سنگ پله**:
When a stair part is cut narrower than the source stone width, the usable remaining width is based on the requested pieces actually consumed from each source stone, not the maximum number of pieces that could theoretically be cut from that source width. Material pricing, base-stone count, and cutting-charge policy remain separate from this remaining-stone geometry.
_Avoid_: treating unrequested possible pieces as already consumed, hiding usable leftover width such as `20cm` from a `30cm` source when only one `10cm` stair piece was requested, or changing contract pricing just because remaining geometry is corrected

**باقی‌مانده طولی سنگ پله**:
When a stair part is shortened from a standard/source length to the actual requested length, the leftover length keeps the full source stone width for each consumed source stone. If the same row also has width cuts, the width leftovers belong only to the actual-length section, while the length leftovers remain separate full-source-width pieces.
_Avoid_: calculating the leftover-length piece only at the requested stair width, or merging width-side leftovers from the actual-length section with the full-width leftover-length section

**مصرف باقی‌مانده برای سنگ لایه**:
When سنگ لایه uses سنگ اصلی, compatible remaining pieces from the same stair part are consumed before charging any additional سنگ اصلی. Only the layer demand that cannot be supplied from those remaining pieces should count as new main-stone material.
_Avoid_: charging all same-stone لایه as fresh stone while usable same-part remaining pieces exist

**تعداد پارتیشن باقی‌مانده**:
The number of child pieces cut from the selected remaining stone geometry. It is validated by whether those pieces fit inside the remaining stone area, not by requiring one source remaining stone per child piece.
_Avoid_: treating partition quantity as the count of source remaining stones consumed

**تقسیم ظرفیت باقی‌مانده**:
A remaining-stone demand may be fulfilled by multiple physical pieces from the same remaining stone when the requested width fits the source width and the total requested area fits the available capacity.
_Avoid_: rejecting a demand only because its logical length is longer than one source piece when it can be split into valid physical pieces

**بازپخش تخصیص باقی‌مانده پس از ویرایش محصول منبع**:
When a source contract product is edited after its remaining stone has been allocated to child rows, the edit is one atomic change: the source and its remaining inventory are recalculated, then every existing child allocation is replayed in its original order against the new geometry. The edit succeeds only when every child still fits; otherwise nothing changes and the conflicting child allocations are identified.
_Avoid_: silently deleting child rows, partially applying the source edit, preserving stale consumed geometry, changing replay order, or making the user reconstruct allocations that still fit

**چرخه تخصیص محصولات باقی‌مانده**:
Creating, editing, or deleting a remaining-stone child uses the same atomic replay rule as editing its source product. An edited allocation keeps its original order, a new allocation is appended after existing children, and deleting a child regenerates the source remainder before replaying every surviving allocation; if replay fails, nothing changes and conflicts are identified.
_Avoid_: manually adding a deleted child's geometry back into the current remainder, patching only one child or one remaining piece, partially committing a replay, or maintaining separate allocation rules for create, edit, delete, and source edit

**باقی‌مانده ثانویه تخصیص**:
The reusable physical pieces left after creating a child from remaining stone belong to the original source row's canonical remaining-stone inventory. The child owns its finished geometry and operations but does not become the inventory owner of those secondary remnants.
_Avoid_: hiding secondary remnants under the child row, marking them consumed because they share source lineage, or creating a separate child-owned inventory chain

**برش چندمحوره محصول باقی‌مانده**:
When a child product reduces both the width and length of its selected remaining stone, its physical cutting truth contains separate longitudinal and cross breakdown entries with their own meters and costs. Their sum owns the cutting charge; a legacy single cut-type label is not the canonical description of the operation.
_Avoid_: recording only one axis, collapsing both axes into an ambiguous "both" label, or charging a combined amount without preserving its physical breakdown

**گروه هندسی موجودی باقی‌مانده**:
Identical remaining-stone pieces are presented as one inventory group that states dimensions and area per piece, available piece count, and total group area. Allocations consume one or more physical pieces from that group rather than treating the combined area as one rectangle.
_Avoid_: displaying total group area beside single-piece dimensions without quantity, calling an inventory group one stone, or hiding how many source pieces an allocation consumes

**پیش‌نمایش هندسی تخصیص باقی‌مانده**:
Before a remaining-stone allocation is committed, its preview shows the finished child pieces, consumed source-piece count, every resulting secondary-remnant geometry, and saw-kerf consumption when enabled. Consumed and remaining area totals support this physical preview but never replace it.
_Avoid_: previewing only aggregate area subtraction, using a different geometry calculation from transactional replay, or hiding the effect of saw kerf until after save

**افزونه‌های محصول ساخته‌شده از باقی‌مانده**:
A contract product created from remaining stone owns its own ابزار and پرداخت سنگ selections, quantities, and charges, calculated from that child product's geometry and quantity. It starts without add-ons and never inherits them implicitly from the source product; any future explicit copy action must create independently editable add-ons recalculated for the child.
_Avoid_: copying source-product add-on metadata or charges into the child, pricing a child from the source product's dimensions, or keeping copied add-ons linked to later source-product changes

**افزونه ارث‌رسیده قدیمی محصول باقی‌مانده**:
An ابزار or پرداخت سنگ value found only in a legacy remaining-child metadata snapshot is historical ambiguous data, not an intentional child-owned selection. Finalized contracts preserve that saved history unchanged; when the contract is edited, the value must be explicitly removed or adopted as a child-owned add-on recalculated from the child's geometry.
_Avoid_: rewriting finalized historical contracts, silently deleting legacy values, or silently converting inherited source-product metadata into intentional child charges

**قیمت محصول ساخته‌شده از باقی‌مانده**:
A contract product created from remaining stone has zero base material price because its stone was already charged through the source product. Its total contains only its own billable operations, such as newly required cutting, ابزار, and پرداخت سنگ, without inheriting the source product's حکمی percentage or material discount behavior.
_Avoid_: charging the same stone material twice, inheriting the source product's حکمی charge, discounting the child as newly sold base stone, or omitting new operations performed on the child

**بازمحاسبه افزونه پس از تغییر هندسه محصول باقی‌مانده**:
When the geometry of a remaining-stone child changes, its selected add-on identities and saved unit prices remain unchanged while geometry-derived tool lengths are recalculated. A manually entered پرداخت سنگ quantity is preserved when it still fits the new geometry; if it no longer fits, the save is blocked and the conflicting add-on is identified.
_Avoid_: silently clamping or deleting an add-on, silently changing its saved rate, preserving a stale geometry-derived tool amount, or committing a child geometry change with an invalid finishing quantity

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
The customer-facing product table separates physical length, physical width, متر طول, متر مربع, and meaningful count into distinct columns. Each measurement cell shows only the bare number because the unit is already named in the column header; تعداد is filled only when a separate count helps explain the row or when the row is count-priced.
The same structural columns are used in original, accounting, and workshop prints, but workshop removes price columns entirely instead of showing empty price cells.
طول and عرض values in print/PDF output are always normalized to meters and shown as numbers only; the unit belongs in the column header, such as طول - متر and عرض - متر. Centimeter-saved values are converted to meters before printing.
_Avoid_: combining طول and عرض into one ابعاد column, repeating unit labels inside متر طول، متر مربع، or تعداد cells, repeating one value across measurement and count columns, putting count in measurement columns when the pricing basis is another measurement, reintroducing price columns in workshop print, or mixing cm and m labels inside length/width cells

**حکمی**:
An explicit percentage-based price increase applied to a contract product when the product is marked as mandatory.
_Avoid_: printing or charging حکمی from a default percentage when the product is not explicitly marked mandatory

**برش حکمی**:
A mandatory product retains the physical calculation for every cut and charges the customer for its actual longitudinal cutting, while cross cutting remains non-billable. Workshop and remaining-stone truth include both cut types; customer, accounting, summary, and invoice totals include only the longitudinal cutting amount.
_Avoid_: zeroing all حکمی cutting charges, hiding either physical cut type, charging حکمی cross cutting, or treating the حکمی percentage as payment for longitudinal cutting

**هزینه فیزیکی برش و مبلغ قابل دریافت برش**:
هزینه فیزیکی برش ارزش محاسبه‌شده عملیات واقعی برای برنامه تولید و کنترل داخلی است؛ مبلغ قابل دریافت برش بخشی از همان عملیات است که طبق قواعد فروش از مشتری دریافت می‌شود. در محصول حکمی، عملیات و هزینه فیزیکی برش طولی و عرضی باقی می‌ماند؛ مبلغ برش طولی از مشتری دریافت می‌شود و مبلغ برش عرضی صفر است. خروجی‌های مالی نرخ و مبلغ ذخیره‌شده قرارداد را نشان می‌دهند، برش فیزیکی رایگان را با نرخ و مبلغ صفر نمایش می‌دهند و هیچ نرخ جاری کاتالوگ را هنگام چاپ جایگزین نمی‌کنند؛ خروجی کارگاه فقط حقیقت فیزیکی را بدون ستون مالی نگه می‌دارد. ردیف‌های خلاصه فقط وقتی ادغام می‌شوند که نوع و نرخ ذخیره‌شده یکسان باشد.
_Avoid_: استفاده از یک مبلغ مشترک برای حقیقت تولید و مبلغ فاکتور، حذف عملیات فیزیکی به دلیل رایگان‌بودن آن برای مشتری، صفرکردن مبلغ برش طولی حکمی، دریافت مبلغ برش عرضی حکمی، استفاده از هزینه فیزیکی عرضی در جمع قابل پرداخت، خالی‌گذاشتن مبلغ برش رایگان، میانگین‌گیری نرخ‌های متفاوت، یا قیمت‌گذاری مجدد قرارداد هنگام چاپ

**بازذخیره قیمت‌گذاری حکمی**:
Opening an existing contract for editing and saving it again applies the current حکمی pricing rule to the saved product rows.
_Avoid_: silently changing old saved contract pricing without an edit-save action, or preserving an old paid برش charge after a mandatory row has been edited and saved

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

**گزارش فروش**:
The comprehensive reporting surface inside the Sales workspace for analyzing sales contracts, pipeline, customers, products, payments, delivery commitments, and seller performance according to the viewer's permissions. Shared sales reporting is available to authorized sales users, while sensitive cross-seller and company-wide analysis is limited to managers and admins.
_Avoid_: treating it as a placeholder dashboard, maintaining separate reporting truths for Sales and BI, or exposing manager-only comparisons to ordinary sales users

**بخش‌های گزارش فروش**:
One comprehensive role-gated reporting page with persistent shared filters across نمای کلی، قراردادها، مشتریان و پروژه‌ها، محصولات و خدمات، پرداخت و وصول، تحویل و بارگیری، عملکرد فروشندگان, and خروجی گزارش. عملکرد فروشندگان is visible only within authorized Sales management scope, while every other section still obeys the viewer's contract-level reporting scope.
_Avoid_: separate pages that silently use different filters, exposing an inaccessible section through exports, or letting a tab change the permitted data scope

**سازنده خروجی گزارش فروش**:
A presentation-only builder for PDF and print output using the shared branded report layout. Users may select and reorder permitted sections, charts, tables, and columns; set title, subtitle or note, orientation, and page size; and save personal presets. Sales admins may publish department presets and global admins may publish company presets, but loading any preset re-applies the viewer's current data permissions at generation time.
_Avoid_: using contract-document templates for analytics, allowing a preset to carry broader data access, editing calculated values in the builder, or storing exported figures as user-entered truth

**لحظه داده گزارش**:
The explicit data time represented by a report. Interactive Sales and BI screens query current authoritative data, show their latest refresh time, and allow manual refresh; starting PDF, Excel, or print output freezes one consistent authorized snapshot so its totals, charts, and detail tables cannot change independently during generation.
_Avoid_: presenting cached data as current without a timestamp, mixing results from different refreshes in one export, or allowing a long-running export to combine records from different moments

**کامل‌بودن داده گزارش**:
The explicit distinction between confirmed zero, an unrecorded unknown value, a source with no usable record, and data hidden by permission. Partially connected cross-workspace metrics show their coverage, such as how many authorized contracts have Accounting receipt data, instead of silently treating missing records as zero.
_Avoid_: inventing zero from missing data, revealing hidden values through summaries, treating unavailable source data as a negative business outcome, or presenting a partial metric without its coverage

**نمودار فارسی گزارش‌ها**:
An RTL-aware chart shared by Sales Reports and BI whose Persian title, legend, tooltip, labels, numbers, currency, and Jalali dates remain readable. Chronological charts place the oldest period on the right and the newest on the left, with comparison series aligned in the same direction. Long Persian customer, project, product, and seller labels must wrap, abbreviate with an accessible full label, or use a horizontal layout instead of clipping or overlapping.
_Avoid_: applying RTL only to the surrounding card, leaving BI charts with LTR internals, reversing time direction inconsistently between charts, Latin-only digits or Gregorian labels without context, color-only status meaning, unreadable rotated Persian text, or legends and tooltips detached from their data

**جزئیات تعاملی نمودار گزارش**:
The permission-preserving drill-down opened from a meaningful chart bar, point, status, customer, product, or seller. It carries the report's active filters plus the visibly selected datum into a detailed table or drawer, explains the resulting scope, and offers links only to source records the viewer may already access.
_Avoid_: a decorative chart with no path to evidence, a hidden filter that users cannot understand or clear, opening unfiltered records, or using chart interaction to bypass contract-level authorization

**مرز گزارش فروش و هوش تجاری**:
Sales Reports is the comprehensive operational and performance report for the Sales workspace. BI remains an authorized cross-workspace analysis surface and reuses the same RTL chart and formatting foundation instead of maintaining a visually inconsistent reporting implementation or becoming a second source of Sales metric truth.
_Avoid_: duplicating Sales calculations independently in BI, redesigning only Sales charts while leaving BI effectively LTR, or turning the Sales report into a company-wide BI bypass

**دامنه داده گزارش فروش**:
An ordinary Sales user sees reporting derived only from contracts they created, while Sales managers and admins may analyze other sellers within their permitted management scope and global admins may analyze the whole company.
_Avoid_: letting an ordinary Sales user see other sellers' contracts, customer/product results derived from those contracts, seller comparisons, or company-wide totals

**دسترسی مدیریتی گزارش فروش**:
Restricted Sales reporting is granted by Sales workspace `admin` permission, with global admins receiving company-wide access. A manager title or access to another workspace does not by itself grant seller comparisons or broader Sales data.
_Avoid_: hard-coding sensitive report access only to a generic manager role, or allowing management authority from an unrelated workspace to expand Sales visibility

**BI فروش**:
A native business-intelligence workspace for analyzing sales-contract performance from sales-owned data such as contracts, payments, customers, products, delivery status, discounts, and seller performance.
_Avoid_: treating it as an embedded external BI tool or as a company-wide analytics workspace

**فروش قطعی در BI فروش**:
The sales value counted as realized sales in BI, limited to sales contracts whose status is `SIGNED` or `PRINTED`.
_Avoid_: counting draft, pending, approved, cancelled, or expired contracts as realized sales

**وضعیت قرارداد در گزارش فروش**:
The actual lifecycle status of a sales contract, shown with a Persian label and a short explanation of what has happened and what is expected next. Reporting buckets such as pipeline, realized, and lost group contracts for analysis but do not replace or hide their real statuses.
_Avoid_: showing only a vague reporting bucket, or presenting an aggregated category as though it were the contract's exact workflow status

**بازه زمانی گزارش فروش**:
Sales reporting defaults to the current Jalali month and supports today, yesterday, the last seven days, current Jalali quarter and year, the last twelve months, and a custom Jalali range, with comparison to the immediately preceding equal-length period. Realized, pipeline, and lost sales enter a period using their respective signing, creation, and cancellation or expiry business dates.
_Avoid_: mixing lifecycle dates inside one metric, using rolling timestamps where a complete calendar period is intended, or comparing unequal periods without saying so

**حقیقت‌های مرتبط در گزارش فروش**:
Sales Reports may place contract value, payment promises, accounting receipts, logistics delivery, and Security-recorded exit together, but each fact retains its owning workspace and is labeled as planned, confirmed, loaded, delivered, or exited. Sales owns contract value, discount, payment plan, and promised delivery; Accounting owns actual receipts and receivables; Logistics owns actual loading and delivery; Security owns physical exit time.
_Avoid_: treating a payment plan as received money, a promised delivery as physical delivery, or a finalized loading as proof that the vehicle exited

**گزارش عملکرد فروشنده**:
A permission-scoped Sales report for one seller, with ordinary Sales users fixed to themselves, Sales workspace admins able to select sellers in their management scope, and global admins able to select departments and sellers company-wide.
_Avoid_: giving ordinary Sales users a selector for other sellers, or calculating seller performance from contracts outside the viewer's permitted scope

**مسئول فروش قرارداد**:
The seller commercially responsible for a Sales Contract, distinct from the user who entered it. A contract converted from a potential project defaults to that project's responsible seller; otherwise it defaults to its creator, and manager-authorized reassignment requires an audit reason.
_Avoid_: treating technical data entry as sales ownership, silently changing ownership, or losing the CRM project owner during conversion

**اعتبار فروش قطعی فروشنده**:
The seller who receives realized-sales performance credit, snapshotted from the contract's responsible seller when the contract first becomes `SIGNED` or `PRINTED`. Pipeline follows current responsibility, but later reassignment does not rewrite historical realized performance.
_Avoid_: recalculating historical seller credit from current ownership, or crediting the creator when another seller owned the commercial work

**انتساب قدیمی فروشنده قرارداد**:
The migration state for Sales Contracts created before explicit contract responsibility and realized-credit snapshots existed. A CRM-linked contract uses the seller at conversion only when CRM history can establish it reliably; otherwise its creator becomes the current operational owner and is labeled as a migrated initial value. Unverifiable realized credit remains in فروش قطعی تخصیص‌نیافته قدیمی until a Sales admin assigns it with an audit reason, while company and department totals still include its value.
_Avoid_: treating a mutable current CRM owner as historical proof, silently crediting the creator for legacy realized sales, excluding unassigned legacy sales from aggregate totals, or resolving historical attribution without an audit reason

**شاخص‌های عملکرد فروشنده**:
Seller performance is a transparent set of contract creation, pipeline, realized sales, realization time, lost outcomes, customer mix, product/service mix, and period-comparison metrics rather than one composite score. Seller discount behavior and cross-seller comparison are restricted to manager/admin reporting, while accounting and delivery outcomes remain contextual unless Sales responsibility is defined separately.
_Avoid_: an opaque performance score, penalizing sellers for downstream work they do not own, or exposing sensitive comparisons to ordinary Sales users

**نرخ موفقیت قراردادهای تعیین‌تکلیف‌شده**:
The share of contracts reaching `SIGNED` or `PRINTED` among contracts that reached either a realized outcome or `CANCELLED`/`EXPIRED` during the selected period. Draft and active pipeline contracts are excluded, and CRM potential-project conversion remains a separately labeled metric.
_Avoid_: calling open pipeline a failure, dividing by every newly created contract, or mixing CRM opportunity conversion with Sales contract outcomes

**تعدیل فروش قطعی**:
A dated positive or negative change to an already realized Sales Contract that preserves the original realized amount and date while recording the correction or cancellation delta in the period when it becomes effective. Gross realized sales and dated adjustments are shown separately and combine into net realized sales without silently rewriting closed periods.
_Avoid_: replacing the original amount in historical reports, counting both the current mutable contract total and its adjustment, or inferring adjustments from the current amount without an authoritative change record

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

**فیلتر دیروز در BI فروش**:
A BI sales period preset for the complete previous calendar day in Tehran/Jalali terms, shown as دیروز beside امروز. Its comparison period is the day before yesterday, not a rolling previous 24-hour window.
_Avoid_: calculating دیروز as the last 24 hours or comparing it to an unrelated date range.

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

**دارای رکورد مالی**:
A sales contract qualifies as دارای رکورد مالی only while it has at least one currently valid financially approved invoice record in `ISSUED` or `POSTED` state. Draft and voided records do not qualify, and an unapproved replacement qualifies only after financial approval; the corresponding filter follows this factual rule even when a higher-priority primary badge such as نیازمند اصلاح is displayed.
_Avoid_: treating draft creation as financial approval, counting voided records, hiding an urgent correction behind this badge, or excluding a valid approved invoice from the filter because another primary status is displayed

**تاریخ فاکتور سیستمی**:
The Sepidar/system invoice date entered by accounting during financial approval. It may be today, up to ten days in the past, or up to thirty days in the future.
_Avoid_: treating future system invoice dates as invalid when they are within the accounting forward-entry window

**حذف پیش‌نویس رکورد مالی**:
An accounting financial record may be physically deleted only while it is still a draft and has not been financially approved, while keeping an audit trail of the deletion. Issued, posted, financially approved, or otherwise submitted records are not deleted; they are voided or corrected through accounting workflows.
_Avoid_: deleting financially approved accounting records, or keeping undeletable draft clutter when a new draft should be regenerated

**درخواست اصلاح حسابداری**:
A correction request created by accounting when a sales contract or related accounting data needs correction. It moves from manager review, to an approved sales correction window when allowed, to accounting review of the corrected contract, and finally to resolution or cancellation.
_Avoid_: accounting silently editing the commercial contract, or treating a requested correction as permission for sales to edit before manager approval

**پرچم حسابداری**:
An internal accounting risk or review marker attached to a sales contract. An open blocker flag prevents financial approval but permits preparatory and read-only accounting work; an authorized accounting user closes a flag with a mandatory resolution note, and may cancel an open mistaken flag with a mandatory cancellation reason.
Resolved and cancelled flags remain in auditable history and are not reopened; a recurring concern becomes a new flag.
_Avoid_: treating a flag as a sales correction request, deleting or reopening it after review, or leaving it without a closable lifecycle

**اصلاح حسابداری پس از تایید مالی**:
A correction request after financial approval can reopen a locked sales contract for a controlled sales correction only after manager approval. The existing financially approved record remains immutable and accounting owns any void, reversal, correction, review, and replacement approval needed after the sales correction.
_Avoid_: editing the approved financial record directly, or treating manager-approved sales correction as accounting approval of the replacement financial result

**رکورد مالی جایگزین پس از اصلاح**:
When a corrected sales contract changes the financially approved amount, the old approved financial record remains historical and is voided or reversed, while accounting creates and approves a new financial record from the corrected contract amount.
_Avoid_: editing the old approved record amount in place, or resolving the correction request before accounting confirms the replacement financial result

**شاهد ابطال مالی خارجی**:
When a financially approved Sabalan record has already been registered in Sepidar or another external accounting system, voiding it in Sabalan requires an accountant-entered reason and external cancellation, reversal, or correction reference.
_Avoid_: marking an externally registered financial record as voided in Sabalan without preserving what happened to the external accounting document

**وابستگی‌های ابطال رکورد مالی**:
Voiding a financially approved invoice must account for downstream receivables, receipts, checks, and tax submissions tied to that invoice. Simple replacement is allowed only when downstream records are absent or safely closable; received payments, checks, or submitted tax records require explicit accounting correction evidence before the correction is closed.
_Avoid_: silently deleting or rewriting downstream accounting records when an approved invoice is voided

**بستن اصلاح مبلغ پس از تایید مالی**:
A price-changing correction request after financial approval is closed only after the old approved invoice is voided or reversed with external evidence, a replacement invoice candidate is created from the corrected contract amount, that replacement is financially approved, and downstream accounting dependencies are handled or documented.
_Avoid_: resolving the correction immediately after sales saves the contract edit, or before the replacement financial result is approved

**وضعیت محاسبه‌شده اصلاح مالی**:
After sales saves a post-approval correction, the correction request may remain in `SALES_EDITED` while accounting progress is derived from related financial records: whether the old approved invoice is voided, whether a replacement invoice candidate exists, whether it is financially approved, and whether downstream dependencies are handled.
_Avoid_: adding a new persisted correction-request status for each accounting sub-step when the related records already express that state

**پیوند رکورد مالی جایگزین**:
A replacement invoice candidate created after a post-approval correction is explicitly linked to the correction request and to the old financial record it replaces. Its identity is separate from the original full-contract invoice candidate so accounting can create one replacement for the corrected contract amount without reusing the old invoice candidate.
_Avoid_: using the original contract-level invoice idempotency key for replacement records, or leaving the replacement record disconnected from the correction that required it

**شماره فاکتور سیستمی رکورد مالی جایگزین**:
A replacement invoice candidate may reuse the Sepidar/system invoice number of the old voided invoice only when it is explicitly linked as replacing that old financial record. Unrelated invoices must still have unique system invoice numbers.
_Avoid_: allowing duplicate system invoice numbers across unrelated invoices, or forcing a replacement invoice to receive a different number from the voided invoice it replaces

**اختیار ابطال و جایگزینی رکورد مالی**:
Voiding an approved financial record and financially approving its replacement require manager-level accounting authority, expressed through accounting approve/void permission rather than a hard-coded role name. Normal accounting users may request corrections and prepare allowed drafts, but sales users never void or replace accounting records.
_Avoid_: allowing every accountant to void approved records, or coupling the authority only to one role label instead of the accounting permission model

**راهنمای جایگزینی رکورد مالی**:
For a post-approval correction whose saved sales edit changed the approved amount, the accounting contract detail page guides accounting through voiding the old financial record, creating the replacement draft, financially approving the replacement, and then closing the correction. Each step is enabled only when the previous accounting truth is complete.
_Avoid_: exposing only generic accounting buttons that leave accountants guessing which correction step is currently allowed

**تشخیص اثر مبلغی اصلاح**:
Whether a post-approval sales correction changed the approved financial amount is determined automatically by comparing the old approved financial record amount with the current corrected contract amount in ریال, using the same accounting total calculation used for invoice candidate creation.
_Avoid_: asking accountants to manually classify whether a corrected contract changed the financial amount, or comparing formatted display text

**اصلاح بدون اثر مبلغی پس از تایید مالی**:
When a post-approval correction does not change the approved financial amount, the old approved financial record remains valid and accounting may close the correction after manager-level review and a resolution note. If the non-amount change affects customer identity, tax, Sepidar, or external documents, accounting records the needed evidence or note without recreating the invoice unless the external document itself must be corrected.
_Avoid_: forcing invoice void and replacement for every corrected contract when the approved amount did not change

**تایید مالی با اصلاح باز**:
Accounting financial approval is blocked while a contract has an open or acknowledged pre-approval correction request. Accounting must review and resolve the correction request before financially approving the invoice candidate.
_Avoid_: financially approving and locking a contract while a requested sales correction is still unresolved

**رسیدگی به اصلاح حسابداری**:
After sales edits a contract for a pre-approval correction request, the request remains open until accounting manually reviews the corrected contract and resolves it with an optional resolution note.
_Avoid_: adding a separate handoff status before the workflow needs it, or auto-resolving a correction request merely because the contract was edited

**بررسی اصلاحات حسابداری**:
The manager-level accounting review of whether an accounting correction request may open a controlled sales contract correction window. The authority belongs to accounting workspace admin permission, with global administrators included.
_Avoid_: hard-coding review authority only to a role name, or allowing normal accounting edit permission to approve sales unlocks

**رد اصلاح حسابداری**:
A manager decision that closes a correction request without opening sales editing, while preserving the existing contract and financial record states. The decline reason is part of the accounting audit trail.
_Avoid_: unlocking the contract after a declined review, or changing the financial record just because the request was declined

**عملکرد حسابدار**:
An operational accounting metric for how quickly and consistently an accountant performs auditable accounting workflow actions, measured from accounting records and audit events rather than browser presence.
_Avoid_: treating accountant performance as hidden activity tracking, keystroke monitoring, or time spent with a page open

**ویرایش مرحله‌ای قرارداد فروش**:
Editing a sales contract uses the same step-based contract workflow as creation, with prefilled saved contract details and direct access to any step that may need correction.
_Avoid_: a separate simplified edit form, or forcing linear navigation during edit

**پنجره اصلاح قرارداد فروش**:
A controlled sales-edit opportunity tied to an approved accounting correction request. It allows sales to use the normal full step-based contract edit flow with the correction category and accountant note visible, save one correction edit, and then return the contract to the accounting lock until accounting reviews the corrected contract.
_Avoid_: leaving a previously locked contract generally editable, or trying to field-lock contract editing by correction category

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

**مشخصات مشتری و پروژه چاپی**:
The compact customer and project identity shown in customer-facing and accounting contract output. It includes the saved project name and address as separate two-column fields, while long project addresses wrap within their field; workshop output remains a separate minimal identity view.
_Avoid_: omitting the saved project name, giving the project name or address an otherwise unnecessary full-width row, or expanding workshop output with the full customer/project section

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
In the new-loading project picker, only projects with at least one positive مانده بارگیری group are shown. Existing draft or historical loading records for a project with no current remaining stay accessible through the loading list for edit, cancellation, or history.
_Avoid_: forcing logistics users to know the project name when the operational clue they have is a phone number, showing non-loadable projects in the new-loading flow, or offering projects for a new loading when logistics has no remaining physical cargo to select

**شروع پیش‌نویس بارگیری**:
A draft بارگیری starts when logistics selects the customer project, so the in-progress shipment can be resumed before rows, driver, or vehicle details are complete.
Customer search before project selection is only navigation/filtering and does not start a draft.
The new-loading wizard sequence is مشتری، پروژه، قراردادها، راننده، مقدار، بازبینی so حراست can authorize driver entry after cargo identity is known but before final loaded quantities are entered.
_Avoid_: treating بارگیری creation as only the final submit action, or keeping meaningful loading progress as a browser-only form

**ادامه پیش‌نویس بارگیری**:
When logistics selects a project that already has an active draft بارگیری, the normal path resumes that draft; creating another active draft for the same project is an explicit exception for simultaneous operational loading.
_Avoid_: silently creating duplicate active drafts for the same project during ordinary loading creation

**مانده بارگیری**:
The remaining amount for logistics is calculated from eligible contracted amounts minus finalized بارگیری amounts, within compatible contract-row/product groupings.
Accounting financial approval is an eligibility gate for which contract rows may enter logistics, but it is not the quantity source for the remaining calculation.
The eligible contracted amount must be the contract row's true deliverable quantity in its loading unit, such as متر طول for longitudinal rows, متر مربع for area rows, or the sold ton/count quantity for tonnage and count rows.
_Avoid_: using برنامه تحویل, draft accounting financial records, unapproved invoice candidates, sales approval, signature, print state, draft بارگیری, unrelated product rows, or a generic row quantity field that does not represent the row's physical deliverable amount as the source of truth for physical remaining

**گروه مانده بارگیری**:
A logistics display grouping that combines remaining amounts only for contract rows with identical logistics-relevant product specs, while preserving access to the individual source contract rows inside the group.
_Avoid_: losing contract-row traceability when showing a grouped remaining amount, or grouping rows whose physical loading specs differ

**خلاصه گروهی بارگیری**:
The مقدار step may show identical selected rows as one grouped summary for readability, but quantity entry for a group with multiple source contract rows stays per source row. The grouped line shows a live summed total and a جزئیات view for the per-contract quantities.
_Avoid_: accepting one grouped total that the system silently splits across source contracts

**جزئیات محصول در بارگیری**:
The product details shown while preparing a بارگیری are production/logistics identifiers: product name and type, deliverable remaining amount and unit, dimensions, quantity, ابزار, پرداخت سنگ, selected services or cuts, and row notes when they help identify what is being shipped.
_Avoid_: showing price, discount, payment, accounting information, or source/consumed-stone explanation rows in the logistics loading workflow

**انتخاب ردیف برای بارگیری**:
In the new-loading wizard, selecting contract product rows only marks them as candidates for the بارگیری. Quantity entry and validation happen later in the مقدار step.
_Avoid_: mixing product-row selection with loaded-quantity entry in the contract inspection step

**مقداردهی بارگیری**:
Selected rows enter the مقدار step grouped by selected driver. The logistics operator enters the amount each driver carries for each selected row; blank or zero means that driver does not carry that row. A row is valid only when its summed allocation across drivers is positive and within remaining/tolerance rules, and each selected driver must carry at least one positive allocation.
_Avoid_: automatically defaulting a selected row to its full remaining amount, finalizing a selected row with no carried quantity, or selecting a driver who carries nothing

**تخصیص منبع بارگیری**:
When a grouped remaining line contains multiple source contract rows, the logistics user manually chooses how much the بارگیری consumes from each source row before finalization.
_Avoid_: automatically consuming contract rows behind the user's back, even when the grouped remaining amount is compatible

**خط راس بارگیری**:
A logistics calculation input for length-based loading that represents the common or average piece length used with a piece count to calculate loaded متر طول. In multi-driver loading, خط راس, تعداد, اضافه, and کسر belong to each driver-row allocation, and product-row totals are summed from those allocation calculations.
_Avoid_: treating خط راس as a contract dimension, product catalog field, or separate unit of measure

**اضافه و کسر بارگیری طولی**:
Manual length adjustments applied to a length-based بارگیری calculation after خط راس × تعداد: اضافه increases the loaded متر طول and کسر decreases it.
_Avoid_: hiding these adjustments inside the final amount without preserving how the logistics user calculated it

**تلورانس بارگیری طولی**:
A finalized length-based بارگیری may exceed the current remaining متر طول by up to 0.5m with a warning; under-loading is allowed because it leaves remaining for later shipment.
_Avoid_: blocking small length-based overages caused by normal loading variance, or applying the 0.5m tolerance to unrelated units without a separate business decision

**وضعیت بارگیری**:
Only finalized بارگیری records reduce logistics remaining amounts. Draft بارگیری records are editable preparation records, and cancelled بارگیری records stay in history without reducing remaining.
Draft بارگیری records support normal preparation CRUD before finalization, including updating notes, rows, quantities, source allocations, and selected driver/vehicle pair, and cancelling or deleting the draft when it should not proceed.
After project selection starts or resumes a draft, wizard changes are saved on step transitions and by the explicit ذخیره پیش‌نویس action; finalization saves the draft first and then finalizes it.
_Avoid_: reducing remaining from draft loading entries, deleting cancelled logistics history, or using draft CRUD semantics for finalized loading records

**انتخاب راننده بارگیری**:
حراست sends a physically present queued driver into the loading area through ورود برای بارگیری, making that queue turn visible to Logistics as an available loading driver. Logistics may then select one or more available loading drivers for a draft بارگیری; selecting a driver reserves that queue turn for the draft.
At least one available loading driver must be selected before Logistics can continue to مقدار or finalize the loading.
While the loading remains a draft, Logistics may return to the راننده step to add or remove selected drivers. Added drivers become رزرو شده, removed drivers return to وارد محوطه بارگیری, and finalized driver evidence is locked.
Logistics does not see available loading drivers as a queue-ranked list; it chooses based on operational suitability such as driver identity, plate, and vehicle type. Drivers reserved for another draft remain visible but disabled with the reserved loading number.
_Avoid_: showing every registry-active driver to logistics, letting logistics select drivers who are still merely waiting in the حراست queue, requiring a system request from Logistics before حراست can send drivers into loading, or letting logistics manage the registry or queue from بارگیری

**راننده آماده بارگیری**:
A driver queue turn that حراست has moved from در انتظار to وارد محوطه بارگیری. The driver is physically allowed toward loading and is visible to Logistics, but is not attached to a specific بارگیری until Logistics selects it.
_Avoid_: treating وارد محوطه بارگیری as a reservation for a particular loading draft, or treating every waiting queued driver as available to Logistics

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
Logistics selects the driver and vehicle for بارگیری only from queue turns that حراست has already moved into وارد محوطه بارگیری, while every بارگیری still saves its own driver and vehicle snapshot for historical accuracy.
One بارگیری may include multiple driver/vehicle queue turns when one delivery needs more than one vehicle. Loading quantities are allocated per selected driver, and the loading's product-row totals are derived from the sum of those driver allocations.
_Avoid_: letting logistics own the reusable driver registry, making old loading documents depend on the current editable driver profile, treating gate approval as approval of loading quantities, or recording multi-driver loading quantities without preserving which driver carried which allocation

**راننده در نهایی‌سازی بارگیری**:
A draft بارگیری may exist without driver information, but finalization requires a complete driver and vehicle snapshot.
If an older draft contains manually entered driver or vehicle data, that data may remain as draft history, but finalization requires reselecting an active حراست-owned driver/vehicle pair so the final snapshot comes from the registry.
_Avoid_: blocking early loading preparation only because the truck is not known yet, finalizing shipment evidence without driver details, or treating legacy manual draft data as an acceptable final driver selection

**ثبت راننده و خودرو**:
A حراست-owned registry of reusable fixed driver/vehicle pairs that may be activated or deactivated for operational use. A complete pair requires the driver's first name, last name, mobile, national code, home address, relative's mobile, vehicle plate and type, plus at least one categorized photo each of the driver's license, vehicle card, and driver; every category may contain additional photos without a count limit.
An active registry pair has valid credentials and may join the driver queue, but registry activation alone does not make it selectable by Logistics.
A never-used pair may be permanently deleted; once referenced by an operational record it may only be deactivated, and its historical snapshots remain unchanged by later registry edits.
_Avoid_: رجیستر راننده و خودرو, treating registry activation as current physical presence, splitting the reusable registry into independent driver and vehicle lifecycles, allowing incomplete pairs into operational use, duplicating reusable driver/vehicle records inside logistics, keeping logistics create/edit/delete controls for the registry, hard-deleting a used pair, or changing historical shipment snapshots when the registry changes

**صف نوبت‌دهی رانندگان**:
A حراست-owned time-ordered queue of registry-active driver/vehicle pairs that are physically present and waiting for loading. Queue presence makes a pair selectable by Logistics, while entry time determines display priority rather than restricting selection because a product may require a specific driver or vehicle.
Queue priority is shown in حراست's waiting queue, not as ordering guidance in Logistics. Drivers returned from وارد محوطه بارگیری back to در انتظار appear first to preserve their turn rights.
_Avoid_: راننده فعال for a merely present driver, treating FIFO as a hard selection rule, manually reordering entry priority, or exposing absent registry drivers to Logistics

**نوبت راننده**:
One historical occurrence of a registry-active driver/vehicle pair joining the queue. Its statuses are در انتظار, وارد محوطه بارگیری, رزرو شده, اعزام شده, and خارج از صف; حراست moves a waiting turn into the loading area through ورود برای بارگیری, Logistics may reserve an available loading turn for a draft بارگیری, releasing a loading reservation returns the same turn to وارد محوطه بارگیری, and an explicit حراست removal ends it as خارج از صف.
The same pair cannot hold two current turns, but may receive a new turn after dispatch or after leaving and physically returning.
حراست may also return a driver from وارد محوطه بارگیری back to در انتظار when the driver should no longer be in the loading area; that turn keeps priority rights and appears first among waiting turns. This rollback requires a short reason, with preset choices for common reasons such as بارگیری آماده نبود, اشتباه در ورود, تغییر برنامه بارگیری, and راننده موقتاً برگشت به صف.
حراست cannot return a رزرو شده turn directly to در انتظار; Logistics must first release it from the draft so it returns to وارد محوطه بارگیری.
_Avoid_: calling reservation release a cancellation, overwriting an earlier turn when a driver returns, allowing one turn to be reserved by multiple loadings, returning a Logistics-released loading driver all the way to در انتظار, or losing original queue priority when a draft releases its reservation

**خودرویی حراست**:
The حراست vehicle area is a workflow hub whose ordered operational tabs are تردد خودرو, تراکنش خروجی, تراکنش ورودی, نوبت‌دهی رانندگان, and ثبت راننده و خودرو, while shared counters may remain on a dashboard.
_Avoid_: combining reusable registry maintenance, gate movement history, inbound loaded-vehicle work, and outbound sales exit recording into one large data-entry page

**تردد خودرو**:
A حراست-owned gate movement record for a vehicle entering or leaving the facility, including its exact gate time and movement purpose.
_Avoid_: treating تردد خودرو as the same document as بارگیری, or using gate movement approval to validate contract rows or loaded quantities

**تردد متفرقه**:
A one-time حراست gate movement for a driver/vehicle that should be recorded for entry or exit history without becoming an active reusable driver/vehicle pair for logistics.
_Avoid_: cluttering the reusable driver/vehicle registry with every one-time supplier, customer, or visitor movement

**خروج با سواری شخصی مشتری**:
A lightweight outbound sales movement where the customer takes goods with a personal vehicle. It must be tied to the customer or linked بارگیری/project and must record the exact exit time, without requiring a reusable driver/vehicle pair.
_Avoid_: forcing customer personal vehicles into the reusable logistics driver/vehicle registry, or requiring freight settlement fields for a customer pickup

**زمان خروج فروش**:
The official outbound sales exit time is the حراست-recorded gate time when the vehicle physically leaves. It is separate from the logistics بارگیری finalization time.
_Avoid_: treating logistics finalization time as proof of physical gate exit

**وضعیت خروج فروش**:
An outbound sales movement is آماده خروج after logistics finalizes بارگیری, خارج شد after حراست records the physical gate exit time, and لغو خروج when the gate movement is voided because it was created by mistake or the vehicle did not leave.
_Avoid_: adding an approved-for-loading status that makes حراست responsible for logistics loading correctness

**ورود خودروی پر**:
A حراست inbound loaded-vehicle movement whose purpose is one of خرید بیرونی, برگشت از فروش, or امانی.
_Avoid_: recording inbound loaded cargo without a movement purpose, or mixing inbound loaded-vehicle purposes with outbound sales loading

**وضعیت ورود خودروی پر**:
An inbound loaded-vehicle movement is ثبت ورود when the entry time is recorded, تکمیل اطلاعات when required follow-up details such as documents, settlement, or attachments have been completed, and لغو ورود when the entry record is voided as a mistake.
_Avoid_: deleting inbound gate history to correct mistakes, or treating an incomplete paperwork state as if all entry evidence has been captured

**تسویه بارنامه ورود**:
Trip-specific settlement information captured on an inbound loaded-vehicle movement, including the delivery price and bank/card owner details needed for بارنامه settlement.
_Avoid_: storing trip-specific settlement truth only on the reusable driver/vehicle registry, or making settlement history depend on later registry edits

**پیوست تردد**:
A categorized photo or file attached to a حراست gate movement, such as vehicle/plate, driver/document, بارنامه, purchase invoice, cargo, or other evidence.
_Avoid_: storing gate photos as uncategorized blobs that cannot later be filtered or audited by evidence type

**گزارش شیفت حراست**:
An append-only operational log for one planned security shift, made of immutable گزارش لحظه‌ای rows and گشت‌زنی sessions. Ending a shift remains a deliberate closure action, but the main shift content lives in timestamped log entries rather than one free-text summary form.
New entries and patrols are recorded only against the currently active planned shift session for the authenticated security user in the first version; manager backfill is intentionally out of scope.
_Avoid_: گزارش سرپرست, deleting log rows, forcing duplicate final-summary text when the log already records the shift, or hiding patrol sessions inside unstructured notes

**افراد مرتبط در گزارش لحظه‌ای حراست**:
The reporter of a گزارش لحظه‌ای is always the authenticated security user who owns the active shift session, but the related people attached to the report are active organizational personnel. New report participants should support پرسنل سازمانی, including people without a system login, while old user-based participants remain visible for historical compatibility.
_Avoid_: limiting related people to users with login accounts, changing the report author into a personnel record, or losing old user-based participant history during migration.

**نوع گزارش لحظه‌ای حراست**:
A manager-defined active/inactive category for shift log rows, with name, optional description, and display order. It classifies a mandatory timestamped گزارش لحظه‌ای description without adding severity or workflow behavior yet.
Report types are managed in تنظیمات حراست, a workspace-local manager/admin page for حراست-owned settings.
When a report type is selected in the create form, its configured description appears as helper text below the dropdown. Shift log lists, history, and detailed PDFs show the report type name and configured type description separately from the guard-written event description; empty type descriptions are omitted.
_Avoid_: hard-coded report type dropdowns, optional row descriptions, treating type configuration as patrol workflow rules, or merging the configured type description with the actual event description.

**دسته‌بندی گزارش لحظه‌ای حراست**:
A manager-defined parent grouping for instant report types. It helps guards first choose the operational area of the event before selecting the specific نوع گزارش لحظه‌ای.
Categories have manager-controlled name, optional description, display order, and active/inactive state; inactive categories are hidden from new guard report entry while historical reports remain readable.
_Avoid_: using دسته‌بندی as the final report type, making it free text during report entry, deleting categories to hide old history, or mixing it with severity/approval state

**نوع گزارش لحظه‌ای حراست - دسته‌بندی‌شده**:
A manager-defined active/inactive type inside one دسته‌بندی گزارش لحظه‌ای, with name, optional description, and display order. Existing uncategorized types should be migrated into a default عمومی category until managers reorganize them.
If the parent category is inactive, its types are hidden from new گزارش لحظه‌ای creation even when the type itself is active; managers can still see and edit them in settings, and historical reports keep showing both category and type.
Managers may move a type between categories; historical report rows follow the current type/category configuration in this pass rather than snapshotting old category names.
_Avoid_: leaving a type without a category, showing active types from an inactive category in guard entry, hard-coding the category/type choices in the UI, adding category snapshots without a separate audit decision, or merging the configured type description with the actual event description

**انتخاب دسته‌بندی در ثبت گزارش لحظه‌ای**:
During guard report entry, category is selected before type. The type selector is disabled until a category is chosen, shows only active types in that active category, and changing the category clears the previously selected type.
_Avoid_: submitting a stale type from a previous category, showing all types in one long mobile dropdown, or allowing report submission without a selected type

**شماره ردیف گزارش شیفت**:
A server-generated sequence number scoped to one planned security shift. Each shift starts at row 1 and guards never manually enter or edit the row number.
_Avoid_: global report numbering, client-generated row numbers, or reusing a voided row number for a later entry

**ابطال گزارش لحظه‌ای حراست**:
A visible audit state for a mistaken shift log row, requiring a reason, the voiding user, and the exact void timestamp. Any حراست user with edit access may void any row, and voided rows remain in the normal shift log clearly marked باطل شده.
_Avoid_: deleting shift log rows, hiding voided rows by default, or voiding without a reason

**گشت‌زنی حراست**:
A timestamped patrol session inside a security shift. It starts with one click and a server timestamp, ends with a required description and server timestamp, may happen multiple times in one shift, and one user cannot have overlapping active patrol sessions.
Shift closure is blocked while any patrol session in that shift is still active.
_Avoid_: requiring patrol notes before the patrol happens, storing patrols as free-text shift notes, allowing accidental overlapping active patrols for the same user, or auto-ending patrols during shift closure

**گزارش‌های حراست**:
A manager-focused reporting workspace with exactly two report products: گزارش شیفت‌ها and گزارش حضور و غیاب حراست. It is separate from the active گزارش شیفت حراست workflow: managers search completed shifts directly, preview the selected evidence, and generate a scoped PDF instead of first choosing an analytical date range or report format.
_Avoid_: mock analytics, decorative KPI collections, performance-report mode as a competing third product, requiring a date range before a manager can find a completed shift, or showing labels that do not match the exported evidence

**شیفت قبل حراست**:
The finished security shift session with the most recent actual `endedAt`, whether normally closed or force-closed by a manager. It is based on actual completion order rather than the previous planned rota slot.
_Avoid_: selecting the prior scheduled slot when another session finished later, or excluding force-closed sessions from the latest completed shift

**گزارش شیفت‌ها**:
The manager-only completed-shift report product. It lists completed shifts newest-first, supports direct search by shift identity, guard, Jalali date, or operational state, and allows one or several shifts to be selected, previewed with their complete read-only timelines, and exported as one scoped PDF. Date range is an optional advanced filter rather than the required entry point.
_Avoid_: limiting reporting to only شیفت قبل حراست, immediately downloading before preview, requiring a date range for ordinary retrieval, exporting active shifts, or flattening evidence from different shifts into an unscoped feed

**بخش‌های مبتنی بر شواهد در PDF تفصیلی حراست**:
Both the latest-shift PDF and personnel-performance PDF omit empty per-shift patrol, attendance, closure-summary, participant, and image sections, while retaining sections with real recorded activity. The standalone date-range attendance PDF keeps its consistent analytical structure because zero attendance values are meaningful data there.
_Avoid_: printing placeholder operational sections in detailed PDFs, or removing meaningful zero-valued rows from the aggregate attendance report

**عملکرد نیروهای حراست**:
The manager-only reporting view of assigned Security personnel over a selected date range, covering their planned duties, attendance, sessions, coverage exceptions, patrols, and timestamped shift-log activity. It is separate from company-wide attendance reporting.
_Avoid_: treating all employees as Security personnel, or reducing guard performance to only a company attendance percentage

**شواهد عملیاتی نیروی حراست**:
The timestamped shift-log descriptions, patrol completion notes, and shift closure summaries for a Security guard within a selected report date range. Managers may inspect them after narrowing the report; they are not default dashboard content.
_Avoid_: exposing operational narratives without report context, or replacing evidence with counts alone

**فیلتر زمینه‌مند گزارش‌های حراست**:
A report filter set whose controls follow the selected reporting scope: quick or custom Jalali date range and common identity filters, with attendance filters for employee reporting and operational-status/activity filters for Security-personnel performance.
_Avoid_: one static filter form that exposes irrelevant controls, or losing the selected filters when the report scope changes

**دسترسی گزارش عملکرد نیروهای حراست**:
Manager-level Security workspace access to the detailed performance view, its operational narratives, and the latest-completed-shift PDF. This access is distinct from ordinary guard self-service and aggregate report viewing.
_Avoid_: protecting detailed personnel performance only by hidden interface controls, exposing guard narratives to generic workspace viewers, or allowing report-page visibility alone to authorize detailed PDF downloads

**خروجی عملکرد نیروهای حراست**:
The manager-only performance PDF may include detailed operational evidence from finished security shifts in the selected date range: shift date/time and status, planned/replacement/temporary coverage person, attendance and delay, closure summary, instant report rows with report type names and descriptions, and patrol sessions. Active shifts are excluded. Both CLOSED and FORCE_CLOSED sessions count as finished, with force-closed shifts clearly labeled.
_Avoid_: exporting active shifts, hiding force-closed status, or exposing detailed operational narratives outside the manager/admin performance export.

**تصاویر گزارش لحظه‌ای در خروجی حراست**:
Images are printed directly beneath their own instant-report row with preserved aspect ratio, up to two images per row, natural continuation across rows or pages, and a caption containing the report row number and original filename. Voided-report images follow the same layout while retaining the report's voided context.
_Avoid_: separating images from their report, stretching or cropping evidence, mixing images from different rows, or omitting identifying captions

**حضور و غیاب در خروجی شیفت حراست**:
Each completed shift in a latest-shift or personnel-performance PDF has a separate attendance section for the guard who actually worked and any recorded replacement or temporary coverage, including recorded arrival, delay, and corrections. Off-duty A/B/C guards are not shown as absent, while the standalone attendance PDF remains the date-range attendance export.
_Avoid_: treating off-duty primary guards as absent, merging attendance into unrelated shift metadata, or replacing the standalone attendance report with shift-specific attendance

**تاریخچه تفصیلی شیفت نیروی حراست**:
A manager/admin-only dedicated page for chronological review of one Security guard's shifts in the selected range. Each expandable shift keeps scheduled and actual coverage, attendance and session timing, exceptions, patrols, closure data, and the complete instant-report audit trail together.
_Avoid_: flattening evidence from different shifts into one unscoped activity feed, showing detailed history to ordinary guards, or losing the report date context when navigating to the history

**گزارش لحظه‌ای باطل‌شده حراست**:
An instant report that remains visible in the shift audit trail and PDF exports with a clear voided state, void time, void reason, and any attached images. It is historical evidence rather than active shift content and does not count toward active-work summary totals.
_Avoid_: deleting voided reports or their images, counting them as active work, or presenting them as active without their void context

**نمایش تاریخچه تفصیلی شیفت**:
The detailed shift-history page defaults to the selected guard's entire record, including inactive/former Security personnel, and orders shifts newest first. A date range is an optional narrowing filter; each shift begins with a compact status and timing header, while its complete audit evidence is revealed in an expandable section.
_Avoid_: inheriting an arbitrary reporting date as a required history boundary, omitting former personnel, loading every shift's full narrative by default, or making a manager search through an unstructured event stream

**داده واقعی حراست**:
Core حراست surfaces use persisted operational data or an honest empty state when no records exist. Missing core sources should be backed by explicit API contracts, while non-core admin-wide security audit widgets stay empty or hidden until a real audit-log model exists.
_Avoid_: simulated counts, delayed fake loading, hard-coded sample users, or admin security metrics that imply audit coverage the system does not actually record

**پروفایل شخصی کاربر**:
The authenticated user's own identity and department profile, available as a core self-service capability independently of workspace membership. It does not grant access to any workspace-owned operational data.
_Avoid_: making self-profile access depend on Sales access, or treating it as a shortcut to workspace permissions

**امور شخص**:
A personal self-service area opened from the user's profile menu, available to every authenticated user independently of workspace permissions. It contains user-owned actions such as submitting personal leave requests, and is separate from organizational personnel management.
_Avoid_: presenting امور شخص as a workspace, confusing it with پرسنل سازمانی, or requiring workspace access before a user can use their own self-service actions.

**درخواست مرخصی کاربر**:
A personal leave request submitted by an authenticated user from امور شخص, using the same business concept as the existing exception-request workflow so approvals, rejections, attendance effects, and security shift coverage can share one leave truth. V1 requests require leave type, start date, end date, and reason; description is optional. Pending requests may be cancelled by the requester, approved by a global admin or global manager, or rejected with a required reason. Global admins and global managers may also create a leave request for a specific user when needed; manager-created requests are approved immediately by default and keep creator, target user, approval, and reason audit fields visible.
Leave requests are not hard-deleted in normal V1 use. Users may edit or cancel their own pending requests, admins and global managers may edit pending requests, and approved requests may be cancelled by admins or global managers only with a required reason.
_Avoid_: creating a separate leave-request object that competes with existing exception requests, making personal leave submission depend on membership in the حراست workspace, treating workspace managers as approvers by default, requiring manager-created requests to go through a pointless self-approval step, hard-deleting leave history, or rejecting/cancelling a leave request without a visible reason.

**نوع مرخصی کاربر**:
The user-facing leave classification for درخواست مرخصی کاربر: استحقاقی, استعلاجی, استعلاجی سازمانی, or بدون حقوق. مرخصی روزانه is the default request shape, not a separate user-facing leave type.
_Avoid_: exposing technical exception names such as VACATION or SICK_LEAVE to users, or mixing hourly leave and mission categories into the first personal leave-request flow.

**پرسنل سازمانی**:
A real person who belongs to a Sabalan department and may appear in operational workflows such as attendance even when they do not have a system login. A system user may be linked to one organizational personnel record, but login access is not required for someone to be personnel.
_Avoid_: treating every personnel record as a login account, hiding non-user personnel from operational attendance, or using system permissions as proof that a person belongs to the workforce

**مدیریت پرسنل**:
An Admin-owned company workforce registry for creating and maintaining organizational personnel independently of login access. Operational workspaces such as حراست consume this registry but do not own the company-wide personnel list.
_Avoid_: hiding company personnel management inside حراست, duplicating the workforce list per workspace, or mixing personnel registry work with user permission management

**اطلاعات پایه پرسنل سازمانی**:
The first personnel registry records only first name, last name, related department, and active/inactive state. Phone, email, national code, payroll data, and identity documents are outside the first version unless a later workflow explicitly needs them.
_Avoid_: forcing login-style contact fields onto non-user personnel, collecting sensitive identity fields before a workflow requires them, or blocking attendance setup on HR/payroll completeness

**تشخیص تکراری پرسنل سازمانی**:
An Iranian National Code match, when available, identifies the same person and prevents a second Personnel identity. Similar full name, birth date, phone, or organizational placement produces a duplicate warning for review but never an automatic hard match; User migration, Candidate conversion, and rehire link to confirmed existing Personnel instead of creating duplicates.
_Avoid_: treating names as unique identity, automatically merging on similarity, creating another Personnel for a returning worker or matching Candidate, exposing National Code outside authorized Human Resources access

**غیرفعال‌سازی پرسنل سازمانی**:
The normal way to remove personnel from active operational selection while preserving their historical attendance, mission, exception, report, and future workflow records. Hard deletion is reserved for accidental records with no operational history.
_Avoid_: deleting personnel with history, showing inactive personnel in normal daily attendance lists, or losing historical names because someone left the company

**سوابق تاریخی پرسنل**:
Operational records that report on personnel should preserve the relevant identity and department as they were at the time of the operation. A later department change updates the current personnel profile but does not rewrite historical attendance or report context.
_Avoid_: recalculating old attendance under a person's current department, or making historical reports depend only on mutable personnel profile fields

**مهاجرت پرسنل سازمانی**:
Introducing organizational personnel should preserve existing user-based attendance and related history through an incremental compatibility migration. Existing users receive linked personnel records, existing attendance links are backfilled to personnel, and new attendance code reads and writes personnel while temporary legacy user links may remain only for compatibility.
_Avoid_: rewriting the visible meaning of historical attendance, dropping old user attendance during migration, or blocking non-user personnel until every legacy relation is removed

**کاربر سیستم**:
A login identity for accessing Sabalan ERP. Every system user should be linked to an organizational personnel record, while many personnel records may have no system user.
_Avoid_: using user accounts as the workforce roster, creating login access just to record operational attendance, or keeping user-only people outside the personnel roster

**اتصال کاربر به پرسنل**:
Creating a system user should default to creating or linking the corresponding organizational personnel from the user's name and department, while also allowing admins to attach the user to an existing personnel record. One personnel record may be linked to at most one system user.
_Avoid_: creating duplicate personnel when a matching same-department person already exists, forcing a login account for existing non-user personnel, or allowing multiple users to represent the same personnel record

**برنامه من حراست**:
The month-selectable personal view of a security user's published shift duties: planned assignment, replacement duty, and temporary coverage. It spans past, current, and future Jalali months, while full rota and coverage visibility remains manager-only.
_Avoid_: using a static date input, showing a guard the entire team's rota, or omitting temporary coverage from the user's own schedule

**بازخورد عملیاتی حراست**:
The workspace feedback pattern: inline validation for field-level corrections, non-blocking in-app notices for routine outcomes, and explicit in-app confirmation or reason dialogs for destructive or audited actions.
_Avoid_: native browser alerts or prompts, generic errors detached from their operation, or confirmations for harmless navigation

**داشبورد حراست**:
A shared operational-awareness surface for users of the حراست workspace. Permitted users receive today's attendance conditions and navigation, while active-shift identity and live reports are visible only to the active guard and security managers/admins; managers/admins remain read-only on the dashboard and complete shift-report view.
_Avoid_: treating the entire dashboard as manager-only, duplicating attendance or shift-report operations on it, exposing another guard's active-shift identity or records to ordinary read-only users, or preventing managers/admins from observing the active shift

**وضعیت امروز حراست**:
The dashboard's calendar-day attendance summary for today's roster, limited to غایب، تأخیر، مأموریت، and مرخصی. These are independent operational conditions rather than parts of one total: غایب and تأخیر use the derived attendance classification, while مأموریت and مرخصی count approved authorizations overlapping today, so one person may contribute to more than one value. The summary is independent of the active security shift, whose live-report timeline may cross midnight.
_Avoid_: including total or present personnel, adding a dashboard date picker, redefining the summary around the active shift session, forcing the four values to be mutually exclusive, or filtering مأموریت and مرخصی only by the primary attendance status

**طراحی عملیاتی موبایل حراست**:
Every حراست route follows one minimal mobile-first RTL interaction language with compact Persian headings, teal primary actions, neutral surfaces, semantic labelled states, structured mobile lists, focused forms, independent data states, and purposeful motion. Desktop may retain compact semantic tables where row comparison matters, while mobile exposes essential row identity and state first and places secondary detail behind expansion without ordinary horizontal scrolling.
_Avoid_: treating manager/config/report pages as a lower-quality responsive afterthought, reviving the older red/rose security theme, table-only mobile views, cramped side-by-side fields that break Persian labels, card-inside-card decoration, or using color without a Persian state label

**خروجی گزارش‌های حراست**:
A PDF rendition of the exact shift and personnel scope that an authorized manager has selected and previewed. Its minimal identity contains the concise Persian report title, selected scope, essential timestamps and states, useful evidence rows or timeline, generation timestamp, and page numbering; decorative charts, helper text, controls, repeated metadata, empty columns, empty sections, and oversized branding are omitted.
_Avoid_: ambiguous PDF buttons, downloading before preview, ignoring the selected scope, exporting sensitive operational data outside authorization, or filling the document with interface copy and decorative summaries

**دو نوع خروجی گزارش حراست**:
Security reporting has two distinct export families. گزارش شیفت‌ها exports complete read-only evidence for one or several selected completed shifts. گزارش حضور و غیاب حراست exports attendance for one or several selected shifts and either all, one, or several selected personnel within that scope.
_Avoid_: a generic performance-report mode, one ambiguous PDF action that changes meaning, or applying a personnel filter to hide unrelated rows from a shift's canonical operational timeline

**صادرکننده گزارش حراست**:
A security manager, admin, or explicitly authorized report viewer who may preview and generate گزارش شیفت‌ها and گزارش حضور و غیاب حراست within their authorized scope. A regular guard may operate their own active گزارش شیفت حراست but cannot gain report export access merely by working a shift.
_Avoid_: granting personnel attendance export to every user who can work a security shift, or relying only on hidden front-end buttons to protect report data

**محتوای خروجی گزارش حراست**:
The attendance export contains the selected shift identities and personnel scope, generation time, a concise useful summary, and the applicable attendance facts for each selected person and shift, including state, expected time, actual movements, and authorized mission or leave context when relevant. The shift export keeps each selected shift's complete timeline and audit context together.
_Avoid_: a report with no scope identity, omitting selected absent personnel, treating mission or leave as fabricated physical presence, mixing different shifts into an unscoped activity feed, or printing fields with no value or decision relevance

**تقویم سالیانه سبلان**:
A company-wide calendar authority for marking days as holidays and recording events. It is informational until a specific workflow explicitly chooses to consume it, so existing attendance, shift, contract, and delivery behavior does not change implicitly.
Each calendar entry has a date, holiday flag, title, description, event type, and active/inactive state; first-version event types are تعطیل رسمی, تعطیل شرکت, رویداد داخلی, یادآوری, and سایر.
One date may have multiple active entries, and the date is considered a holiday if at least one active entry for that date is marked as a holiday.
_Avoid_: hidden side effects on operational workflows, treating admin calendar events as shift reports, recurring rules, half-day schedules, or scattering company holiday definitions across workspaces

**چرخه شیفت حراست**:
A continuous three-person rotation in A→B→C order using fixed 12-hour slots that start at 07:00 and 19:00. Each person works one slot and then rests for two slots before their next planned slot.
_Avoid_: asking managers to manually tune shift duration for the normal annual plan, assigning each person permanently to day or night, scheduling overlapping base slots, or changing a started plan's timing

**برنامه سالانه شیفت حراست**:
A generated schedule with a date range and exactly three ordered primary guards. The normal annual plan uses fixed 07:00/19:00 shift boundaries and 12-hour slots; managers define the A/B/C order and generation dates, not the slot duration. Publishing a plan is an operational activation event: if the published schedule contains the current time, the current slot's assigned guard becomes the active shift worker immediately and their attendance is recorded with the server timestamp. If a plan is published mid-slot, the slot keeps its scheduled 07:00/19:00 boundary while the session start and attendance time remain the real publish timestamp. Mid-year primary changes create a future plan revision, while other eligible security personnel remain substitutes outside the base cycle. Draft plans may be deleted by a manager before publication, but published plans are retained as operational history and should be replaced, superseded, or explicitly cancelled rather than physically deleted.
_Avoid_: exposing normal annual-plan timing as free-form manager inputs, publishing a current schedule that still waits for manual shift start, rewriting started slots, placing one person in multiple primary positions, or silently inserting substitutes into the A→B→C rotation

**جمعیت عملیاتی جاری حراست**:
The three A/B/C primary guards in the current published annual shift plan are the people shown in shift-specific dashboards, performance reports, filters, and PDFs. During a gap with no plan covering the current time, the latest non-superseded published plan remains authoritative; with no published plan history the population is intentionally empty and managers are guided to publish one. Substitutes appear only in the historical shifts they actually covered; workspace access alone never makes an admin, manager, or developer part of this population, and historical records retain their original people.
_Avoid_: using this population for company personnel attendance, deriving reportable guards from workspace access, falling back to all users when no current slot exists, showing substitutes as current primary guards, or rewriting historical shift participants when the current A/B/C plan changes

**نامزد پیکربندی نیروی حراست**:
An otherwise eligible person outside the current A/B/C population may appear only in manager-only shift-plan creation, replacement, or temporary-coverage controls so future assignments remain possible. The candidate does not enter normal operational reports or people lists unless they actually cover a historical shift or become a published A/B/C guard.
_Avoid_: exposing configuration candidates in normal dashboards and reports, or making future A/B/C and replacement assignment impossible by hiding candidates from managers

**جایگزینی شیفت حراست**:
A slot-specific exception that preserves the annual A→B→C baseline while assigning another eligible security user as the actual worker for an absent planned guard. Later planned assignments do not shift, and rest or overlap conflicts require a manager override reason.
_Avoid_: regenerating the rotation after leave, transferring ownership of later slots to the substitute, or hiding rest violations created by coverage

**نیروی مؤثر شیفت فعال حراست**:
The person actually responsible for the current active shift session, whether they are the originally planned guard, a replacement, or temporary coverage. Authorized active-shift awareness identifies this person first and retains the planned-versus-coverage relationship as secondary context.
_Avoid_: presenting the originally planned guard as currently on duty when someone else is operating the session, or flattening replacement and temporary coverage into an unexplained name

**تحویل شیفت حراست**:
The controlled boundary where the outgoing guard submits the shift report and ends the active session before the incoming assigned guard starts the next one. The first active session of a newly published current plan may be opened by publication itself; later boundaries are not auto-started in the first version and still require deliberate closure/start handling. A manager may force-close an unclosable session only with an audited reason.
_Avoid_: starting overlapping active shift sessions, closing a normal shift without its report, or silently correcting a forgotten shift end

**عدم حضور احتمالی شیفت حراست**:
A coverage alert when the assigned or replacement guard has not registered arrival after the plan's lateness threshold. It remains visible for manager review until the slot is covered, corrected, force-closed, or completed.
_Avoid_: treating this as final absence before manager action, hiding the alert because the person later arrived, or using color without a Persian label

**نفرات حراست**:
The حراست people area covers employee attendance, shifts, exceptions, missions, and security personnel workflows. Drivers are not managed here; they belong to خودرویی because their operational role is tied to vehicle movement.
_Avoid_: mixing driver/vehicle registry work into personnel attendance workflows

**کاربر واجد شرایط حراست**:
An active system user linked to organizational personnel who already has a security workspace permission or security role and can therefore be assigned into نفرات حراست. General active personnel are visible in attendance workflows but are not selectable for security shift plans, patrol ownership, shift logs, or replacement coverage unless they have linked user access to حراست.
_Avoid_: offering every active personnel record in security personnel assignment, assigning non-login personnel to authenticated shift work, or using placeholder sample users when no eligible user exists

**فهرست حضور و غیاب حراست**:
A date-effective roster of active company personnel whose ورود و خروج is managed by حراست. Managers may add or remove personnel with immediate effect for today, while each historical date, attendance report, and attendance PDF/Excel uses the roster membership effective on that date.
_Avoid_: deriving company attendance from the A/B/C shift plan or workspace access, automatically including every active person after the initial roster setup, or applying today's roster retroactively to historical attendance

**فهرست خالی حضور و غیاب حراست**:
An empty attendance population means no personnel are members of فهرست حضور و غیاب حراست for the selected date. Attendance pages and metrics show no people and guide managers to configure the roster instead of falling back to A/B/C guards, all active personnel, or access-bearing users.
_Avoid_: calculating attendance from an unconfigured population, silently loading another population, or treating an empty roster as a missing shift plan

**ثبت ورود تکراری در حضور و غیاب حراست**:
When حراست records ورود for a person and that same person already has an entry time for the selected attendance date, the operation should behave as a successful idempotent action and return the existing attendance truth to the operator. The visible daily list should then show the existing حاضر record instead of leaving the person as غایب.
_Avoid_: showing English duplicate errors to operators, treating a successful earlier ورود as a failed action, or displaying غایب for a person whose same-day ورود already exists

**زمان ثبت حضور و غیاب حراست**:
ورود and خروج actions in حراست default to the current time, but the operator may change the time before submitting when the event was forgotten or recorded late. If the submitted time differs from the default current time, a short reason is required and should remain visible as attendance context.
_Avoid_: forcing a separate manual-entry mode, blocking forgotten attendance correction, or allowing silent backdated times without a reason

**حضور باز روز قبل**:
If a person has an older attendance record with ورود and no خروج, حراست must close that previous record with an explicit خروج time and reason before registering a new ورود for a later date. The system should surface this open previous attendance state instead of silently creating a new day entry or auto-filling the old exit.
_Avoid_: overwriting yesterday's record with today's action, creating automatic خروج without operator confirmation, or allowing overlapping open attendance records for the same person

**ساعت کاری پرسنل**:
The optional effective-dated recurring weekly schedule owned by Human Resources as the canonical expected-work baseline for the Personnel identity, containing one complete start-to-end work interval for each selected Persian-calendar weekday. Personnel management and the linked User management form both display and update this same schedule rather than keeping separate schedules. Bulk entry can assign an interval to selected days, after which either boundary remains independently editable for each day; applying bulk time overwrites only the currently selected days, preserves unselected days, and requires confirmation when it would replace differing values. A configured day must have both boundaries, and an absent schedule has neither configured days nor times. When a day's end time is not later than its start time, its interval ends on the following calendar day. Weekday selection follows the project calendar's Saturday-to-Friday order and provides presets for every day and for the standard workweek of Saturday through Thursday. A new schedule version starts on a selected Jalali effective date of today or later, so future changes do not rewrite earlier schedule history. Authorized User/Personnel management roles may edit the schedule; Security consumes and displays the applicable baseline but does not change it.
_Avoid_: storing conflicting work schedules on User and Personnel, treating a login account as the workforce source of truth, letting Security rewrite its own reporting baseline, saving only one boundary of a configured day, keeping selected days without complete times, rejecting an overnight interval merely because its end clock time is earlier than its start clock time, forcing every selected day to keep the same interval after bulk entry, treating Friday as part of the standard-workweek preset, or backdating a schedule change into historical attendance

**روز غیرکاری پرسنل**:
A date on which rostered Personnel has no configured weekday interval and therefore is not expected to attend. The person is excluded from absence and lateness totals for that date, while Security may still record actual entry and exit when exceptional work occurs. Such attendance has no lateness; once exit is recorded, the entire actual entry-to-exit interval is overtime, while an open record shows overtime as pending.
_Avoid_: counting an unplanned workday as absence, removing the person from Security's attendance controls, discarding exceptional presence on a non-working day, or finalizing non-working-day overtime before exit is known

**ساعت کاری تعریف‌نشده**:
The state of Personnel with no weekly schedule version at all, distinct from an unselected weekday in an existing schedule. Existing roster-based present and absent behavior continues for such personnel, but delay and overtime remain unavailable until a schedule is configured.
_Avoid_: treating migration-era personnel as off work every day, silently removing them from absence totals, or inventing delay and overtime without an expected interval

**تأخیر و اضافه‌کار پرسنل**:
On a configured workday, lateness is the positive whole-minute difference between actual entry and the scheduled start, and overtime is the positive whole-minute difference between actual exit and the scheduled end. There is no grace period; early entry does not create overtime, early exit does not create negative overtime, and early-departure classification is outside the current scope. Before scheduled start, missing entry is در انتظار شروع rather than absent; after start passes it becomes غایب, and a later entry changes it to حاضر با تأخیر with the exact delay. Historical attendance retains the schedule and calculated values that applied on its date; later weekly-schedule edits affect future calculations rather than rewriting past reports.
_Avoid_: marking personnel absent before their workday starts, silently applying a grace period, offsetting late arrival with early arrival on another day, counting early arrival as overtime, introducing تعجیل در خروج without a separate business decision, or recalculating historical delay and overtime from a later schedule

**حضور شبانه پرسنل**:
An attendance interval whose configured workday ends after midnight belongs to the calendar date on which work started. Its delay and overtime are calculated against that start-date interval, while the weekly schedule remains a reporting baseline and never prevents Security from recording actual work before, after, or outside scheduled hours.
_Avoid_: splitting one overnight presence into unrelated daily records, assigning it to the exit date, or using the schedule to authorize or block actual attendance

**گزارش روزانه استثناهای حضور پرسنل**:
The default minimal Security PDF for attendance exceptions, containing only person-days that are absent, late, or have overtime. Its summary contains only غایب and تأخیر cards, and its detail columns are پرسنل، وضعیت، ورود، خروج، تأخیر، اضافه‌کار, and یادداشت; department, recorded shift, and signature columns are omitted. A single-day report identifies that one Jalali date rather than presenting it as a same-date range and omits the redundant date column; an explicitly selected multi-day filter remains a range and restores a compact date column so repeated personnel rows remain distinguishable. Ordinary on-time attendance without overtime is omitted, while richer attendance and performance outputs remain separate available reports.
_Avoid_: filling the default operational PDF with ordinary attendance rows, displaying redundant one-day ranges, retaining nonessential detailed columns or metric cards, or removing the existing detailed outputs when introducing the minimal report

**تاریخ عملیاتی حراست**:
The Jalali calendar day explicitly selected for Security attendance, roster, and reporting work. The same selected day must survive frontend, API, persistence, and output boundaries regardless of browser or server timezone.
_Avoid_: allowing UTC conversion to move a selected Security day backward or forward, or applying different date semantics to screen data and exported reports

**خرید بیرونی در ورود خودروی پر**:
An inbound loaded-vehicle purpose for purchased cargo arriving from outside Sabalan. It may have a purchase invoice and may have a بارنامه.
Its completed entry information captures the driver/vehicle details, document presence for purchase invoice and بارنامه, and any trip-specific settlement details needed for بارنامه settlement.
_Avoid_: requiring every outside purchase entry to have both documents when one may be absent in reality, or moving trip-specific settlement evidence to the reusable driver/vehicle registry

**برگشت از فروش در ورود خودروی پر**:
An inbound loaded-vehicle purpose for goods returning from a sold/customer delivery. It has no purchase invoice, must reference the customer, and may have a بارنامه.
_Avoid_: treating returned sales goods as an outside purchase, or entering the customer as free text when the customer exists in CRM

**امانی در ورود خودروی پر**:
A reserved inbound loaded-vehicle purpose for consignment or entrusted goods whose detailed workflow is intentionally not defined yet.
It may be visible as در دست تعریف, but users should not complete امانی entries until its business meaning and lifecycle are resolved.
_Avoid_: implementing امانی rules before the business meaning and lifecycle are resolved

**ردیف قابل بارگیری**:
A contract row is loadable only when it represents physical cargo leaving Sabalan. Services and operations are not loaded separately, but service/tool/finishing details attached to a physical product should remain visible as part of that product's loading identity.
A loading identity includes the product or stone name, product family, loading unit, remaining amount, logistics-relevant dimensions, contract number, and any attached service, tool, or finishing details needed to distinguish the physical cargo.
_Avoid_: creating بارگیری lines for standalone services, hiding product-attached services that help logistics identify the correct cargo, or showing only the origin catalog name when the contract row has more specific loading details

**مشاهده حسابداری بارگیری**:
Accounting sees finalized logistics loading records as read-only shipment evidence, including customer/project, contract links, loaded amounts, driver snapshot, warnings, and correction history.
_Avoid_: letting accounting directly edit physical loading quantities or driver details

**برگه چاپی بارگیری**:
A printable loading slip is an output of a finalized digital بارگیری, not the source record. It summarizes the loading document for warehouse, driver, or accounting use.
_Avoid_: treating the old paper table as the required digital UI layout, or keeping paper as the source of truth after digital entry

**برنامه تحویل در برابر بارگیری**:
برنامه تحویل is the sales/customer promise for planned delivery timing and amounts; بارگیری is the logistics record of actual loading and shipment.
_Avoid_: merging promised delivery schedule data with actual loading transactions when shipped quantities, dates, or drivers differ

## Human Resources and Leave

**HR Migration Baseline**:
The declared cutover reference used to introduce existing Personnel into the new HR model without manufacturing unknown history. Existing active Personnel receive a migrated active Employment Relationship with source identifiers and migration provenance, but creation timestamps are never treated as hire dates and unknown dates remain explicitly unknown for HR verification. Existing User-to-Personnel links are preserved, while unlinked Users remain access identities until deliberately classified. Departments become typed Organizational Units only after hierarchy review, existing schedules retain their known effective dates as legacy records, and only genuine leave Exception Requests become Leave Requests; other exceptions retain their attendance or Security meaning. Migration provides a repeat-safe dry run, reconciliation totals, and duplicate or conflict reporting, and never destructively deletes source records.
_Avoid_: invented employment or schedule history, automatically turning every User into Personnel, coercing every exception into leave, losing source provenance, destructive one-shot migration without reconciliation

**Leave Request**:
An employee's request for approved time away from expected work, owned by Human Resources regardless of which workspace later consumes its result.
_Avoid_: Security exception, attendance correction, shift exception

**Employee Leave Self-Service**:
The employee-facing leave entry and tracking surface in Personal Affairs. It is the single place where an employee submits and follows their own Leave Requests.
_Avoid_: a second Security leave form, workspace-specific copies of the same request

**Leave Approval**:
The policy-driven workflow that changes a pending Leave Request into approved or rejected time away from work. Automated checks validate schedule, overlap, balance, and Leave Type rules; the effective Responsible Supervisor is the sole human approver for a routine request. Human Resources owns policy and the ledger but joins the approval only for configured exceptions such as negative balance, unpaid leave, extended duration, medical or legal review, or a retroactive request. The route and responsible actors are snapshotted at submission. An effective-dated delegate may act during an approver's absence; otherwise the request visibly escalates through the reporting hierarchy. Security consumes the approved result and never approves leave.
_Avoid_: making HR manually approve every routine request, using generic application roles instead of accountable effective-dated people, Security approval, silently rerouting a submitted request, stalled requests with no delegation or escalation

**Leave Balance Ledger**:
The auditable source from which an Employment Relationship's balance for each balance-consuming Leave Type is calculated. Entitlement, accrual, carryover or transfer, reservation, usage, expiry, adjustment, and reversal are separate immutable entries; no actor directly edits the resulting balance. A pending request reserves entitlement, approval converts the reservation into usage, and rejection or cancellation releases it. Cancelling confirmed usage creates a reversal rather than deleting history. Adjustments are dated and retain the reason, acting person, and any required approver snapshot. A request cannot exceed available balance unless that Leave Type's explicit negative-balance policy permits it, while Leave Types configured without a balance bypass balance consumption.
_Avoid_: an editable final balance, deleting or rewriting ledger history, independent balances outside an Employment Relationship, consuming the same available entitlement through concurrent pending requests, treating every Leave Type as balance-consuming

**Leave Consumption Duration**:
The amount charged to a Leave Balance Ledger from the employee's Combined Expected Schedule rather than raw calendar days or manually asserted hours. Daily leave covers every expected interval within the selected dates, while hourly leave uses an exact start and end time; rest days and non-working intervals consume nothing. The calculation includes all schedule-contributing assignments and retains the applicable schedule and version references. A pre-approval schedule change recalculates the duration and visibly informs the requester, while a post-approval change creates a review conflict and never silently changes approved consumption or finalized attendance.
_Avoid_: charging calendar days without expected work, ignoring contributing assignments, manually entering the consumed duration as authoritative, silently recalculating approved leave after a schedule change

**Leave Revision and Cancellation**:
The controlled lifecycle for changing a submitted or approved Leave Request without rewriting its decisions. A requester may withdraw a pending request and release its reservation. Changing dates, times, or Leave Type after submission creates a visible revision and reruns validation and approval. Cancelling future approved leave follows the same operational approval route because replacement coverage may already exist. After leave starts, only an authorized Human Resources correction may reverse consumption and trigger attendance reevaluation through new dated records with a reason and required approval. The original request, approval, coverage, ledger, and attendance evidence remain intact, and overlapping active Leave Requests for the same employee are rejected.
_Avoid_: editing an approved request in place, deleting approved leave or its operational consequences, employee self-cancellation after leave starts, retaining a balance reservation after withdrawal, accepting overlapping active leave

**Security Leave Consequence**:
The operational staffing and attendance effect that Security derives from an approved Leave Request, such as identifying a shift that needs replacement coverage.
_Avoid_: letting Security own the Leave Request or its HR approval policy

**Attendance Exception**:
An operational discrepancy or correction concerning recorded presence, such as a missing entry, late arrival, early departure, or absence correction. It is distinct from a Leave Request even when approved leave explains the discrepancy.
_Avoid_: using Attendance Exception as an umbrella term for leave policy

**Job**:
A reusable description of the nature of work and its expected responsibilities and capabilities, independent of a particular place in Sabalan's organization.
_Avoid_: Position, organizational seat, employee assignment

**Position**:
A defined place in Sabalan's organization that applies a Job within a specific organizational, reporting, workplace, and shift context. Each Position has an approved headcount capacity and may hold multiple active personnel assignments up to that capacity; its vacancy is the unfilled portion of that capacity.
_Avoid_: Job, treating the nature of work and its organizational placement as one field, duplicating an otherwise identical Position for every occupant

**Position Reporting Line**:
The normal supervisory relationship from one Position to its supervising Position, preserved independently of whichever personnel currently occupy either Position. A temporary or exceptional reporting relationship is a separate override rather than a rewrite of the normal structure.
_Avoid_: permanently storing the normal reporting line only between Personnel, editing every subordinate when a manager changes, replacing the normal structure for a temporary arrangement

**Employment Assignment**:
The effective-dated relationship that places Personnel in a Position for a defined period. Personnel may hold concurrent assignments, but exactly one active assignment is primary; every other active assignment is explicitly secondary or acting. Transfers, promotions, and other placement changes close or supersede assignments while preserving the organizational history that applied on each date.
_Avoid_: a mutable Position field on Personnel, multiple primary assignments, unclassified concurrent duties, overwriting earlier placements, reconstructing historical reporting or cost attribution from today's organization

**Capacity-Bearing Assignment**:
A primary or secondary Employment Assignment that occupies one place within a Position's approved headcount capacity. An acting assignment provides temporary operational coverage without consuming permanent capacity, so the covered Position remains vacant for staffing and recruitment purposes.
_Avoid_: counting acting coverage as a permanent occupant, hiding a vacancy because someone is acting in it, ignoring secondary assignments in headcount

**Employment Relationship**:
An effective-dated period during which Personnel is employed by Sabalan. Departure closes the current relationship without removing the Personnel identity, and a later rehire creates a new relationship to which that period's contracts, assignments, employment status, and exit records belong.
_Avoid_: treating Personnel and employment as the same lifecycle, overwriting an earlier employment period on rehire, creating duplicate Personnel for a returning worker

**Employment Status**:
The current lifecycle state of an Employment Relationship: Planned before its start, Active while employment is in force, Suspended while employment continues but work is temporarily stopped, or Ended after the relationship concludes. Ordinary leave is derived from approved Leave Requests, and probation is a dated employment phase rather than an Employment Status.
_Avoid_: using leave, probation, contract state, or attendance state as Employment Status, using a generic inactive state that hides whether employment is planned, suspended, or ended

**Probation Phase**:
An effective-dated phase within an Employment Relationship during which an employee may remain Active while a required probation review is pending. The review explicitly records confirmation, an authorized extension with its reason and new end date, or employment termination; every extension preserves the earlier period and decision history. Reaching the planned end date without a decision creates an overdue escalation and never silently confirms or terminates employment.
_Avoid_: representing probation as Employment Status, overwriting the original probation dates, automatic confirmation or termination at the planned end date, extending probation without an authorized reason

**Employment Termination Decision**:
The explicit Human Resources decision that records the notice date, last working date, effective employment end, reason, and authorized actors and opens a coordinated Offboarding Case. Employment remains Active until the effective end unless separately suspended. At that instant the Employment Relationship and active Assignments close, Position capacity is released, and expected scheduling stops. ERP and physical access each use an exact cutoff time, while early or extended access requires explicit, scoped, time-bounded approval from the relevant owner. Records are disabled or closed rather than deleted.
_Avoid_: deriving termination from contract expiry or incomplete work, releasing capacity before the effective end, deleting Personnel or User, using one vague date for notice, final work, employment end, and access cutoff

**Offboarding Case**:
The coordinated set of separately owned tasks created by an Employment Termination Decision, including equipment return, document handover, payroll settlement, exit interview, ERP access revocation, and physical access revocation. Each task retains its owner, timing, status, and evidence. An unfinished settlement or unreturned asset remains an overdue post-employment obligation and never falsely keeps the Employment Relationship Active; historical attendance, approvals, contracts, assignments, and audit evidence remain intact.
_Avoid_: making employment end depend on every administrative task completing, merging access state with Employment Status, losing evidence after departure, one unowned offboarding checklist

**Suspended Employment Capacity**:
A Suspended Employment Relationship retains its capacity-bearing Position assignments because employment and permanent placement continue. Any temporary operational gap is covered through an acting assignment or other temporary coverage unless Human Resources explicitly changes or ends the permanent assignment.
_Avoid_: creating a permanent vacancy from suspension, triggering ordinary recruitment solely because of suspension, removing the employee's Position without an explicit HR decision

**Committed Position Capacity**:
Capacity reserved by a capacity-bearing assignment on an accepted, future-dated Planned Employment Relationship. It is not active headcount before the start date, but it closes the permanent vacancy so Recruitment does not hire against the same capacity again; an unaccepted offer remains in Recruitment and reserves nothing.
_Avoid_: counting a future hire as currently active, recruiting against capacity already committed to an accepted hire, reserving capacity for an unaccepted offer

**Expired Employment Contract**:
An Employment Contract whose end date has passed without a recorded renewal or replacement. It creates an urgent Human Resources action but does not automatically end the Employment Relationship, release Position capacity, remove attendance expectations, or revoke access.
_Avoid_: treating contract expiry as automatic termination, silently releasing staffing capacity, continuing without an HR alert

**Governing Employment Contract**:
The single Employment Contract whose effective period governs an Employment Relationship on a given date. Renewals are sequential governing contracts, while corrections and changed clauses are amendments to the applicable contract rather than overlapping governing contracts.
_Avoid_: multiple governing contracts active on the same date, representing an amendment as a competing contract, using a second contract to compensate a secondary or acting assignment

**Employment Type**:
The classification of how a person works within an Employment Relationship, such as full-time, part-time, seasonal, or trainee work. It is distinct from the legal form of the governing contract.
_Avoid_: Contract Type, Position, Employment Status

**Contract Type**:
The classification of the legal form used by a Governing Employment Contract, independent of the employee's working arrangement.
_Avoid_: Employment Type, Contract Status, using one combined classification for legal form and working arrangement

**HR Classification Catalog**:
A Human Resources-managed list of stable coded classifications, including Employment Types and Contract Types, whose Persian names and descriptions may evolve. Deactivation prevents future selection while preserving the classification on historical records.
_Avoid_: hardcoded display values that require software migrations, deleting catalog values used by history, allowing a renamed label to change a stable business identity

**Personnel Document**:
A versioned record with a document category, confidentiality level, source, effective and expiry dates, and retention policy. Identity, contract, compensation, disciplinary, and medical categories have separately scoped permissions rather than inheriting one broad HR view. Medical evidence is highly restricted: a Responsible Supervisor sees only the necessary operational result, while Security sees only approved absence and coverage consequences. Viewing, downloading, replacing, and exporting sensitive documents are audited; replacement creates a new version instead of overwriting the prior evidence. Expiry raises an alert but does not itself end employment or invalidate a decision unless an explicit policy requires that consequence.
_Avoid_: general HR access exposing every document, supervisors seeing diagnoses or medical attachments, Security seeing medical details, overwriting evidence, unaudited export, treating document expiry as automatic employment termination

**Assignment Context**:
The Organizational Unit, Workplace, Cost Center, and shift context actually applicable to an Employment Assignment for its effective period. Position values provide the defaults for minimal entry, while explicit assignment values and overrides preserve the context used by historical staffing, attendance, payroll, and reporting.
_Avoid_: deriving history from today's Position defaults, storing mutable placement only on Personnel, requiring repeated entry when Position defaults already apply

**Security Rota**:
The Security-owned operational plan that assigns eligible guards to coverage duties. It consumes HR-owned expected-work schedules and approved leave but does not replace the canonical employee Work Schedule or define company-wide attendance expectations.
_Avoid_: a second employee schedule source of truth, letting operational guard coverage redefine HR work expectations, using the guard rota for general personnel attendance

**Applicable Work Schedule**:
The single expected-work schedule selected for Personnel at a moment by precedence: an effective Personnel Schedule Override, then the Employment Assignment schedule or Shift Pattern, then the Position default. If none exists, the schedule is undefined and requires Human Resources attention.
_Avoid_: combining multiple schedule sources, silently choosing an arbitrary source, treating an undefined schedule as a non-working day

**Personnel Schedule Override**:
An effective-dated exception that temporarily replaces the otherwise Applicable Work Schedule for one Personnel. A person may have at most one active override at any moment, and the system rejects overlapping override periods rather than resolving them through hidden priority.
_Avoid_: overlapping overrides, editing the underlying Position or Assignment for a temporary change, internal priority that is invisible to users

**Rotating Shift Pattern**:
A reusable repeating cycle of work intervals and non-working periods with an Anchor Date that identifies the first day of the cycle. The applicable cycle day for any later date is calculated from that anchor; a temporary deviation is a Schedule Override rather than a change to the Pattern.
_Avoid_: a rotating cycle without an Anchor Date, editing the Pattern for one person's temporary change, generating independently editable daily copies as the source of truth

**Shift Pattern Version**:
An effective-dated version of a Shift Pattern. A permanent cycle or anchor change creates a new version or new schedule assignment from its effective date and never overwrites the Pattern that governed earlier dates.
_Avoid_: retroactively changing historical expected work, editing an old version in place, using a temporary Override for a permanent cycle change

**Schedule-Level Non-Overlap**:
The rule that at most one schedule source of the same precedence level may apply to a Personnel at any moment. Conflicting effective periods at one level are rejected rather than resolved by invisible priority.
_Avoid_: simultaneous same-level schedules, last-write-wins scheduling, undocumented internal precedence within one level

**Finalized Attendance Schedule Evidence**:
The expected-work evidence retained when attendance is finalized, containing either the applicable schedule snapshot or an immutable reference to the exact schedule or Shift Pattern version that governed that attendance.
_Avoid_: recalculating finalized attendance from current schedules, losing the governing version, changing historical lateness or overtime after a future schedule update

**Base Assignment Schedule**:
The expected-work schedule supplied by the primary Employment Assignment. It is the base used for attendance unless a Personnel Schedule Override temporarily replaces it.
_Avoid_: deriving competing base schedules from secondary or acting assignments, using assignment priority that is not visible to Human Resources

**Schedule-Contributing Assignment**:
A secondary or acting Employment Assignment explicitly marked to add recurring expected-work intervals to the base schedule. Non-contributing assignments add no attendance expectation, and contributing intervals must not overlap the base or another contributing interval.
_Avoid_: letting every additional assignment silently change attendance, overlapping expected-work intervals, using a secondary assignment to replace the base schedule

**Combined Expected Schedule**:
The Base Assignment Schedule, or its temporary Personnel Schedule Override, together with every applicable non-overlapping Schedule-Contributing Assignment interval.
_Avoid_: choosing only one responsibility when several explicitly contribute hours, double-counting overlapping intervals, treating titles without schedule contribution as expected work

**Schedule Override Scope**:
The explicit boundary of a Personnel Schedule Override. Base-only scope replaces the Base Assignment Schedule while applicable Schedule-Contributing Assignments remain active; whole-schedule scope temporarily replaces both the base and all additive assignment intervals. Base-only is the default.
_Avoid_: silently suspending secondary duties, making override scope implicit, applying a whole-schedule replacement when only the primary schedule was intended

**Base-Only Override Conflict**:
An invalid schedule state in which a base-only Personnel Schedule Override overlaps an applicable Schedule-Contributing Assignment interval. The system rejects the Override and identifies the conflicting assignment, dates, hours, overlap, and explicit resolution choices rather than accepting a warning.
_Avoid_: warning-only confirmation, silently merging overlapping intervals, saving an ambiguous schedule and deferring the conflict to attendance or payroll

**Expected Assignment Hours**:
The non-overlapping intervals added by an explicitly Schedule-Contributing secondary or acting assignment to the Combined Expected Schedule. They carry ordinary lateness and absence expectations and are not overtime merely because they fall outside the primary assignment's base hours; compensation for the added responsibility is determined separately by assignment and payroll rules.
_Avoid_: classifying one interval as both mandatory attendance and automatic overtime, ignoring absence from additive expected hours, deriving responsibility compensation solely from clock time

**Overtime Candidate**:
System-calculated extra presence outside the Combined Expected Schedule, based on immutable actual entry and exit evidence. It is not payable overtime until the responsible supervisor explicitly confirms that the work was authorized and performed.
_Avoid_: paying from clock presence alone, letting Security determine compensation entitlement, deleting raw attendance when the candidate is rejected or corrected

**Approved Overtime**:
An Overtime Candidate confirmed by the responsible supervisor and available for Human Resources review and Payroll consumption. Human Resources may correct attendance or classification while preserving the raw entry/exit evidence and the approval audit trail.
_Avoid_: sending pending or rejected candidates to Payroll, modifying raw attendance to force a payment result, losing who approved or corrected the classification

**Responsible Supervisor**:
The one accountable Personnel selected for an Employment Assignment from active occupants of its supervising Position. A sole eligible occupant is suggested or selected automatically; when several are eligible, saving the subordinate assignment requires an explicit selection whose effective period is fully covered by the supervisor's active assignment. Supervisor changes are effective-dated and preserve earlier responsibility.
_Avoid_: arbitrary selection among multiple occupants, a supervisor outside the supervising Position, responsibility extending beyond the supervisor's assignment, deleting previous supervisor history

**Approval Actor Snapshot**:
The immutable identity evidence attached to an approval, including the actual approver's Personnel or User identifier and displayed identity at the time of action. Later supervisor, assignment, account, or name changes do not rewrite who performed the historical approval.
_Avoid_: deriving the historical approver from today's reporting line, replacing the actual actor with a Position label, losing approver identity after organizational change

**Vacant Supervisor Escalation**:
The visible temporary approval route used when a supervising Position has no active occupant. Human Resources is alerted to create an effective-dated acting assignment, while urgent approvals escalate to the nearest occupied supervising Position above it and retain the escalation reason, route, and actual approver in the audit trail.
_Avoid_: silently choosing an unrelated manager, permanently blocking urgent approvals, treating escalation as a substitute for filling the reporting gap, hiding that the normal supervisor was vacant

**Identity-Incomplete Personnel**:
A provisional Personnel identity created before a reliable National Code or equivalent identity document is available. It remains visibly flagged for Human Resources completion and duplicate review without blocking early recruitment, onboarding, or essential operational setup.
_Avoid_: requiring National Code before any provisional record, treating a provisional record as identity-verified, hiding the incomplete identity state

**Candidate**:
A reusable recruitment-bank identity for a person who may pursue different opportunities at Sabalan over time. Identity, contact details, resume, skills, and employment history belong to the Candidate and survive individual application outcomes.
_Avoid_: Personnel before hiring, duplicating the person for every vacancy, storing vacancy-specific decisions on the reusable profile

**Job Application**:
The Candidate's pursuit of one approved vacancy or Recruitment Request. Screening, interviews, assessments, proposed compensation, and the final decision belong to that Application, while hiring links the Candidate to a Personnel identity without deleting recruitment history.
_Avoid_: overwriting an earlier application with a later one, treating Candidate and Application as one record, deleting recruitment evidence after hiring

**Recruitment Request**:
The approved authorization to recruit a defined number of people into a specific Position. Formal Job Applications belong to an approved request; each accepted hire consumes one requested opening and committed Position capacity, and the request closes when its openings are filled or explicitly cancelled.
_Avoid_: informal hiring outside approved structure, accepting more hires than authorized openings, treating an unsolicited resume as a formal Application before it is linked to a request

**Talent-Bank Candidate**:
A Candidate retained by Human Resources without a current formal Job Application. The profile may later be linked to an approved Recruitment Request without duplicating the person or inventing an earlier application history.
_Avoid_: discarding unsolicited resumes, counting talent-bank profiles as active applicants, placing a Candidate in a hiring pipeline without an approved request

**Vacancy-Fill Request**:
A Recruitment Request that uses currently available approved Position capacity.
_Avoid_: recruiting without an actual vacancy, increasing Position capacity implicitly

**Planned-Replacement Request**:
A Recruitment Request linked to the departing Personnel and Employment Assignment with an expected end date. Recruitment may begin before departure, but the accepted hire's capacity commitment starts after the departure unless an explicit handover overlap is approved.
_Avoid_: waiting until departure to begin all replacement recruitment, double-filling capacity without an approved handover, losing which assignment is being replaced

**Capacity-Increase Request**:
A Recruitment Request whose purpose is to add authorized Position capacity. The capacity increase must be explicitly approved before the request enters formal recruitment.
_Avoid_: treating growth as an ordinary vacancy, allowing a hire to increase headcount implicitly, recruiting against unapproved capacity

**Recruitment Request Approval**:
The type-aware authorization of a Recruitment Request. Vacancy-fill and planned-replacement requests require the Responsible Supervisor or Manager followed by Human Resources; a Capacity-Increase Request additionally requires authorized executive or budget approval.
_Avoid_: one undifferentiated approval flow, letting Human Resources silently authorize increased headcount cost, requiring executive approval for every routine replacement

**Handover Overlap**:
An explicitly approved date range during which the departing and incoming assignments may temporarily exceed a Position's ordinary capacity for knowledge transfer. It belongs to a Planned-Replacement Request and does not permanently increase approved capacity.
_Avoid_: hidden double occupancy, permanent capacity growth through a replacement workflow, overlap without start and end dates or accountable approval

**Approver Assignment**:
An effective-dated assignment of a named approval responsibility, such as Human Resources approval or workforce capacity/budget approval, to an eligible accountable person. Business authority is resolved from this assignment rather than a hardcoded user or broad application role, while every completed decision retains its Approval Actor Snapshot.
_Avoid_: treating every MANAGER as authorized, hardcoding a current approver, rewriting old authority after responsibility changes, silently approving when no eligible approver is configured

**Application Stage**:
The minimal visible phase of a Job Application: Received, Screening, Assessment, Offer, or Closed. Detailed interviews, tests, reviews, approvals, and transitions are checklist items and append-only history events rather than additional mandatory stages.
_Avoid_: turning every recruitment activity into a status, forcing every Candidate through irrelevant steps, losing activity history because only the current stage is stored

**Application Outcome**:
The reason a Job Application is Closed: Hired, Rejected, Withdrawn, or Recruitment Request Cancelled. Hired closes recruitment selection but its Guided Hiring Lifecycle continues through Planned Employment preparation and activation; the other outcomes terminate the lifecycle without reopening or deleting the Application.
_Avoid_: a generic closed state without reason, treating Hired as completed Employment activation, treating withdrawal as rejection, reopening or deleting closed recruitment history

**Recruitment Checklist Template**:
The Job- or Position-specific definition of required and optional screening, interview, test, reference, certificate, and approval activities inside the fixed Application Stages. A Job Application snapshots the applicable template version when entering the pipeline so later template changes do not rewrite its required work or history.
_Avoid_: one universal assessment sequence for every Job, adding custom pipeline stages per Position, recalculating an active Application from a later template version

**Candidate Profile**:
The reusable Candidate-owned recruitment information shared across Applications, including identity and contact details, resume, education, skills, languages, and employment history.
_Avoid_: vacancy-specific decisions, internal interviewer notes, duplicating the profile for every Application

**Application Form**:
The Position- or Recruitment Request-specific candidate responses for one Job Application, including availability, desired compensation, declarations, and configured questions.
_Avoid_: copying every historical paper field into every application, storing reusable Candidate facts repeatedly, exposing internal assessment content

**Candidate Questionnaire Scope**:
The candidate-facing questionnaire contains the applicable personal and contact information, address and postal code, education, employment history, skills, languages, work preferences, requested Position, desired compensation, declaration, and configured written questions. Full name, alias response, birth date and place, military-service status, father's name and occupation, marital status, residential address, mobile and home-phone responses, latest education level, field of study, graduation year, social-media response, and Iranian National Code are required for Human Resources record completeness; number of children and spouse's occupation appear and become required only when the Candidate is married, while a Candidate to whom National Code does not apply supplies a classified foreign identity type and number instead, and none of the family or social details may drive automated scoring, filtering, or rejection.
_Avoid_: exposing internal assessments to the Candidate, silently using family or social details as screening criteria, automatic rejection from record-completeness fields, an undocumented reviewer decision based on sensitive details

**Required Candidate Response**:
A questionnaire requirement satisfied by a valid value or, where the information may legitimately be absent or unavailable, a structured reason such as none, unknown, deceased, or cannot provide, with an explanation when the selected reason requires context.
_Avoid_: invented placeholder data, treating absence as an empty string, free-text variants when a controlled reason applies, accepting an unexplained exceptional reason

**Candidate Social-Security History Indicator**:
The Candidate's required yes-or-no response to whether they have prior تأمین اجتماعی insurance history, together with an HR-reviewed state and optional note. The first version collects no insurance number, provider, history detail, attachment, or external verification and does not block hiring or activation.
_Avoid_: treating the response as verified insurance eligibility, requiring future-detail fields prematurely, making a yes or no answer an employment blocker

**Candidate Identity Document Checklist**:
The versioned Human Resources-owned requirements for identity evidence, including every birth-certificate page, a separate conditional explanation-section scan when it contains information, both sides of the National ID card, and applicable foreign identity, military-service, education, photograph, or Job-specific evidence. Each item is missing, received, unreadable, mismatched, verified, or not applicable, and a replacement creates a new version rather than overwriting rejected evidence; Iranian National Code is compared with the National ID evidence before identity verification.
_Avoid_: one unchangeable document list, merging multi-side evidence into an ambiguous attachment, deleting an unreadable or mismatched version, verifying a conditional document without recording applicability

**HR-Captured Candidate Document**:
Private, versioned recruitment evidence scanned and uploaded only by an HR Processor after recording whether the original was inspected or only a copy was received. The Candidate portal exposes safe missing or replacement requests but not internal comparison notes; files are malware-checked and available only through authorized, audited delivery rather than public links.
_Avoid_: Candidate-uploaded identity evidence in the first version, a scan without inspection-source metadata, public file URLs, replacing a rejected version, exposing internal reviewer notes

**Candidate Identity Verification**:
The field-level Human Resources comparison of an Application Form Submission with received identity evidence: an HR Processor records documents and marks each check as matching, mismatched, or unverifiable with its note, while only the designated HR Manager grants final identity clearance. A mismatch or unverifiable required fact blocks clearance until Human Resources returns the identified Candidate fields for resubmission or requests replacement evidence; generic HR workspace or Admin access does not confer approval authority, and Human Resources never silently edits the Candidate's submission.
_Avoid_: one unexplained overall checkbox, self-approval by the processor, generic permission as business authority, approving unresolved discrepancies, changing Candidate answers on their behalf, replacing evidence without version history

**Candidate Correction Request**:
A single candidate-facing request issued after Human Resources finishes reviewing an Application Form Submission and identifies one or more fields that the Candidate must correct. The request preserves every prior draft and submitted revision, reopens only the identified fields, and sends one SMS directing the Candidate to the fixed `/apply` page. A still-valid Application-specific OTP remains usable without being repeated in the correction SMS; if access has expired or been revoked, Human Resources issues a replacement OTP for the same Job Application without deleting or resetting any Candidate information, form revision, correction history, or recruitment evidence.
_Avoid_: sending one SMS for every mismatch click, exposing internal field keys, reviewer notes, or sensitive values in SMS, resending an unrecoverable raw OTP, reopening the whole form, creating a new Application for correction, or discarding saved Candidate data when access is replaced

**Deferred Candidate Postal-Code Verification**:
The required 10-digit postal-code response whose basic format is validated while external verification remains explicitly not performed. Its deferred status is visible but blocks no recruitment, conversion, contract, or activation transition; a future verification service may queue historical values without retroactively invalidating completed hires.
_Avoid_: labeling format validation as external verification, blocking today's workflow on an unavailable service, dropping the field, treating a later failed check as automatic retroactive termination

**Candidate Mobile Invitation**:
Application-scoped access issued by Human Resources as a six-digit OTP sent to a normalized snapshot of the Candidate's recorded mobile number. The Candidate enters that same mobile number and OTP at the fixed public `/apply` entry page, and the pair opens only the associated open Job Application; separate active Applications for the same mobile receive distinct OTPs and are never listed or disclosed by the public page. Editing the Candidate's current mobile does not transfer access: Human Resources must issue a replacement invitation to the new number. The pair remains reusable across devices for seven days; five incorrect codes temporarily lock invitation verification for that mobile across its Applications for fifteen minutes without ending existing verified sessions. A successful verification creates an Application-only browser session that survives reloads but ends when the browser session closes, the Candidate signs out, Human Resources replaces the invitation, the invitation expires, or the Application closes; saved drafts and submitted revisions remain as recruitment evidence. Final submission makes the form read-only unless Human Resources returns specified fields for correction. Public verification gives indistinguishable responses for unknown mobiles and invalid, expired, revoked, or closed-Application invitations, and reveals Candidate or Application details only after success.
_Avoid_: a dynamic or personal SMS link, treating the invitation as a User login or two-factor authentication, opening or revealing another Candidate's Application, reusing one OTP across Applications, granting HR workspace access, applicant enumeration through error details, discarding drafts when access is reissued

**Candidate Recruitment Case**:
The continuous pre-employment record presented under `جذب و پرونده‌های متقاضیان`, linking the Candidate, Job Application, cross-functional clearances, Hire Conversion, onboarding, and activation while preserving each record's ownership and confidentiality boundary.
_Avoid_: استخدام و متقاضیان, a disconnected applicant list, copying confidential recruitment evidence into the general Personnel profile

**Personnel and Employment Relationships**:
The post-conversion workforce view presented under `پرسنل و روابط استخدامی`, containing enduring Personnel identity and effective-dated Employment Relationships and Assignments, with a permanent link to the originating Candidate Recruitment Case when one exists.
_Avoid_: پرسنل و استخدام, treating Personnel and an employment period as one record, losing recruitment provenance

**Exceptional Personnel Registration**:
A reasoned, audited creation of Personnel and initial employment foundation by an assigned Human Resources Manager for data migration, historical correction, or organizational transfer when no ordinary Candidate Recruitment Case applies.
_Avoid_: a routine shortcut around recruitment controls, an unlabeled direct hire, generic HR edit permission, unaudited manual creation

**Application Form Submission**:
An immutable, timestamped version of the Application Form created by the Candidate's final submission. Human Resources may return it with a reason and explicitly identified fields for correction; only the Candidate revises those fields and resubmits as a new preserved version.
_Avoid_: editing a final submission in place, Human Resources silently changing Candidate answers, reopening every field without reason, losing earlier submissions or timestamps

**Candidate Submission Declaration**:
The Candidate's explicit truthfulness attestation made by accepting the declaration, typing their full name, and submitting from an OTP-verified Application session. Its audit evidence retains the submission version, timestamp, masked mobile number, and available IP and device metadata, but it is not the employment contract signature.
_Avoid_: an implicit declaration, treating OTP access alone as acceptance, replacing the later paper contract signature, losing the declaration evidence when the form is corrected

**Internal Candidate Assessment**:
Restricted recruitment evidence created by authorized Sabalan reviewers, including interview notes, psychological or aptitude test results, management assessment, and hiring recommendations.
_Avoid_: candidate-editable assessment, exposing confidential notes in candidate-facing views, treating assessment evidence as reusable Candidate identity data

**Candidate Assessment Score**:
A required score from zero through one hundred inclusive, with at most two decimal places, entered using Persian, Arabic, or Latin digits and normalized before validation. The Human Resources interface reports an invalid score beside its field and blocks submission, while the server independently rejects the same invalid value; neither layer silently clamps an out-of-range score.
_Avoid_: accepting a score below zero or above one hundred, relying only on browser number controls, accepting excessive decimal precision, silently changing an invalid score to a boundary value, or rejecting otherwise valid Persian or Arabic digits

**Human Resources Interface Language**:
Persian user-facing language throughout the Human Resources workspace and Candidate `/apply` experience, covering system-provided roles, statuses, labels, buttons, headings, validation messages, and audit-event descriptions while internal API and persistence identifiers remain stable and untranslated. Assessment titles are the deliberate exception and appear with the English assessment name first followed by its Persian name in parentheses: `DISC (ارزیابی الگوی رفتاری دیسک)`, `BIG FIVE (ارزیابی پنج عامل بزرگ شخصیت)`, and `EQ (ارزیابی هوش هیجانی)`. User-entered content, uploaded filenames, email addresses, and unavoidable external reference codes remain as supplied.
_Avoid_: leaking internal values such as `HR_MANAGER`, `APPROVED`, or `CANDIDATE` into the interface, translating stored identifiers, showing English role or status labels, removing the approved bilingual assessment names, expanding the bilingual exception to unrelated interface text, or altering user-supplied content

**Human Resources Calendar Presentation**:
Jalali calendar input and display with Persian digits throughout the Human Resources workspace and Candidate `/apply` experience, including recruitment, Personnel, employment, contracts, onboarding, audit history, filters, and reports. Date-times are presented in Tehran time, and date-only values such as birth or planned-start dates remain date-only without timezone drift. APIs and persistence continue to use Gregorian/ISO representations for interoperability; existing stored values are converted for presentation without rewriting their historical storage solely for display.
_Avoid_: native Gregorian date inputs in Human Resources, mixed Jalali and Gregorian display, Latin digits in presented dates, shifting a date-only value during UTC conversion, storing Jalali display strings as canonical timestamps, or rewriting existing data merely to localize its presentation

**Candidate Portal Theme**:
The readable light and dark presentation of the Candidate `/apply` experience, defaulting a first-time visitor to light mode while offering a visible local theme toggle and remembering that device preference independently of Application data. Every surface and state defines compatible foreground, background, border, placeholder, disabled, error, and success colors rather than mixing hard-coded light surfaces with inherited dark text rules; automated visual checks cover both themes.
_Avoid_: white text inherited onto a white card, light text or placeholders disappearing in disabled sections, forcing Candidates into the authenticated workspace theme, storing theme preference in recruitment evidence, omitting a visible toggle, or validating only one theme

**Human Resources Workspace Theme**:
The readable light and dark presentation of every authenticated Human Resources page and its shared HR dialogs, tables, forms, navigation, lifecycle cards, statuses, and notifications. Theme correctness is validated across ordinary, disabled, pending, error, success, selected, and hover states using shared semantic colors; this audit is scoped to the Human Resources workspace and `/apply`, not unrelated ERP workspaces.
_Avoid_: fixing only the reported recruitment page, relying on broad CSS overrides that destroy semantic status colors, leaving hidden text in an untested state, or expanding the requested audit into Sales, Accounting, Inventory, Logistics, CRM, Security, or Administration

**Candidate Assessment Completion**:
The HR Processor's explicit, timestamped confirmation that at least one valid Internal Candidate Assessment is active and assessment recording is complete enough to hand the Job Application to the Hiring Manager. It completes the Assessment phase and focuses the Guided Hiring Lifecycle on Offer and Acceptance, but does not make the hiring decision, create an offer, approve compensation, or grant the HR Processor Hiring Manager authority. Adding, correcting through a new version, or voiding an assessment afterward reopens completion; before an offer exists the HR Processor must complete the phase again, while an existing offer is visibly blocked from further approval or Candidate acceptance until the Hiring Manager reviews and acknowledges the changed assessment evidence. An already accepted offer is not silently cancelled but the case remains blocked for managerial review.
_Avoid_: treating the presence of one saved assessment as implicit completion, completing an empty assessment set, deriving completion from offer creation, letting the HR Processor make the Hiring Manager's decision, creating an offer as a side effect of assessment completion, editing or deleting assessment evidence in place, changing evidence behind an active offer without re-review, or silently revoking an accepted offer

**Justified Recruitment Field**:
A field from the source questionnaire that Human Resources explicitly classifies as required, optional, or omitted for a defined recruitment purpose. Sensitive family, social, or personal details are not mandatory merely because they appeared on the paper form.
_Avoid_: one-to-one digitization without purpose review, collecting every available personal detail, hiding why a sensitive field is required

**Recruitment Data Scope**:
The field-group access granted to a participant according to their assigned recruitment responsibility. Candidate self-service, interviewer work, hiring-manager decisions, Human Resources processing, identity documents, assessments, compensation, and confidential notes are distinct scopes rather than one HR-wide view.
_Avoid_: treating HR workspace VIEW as access to every candidate field, showing internal assessments to Candidates, exposing unnecessary identity or family data to interviewers or hiring managers

**Sensitive Recruitment Access Event**:
The audit evidence produced whenever protected candidate identity, document, psychological assessment, compensation, or confidential-note data is viewed, changed, exported, or downloaded.
_Avoid_: auditing only edits, untracked document downloads, relying on hidden interface controls as privacy enforcement

**Recruitment Data Retention**:
The configurable period and disposition for closed Job Applications and Candidate data. Rejected or withdrawn case evidence—including sensitive documents, DISC/BIG FIVE/EQ results, insurance information, decisions, and audit history—remains stored under its category-specific restricted retention policy; the initial Candidate declaration provides notice and recorded consent for only the ordinary Candidate Profile to remain talent-bank searchable without a second permission request after closure, while sensitive evidence is excluded from talent-bank search and may expire sooner.
_Avoid_: immediate deletion of defensible history, indefinite retention by default, searchable sensitive documents or assessments, a second post-rejection permission flow, forcing every recruitment data group to share one retention duration

**Verified Hire Transfer**:
The explicit mapping that links or creates Personnel from a hired Candidate and transfers only approved, verified identity, contact, education, skill, certificate, and required document data with source provenance. Conflicting existing Personnel values require Human Resources review, while Internal Candidate Assessments remain in restricted Recruitment history.
_Avoid_: copying the entire recruitment file into Personnel, silently overwriting verified personnel data, losing where a transferred value came from, exposing confidential interview or psychological evidence through the general personnel profile

**Accepted Offer**:
The Candidate's recorded acceptance of the latest fully approved offer, performed directly through the Application portal or captured as an audited Offline Candidate Offer Acceptance by an HR Processor. Direct portal acceptance requires a dedicated confirmation checkbox and a freshly typed full name that matches the latest submitted Application Form after harmless Persian character, whitespace, and zero-width-character normalization; it is distinct from the earlier Candidate Submission Declaration. The Job Application remains in the Offer stage pending successful employment conversion; acceptance does not by itself create Personnel employment, reserve capacity, or mean Hired.
_Avoid_: accepting an internally incomplete or obsolete offer version, reusing hidden or stale declaration state, prefilling away deliberate acceptance, rejecting equivalent Persian `ی/ي` or `ک/ك` spelling and spacing, tolerating a genuinely different or reordered name, obscuring whether the Candidate acted directly or HR recorded offline consent, treating verbal or recorded acceptance as completed hiring, closing the Application before employment records exist, partially creating employment after acceptance

**Declined Offer**:
The Candidate's direct portal decision, or an HR Processor's documented offline record, that the latest fully approved offer is not accepted. It requires a structured Persian reason category and may include an explanatory note, blocks Hire Conversion, and notifies the responsible Hiring Manager and HR Processor without automatically closing the Job Application. The Hiring Manager may respond with a new offer version or explicitly close the Application with the appropriate outcome; every earlier offer and decline remains preserved and audited.
_Avoid_: treating silence as decline, declining an obsolete or internally incomplete offer, converting after decline, automatically closing the Application without a Hiring Manager decision, overwriting the declined offer, losing the Candidate's reason, or omitting offline declines from the audit history

**Offline Candidate Offer Acceptance**:
An HR Processor's final, audited record that the Candidate accepted the latest fully approved Offer Compensation Summary through a documented phone call, in-person meeting, or other approved offline channel when SMS delivery fails or the Candidate cannot use `/apply`. It records the communication method and time, the Candidate's confirmed full name, the reason for using the offline path, and an explanatory note; it remains visibly distinct from direct portal acceptance and cannot be silently edited or replaced.
_Avoid_: describing the HR Processor as the accepting party, using offline acceptance before all internal approvals, accepting an older offer version, recording consent without communication evidence, hiding the recording HR Processor, editing the acceptance in place, or requiring a second HR approver when the authorized processor has captured the required evidence

**Offer Compensation Summary**:
The itemized ریال-denominated snapshot of proposed base salary and each recurring benefit or allowance, prepared before contract signing and explicitly accepted by the Candidate as part of the offer. The signed contract references or includes this approved snapshot, and the post-contract salary-and-benefits table displays the same immutable rows and calculated total; later changes require a new effective-dated Compensation Agreement.
_Avoid_: entering compensation only after signing, a manually typed total without components, different offer and contract values, editing the accepted snapshot for a later raise

**Offer Compensation Approval**:
The sequential authorization in which the Hiring Manager proposes the package, an HR/Payroll Processor classifies its components, the designated HR/Payroll Manager approves payroll and policy correctness, and the Finance Manager approves the financial commitment before Candidate presentation. Each pending step identifies its responsible business role rather than a preassigned individual; after completion, it identifies the actual participant and timestamp. The displayed chain applies only to the latest offer version. A participant cannot approve their own preparation, and Finance later compares the signed contract with this snapshot without editing it.
_Avoid_: Candidate presentation before all approvals, implying a pending step belongs to a named person when it remains role-owned, hiding the actual completed approver or time, mixing approvals from different offer versions, self-approval, an unclassified lump sum, Finance changing HR/Payroll components during contract verification

**Candidate Offer Notification**:
The idempotent SMS notification sent automatically after the latest Offer Compensation Summary receives every required internal approval, directing the Candidate to the fixed `/apply` page. A still-valid Application-specific OTP remains usable without being repeated; if access has expired or been revoked, the system issues a replacement OTP for the same Job Application without changing Candidate information or recruitment history. SMS failure does not reverse the completed offer approvals, remains visibly failed in the Human Resources case view, and can be retried explicitly without producing duplicate successful notifications.
_Avoid_: presenting an internally incomplete offer, repeating a recoverable secret that the system does not store, creating a new Application when access expires, discarding Candidate data during access replacement, rolling back approval because an external SMS provider failed, silently losing notification failure, or sending duplicate SMS messages on page refresh

**Pre-Hire Collateral Clearance**:
The Finance-owned review of required collateral and obligations that begins only after Candidate selection and Accepted Offer. A Finance recorder registers receipt, custody details, and scans, while the designated Finance Manager alone verifies and approves the clearance required before Hire Conversion; Candidates who are rejected, withdrawn, or still under assessment are not asked to provide collateral.
_Avoid_: collecting collateral from every applicant, self-approval by the recorder, Human Resources or a generic Admin approving Finance evidence, converting to Personnel before manager clearance, treating offer acceptance as collateral approval

**Pre-Hire Collateral Checklist**:
The versioned Finance-owned template selected for a Job or Position that defines required and optional collateral items such as promissory notes, cheques, guarantees, undertakings, or an explicitly classified other item. Each received item retains its applicable amount, identifier, issuer or guarantor, receipt date, original custody location, versioned scans, verification result, and eventual return or release status.
_Avoid_: one hardcoded checklist for every Job, an unclassified attachment, a scan without original-custody evidence, losing an instrument's return history

**Signed Employment Contract Clearance**:
The Finance-owned evidence that every required page of the paper employment contract was signed and uploaded with its contract metadata by a Finance Processor, then checked for signatures, completeness, dates, and readability and approved only by the designated Finance Manager. Human Resources may view the contract and status but cannot substitute for approval; replacements create new versions, and manager clearance is an Employment activation blocker.
_Avoid_: processor self-approval, partial-page evidence, Human Resources or generic Admin approval, overwriting an earlier scan, activating employment from an unapproved contract

**Collateral Data Scope**:
The access boundary in which Human Resources sees checklist progress, item categories, coordination reasons for missing or rejected items, and the final clearance decision, while instrument identifiers, amounts, guarantor details, custody locations, and scans remain restricted to authorized Finance users. Viewing or downloading protected collateral data produces audit evidence.
_Avoid_: broad HR or Admin access to instrument details, client-side-only hiding, unaudited views or downloads, exposing Finance evidence merely to coordinate checklist progress

**Hire Conversion**:
The atomic operation available after HR identity clearance and Finance collateral clearance that links or creates Personnel, creates the Planned Employment Relationship and capacity-bearing primary Employment Assignment, reserves committed capacity, links the source Application and Recruitment Request, and opens onboarding without creating a User account. The Application receives the Hired outcome only after the whole conversion succeeds; onboarding tasks and planned duties may be tracked, but ordinary work, payroll participation, and employment activation remain blocked until contract approval unless a valid Pre-Activation Activity Permit authorizes limited activity.
_Avoid_: partial hiring records, marking Hired before conversion completes, consuming an opening or capacity without the linked employment foundation, creating login access implicitly, treating planned employment as active work authorization

**Pre-Activation Hiring Cancellation**:
The reasoned closure when a selected Candidate withdraws or is rejected before Employment activation: the Application receives its exact outcome, any Planned Employment Relationship and assignment are cancelled without deleting Personnel, committed capacity is released, and pending User provisioning is cancelled. Administrative completion remains blocked until Finance returns or releases every collateral original with recipient, date, handover proof, and Finance Manager confirmation.
_Avoid_: deleting converted Personnel, leaving Position capacity committed, retaining collateral without an open obligation, generic closure without outcome, enabling a pending User after cancellation

**Employment User Provisioning Request**:
The Responsible Supervisor's request for ERP access when the Personnel's Position requires it, approved by the relevant workspace or data owners and fulfilled by an authorized User administrator by linking one User to the existing Personnel identity. Hire Conversion never creates the User automatically; the account remains disabled until its approved access-start time and receives only explicitly approved permissions.
_Avoid_: deriving login access from Personnel or Position alone, creating a second Personnel identity, enabling access before its approved start, generic default workspace permissions

**Onboarding Case**:
The new hire's effective onboarding file created by Hire Conversion from snapshots of the current company-wide checklist and the applicable Job or Position checklist. Later template changes do not rewrite an active or completed case.
_Avoid_: one universal checklist for every Job, recalculating active onboarding from current templates, losing which requirements applied when hiring occurred

**Unified Hiring Case View**:
The Human Resources-facing page and chronological progress view that presents the linked Candidate and Job Application before Hire Conversion, the resulting Personnel, Planned Employment Relationship, and Onboarding Case afterward, and cross-functional Finance tasks with their ownership and data restrictions intact. Candidate self-service exposes only Candidate actions and appropriate statuses, never internal assessments or protected Finance details.
_Avoid_: one duplicated master record, losing the Application-to-Personnel link, copying Finance evidence into HR data, exposing internal or financial details through the Candidate portal

**Guided Hiring Lifecycle**:
The evidence-derived progress and navigation model inside a Unified Hiring Case View, grouping the case into Formation and Applicant Form, Identity Review, Assessment, Offer and Acceptance, Collateral and Hire Conversion, Start Preparation, and Employment Activation. It reports phase position and completed mandatory items rather than a false global percentage, and guides work across ownership boundaries without allowing manual phase advancement or replacing the underlying domain controls.
_Avoid_: a manually advanced form wizard, treating every recruitment activity as an Application Stage, implying parallel work is strictly sequential, bypassing backend controls with next/previous navigation

**Hiring Lifecycle Phase Status**:
The single visible condition of a Guided Hiring Lifecycle phase: Completed, Action Required by You, Waiting, Blocked, Upcoming, or Terminated. Waiting is a healthy dependency on another participant, date, or event; Blocked means correction or intervention is required before the case can progress.
_Avoid_: presenting every delay as an error, hiding actionable work inside generic in-progress status, treating a rejected or withdrawn case as successful completion

**Hiring Lifecycle Completion Gate**:
The mandatory evidence that completes one Guided Hiring Lifecycle phase without inventing a new business approval. Optional assessments, non-blocking insurance work, and optional onboarding tasks remain visible but cannot block progress unless an explicit policy makes them mandatory.
_Avoid_: equating every checklist item with a blocker, hiding a rejected mandatory requirement, changing hiring policy through presentation logic

**Hiring Lifecycle Guidance Scope**:
The sanitized phase status, responsible function, explanation, and permitted next work visible to an authorized hiring participant. It prioritizes one unblocked action the participant can perform, retains other available parallel actions as secondary work, and shares the lifecycle map while Recruitment Data Scope continues to protect underlying details.
_Avoid_: hiding whole phases from non-owners, exposing protected evidence through progress explanations, confusing visibility of a phase with authority to act

**Onboarding Task**:
A company-wide or Job-specific onboarding requirement with mandatory or optional classification, accountable owner, due date, status, and completion evidence. Job-specific tasks cover training, safety, operational readiness, and authorizations without duplicating common administrative tasks.
_Avoid_: tasks without accountable ownership, completion without evidence when evidence is required, mixing common and Position-specific requirements into an unstructured note

**Onboarding Requirement Level**:
The operational effect of an Onboarding Task: Activation Blocker prevents the Employment Relationship from becoming Active; Post-Start Required permits activation but remains tracked and escalated until completion; Optional is situational or recommended and does not block activation.
_Avoid_: treating every task as a start blocker, silently ignoring overdue required work, letting an optional task prevent employment activation

**Independent-Work Blocker**:
A Job-specific Onboarding Task whose incompletion permits active employment and supervised work but forbids independent performance of the affected hazardous or controlled operation until training, clearance, and authorization are complete.
_Avoid_: confusing employment activation with equipment authorization, allowing independent hazardous work before clearance, preventing all supervised work when only independent operation is blocked

**Onboarding-Blocked Start**:
The condition in which a Planned Employment Relationship reaches its intended start date while an Activation Blocker remains incomplete. Employment stays Planned, Position capacity remains committed, Human Resources and the hiring manager are urgently alerted, and resolution requires completing the blocker or formally changing the start date.
_Avoid_: automatic activation to hide incomplete onboarding, releasing committed capacity, silently moving the start date, ignoring an overdue blocker

**Employment Activation Authorization**:
The designated HR Manager's explicit authorization to change a Planned Employment Relationship to Active on or after its scheduled start date, available only after approved identity and collateral clearances, accepted and approved compensation, signed-contract clearance, configured Payroll Participation, and completion of every Onboarding Activation Blocker. Reaching the date never activates employment automatically; unresolved requirements produce an urgent Onboarding-Blocked Start alert.
_Avoid_: date-only automatic activation, generic Admin authority, activation without payroll configuration or contract clearance, hiding an unresolved blocker by changing status

**Employment Insurance Enrollment**:
The HR-managed onboarding record for company insurance setup after Hire Conversion, with a state of not started, in progress, active, or exempt/not applicable, plus effective date, due date, and optional note. The first version has no insurance number, provider details, attachments, or external integration; it raises overdue alerts as a required onboarding task but does not block Employment activation.
_Avoid_: overwriting the Candidate's prior-insurance response, pretending external enrollment was verified, premature insurance subsystem detail, silently ignoring an overdue setup task

**Pre-Activation Attendance Evidence**:
Immutable actual presence recorded by Security for Personnel whose Employment Relationship has not yet been authorized to become Active. The record exposes the policy discrepancy and is never deleted or altered to make onboarding appear compliant.
_Avoid_: blocking Security from recording physical reality, treating attendance recording as employment authorization, deleting evidence after Human Resources resolves the onboarding problem

**Pre-Activation Activity Permit**:
A separate, explicit, time-bounded authorization for limited activity while the Employment Relationship remains Planned and Onboarding Blockers remain unresolved. It identifies the permitted activity and location, validity period, approving actor, required supervisor presence, device or system access restrictions, and exception reason; it never activates employment or removes an Activation Blocker.
_Avoid_: deriving permission from attendance, a broad permission to work normally, an undated or unscoped exception, treating the permit as completion or waiver of onboarding

**Pre-Activation Permit Approval**:
The scope-dependent authorization for a Pre-Activation Activity Permit: Human Resources and the Responsible Supervisor approve every permit, with additional safety or equipment authority for hazardous work and system or data owner approval for ERP or sensitive access. Security verifies a valid permit at entry but does not approve it; self-approval is forbidden, approvals retain actor snapshots, and the permit expires automatically.
_Avoid_: one generic approver for every risk, Security authorizing employment, self-approval, access continuing after permit expiry

**Payroll Participation**:
The effective-dated authorization that includes an Employment Relationship in payroll for a defined period, independently of Personnel activity, system access, Security roster membership, or recorded attendance.
_Avoid_: a mutable payroll-eligible flag, deriving payroll population from User, Personnel.isActive, roster, or attendance

**Compensation Agreement**:
The effective-dated agreement governing base pay and recurring person-level benefits for one Employment Relationship. Assignment-specific compensation is separate, and at most one Compensation Agreement governs a relationship at a moment.
_Avoid_: salary stored directly on Personnel, overlapping governing agreements, a second base salary for every Assignment

**Assignment Compensation Component**:
An effective-dated earning or allowance attributable to one Employment Assignment, such as responsibility, acting duty, shift, location, or hazardous-work compensation.
_Avoid_: base salary, inferring assignment compensation only from attendance, automatically paying every secondary assignment

**Payroll Policy Version**:
An approved effective-dated set of sourced statutory parameters, calculation rules, rounding behavior, and payroll-calendar policy that governs payroll for a period.
_Avoid_: hardcoded annual values, editing an active version in place, a policy value without source or effective date

**Payroll Policy Owner**:
The explicitly assigned person accountable for maintaining sourced Payroll Policy Versions, whose proposed version requires approval by a separate authorized reviewer before use.
_Avoid_: generic ADMIN authority, self-approved policy changes, software deployment as the ordinary annual policy process

**Payroll Component**:
A classified earning, deduction, employer contribution, or informational amount calculated by a controlled, explainable rule and displayed in ریال.
_Avoid_: an opaque net adjustment, arbitrary executable formula, an amount without classification or calculation trace

**Payroll Period**:
The Jalali calendar month for which a regular Payroll Run calculates compensation and deductions under an explicit cutoff and policy version.
_Avoid_: an unlabeled date range, Gregorian-month substitution, deriving the period from payment date

**Payroll Cutoff**:
The declared boundary through which finalized and approved workforce evidence is eligible to be snapshotted into a Payroll Run.
_Avoid_: querying mutable live data during approval, silently including later corrections, an implicit current-time boundary

**Payroll Run**:
The controlled calculation for one payroll period and run type, containing its snapshotted population, inputs, policy versions, component results, exceptions, approvals, and downstream status.
_Avoid_: a mutable spreadsheet total, recomputing an approved result from current data, one record that hides employee-level calculations

**Payroll Input Snapshot**:
The immutable population, employment, compensation, schedule, attendance, leave, overtime, mission, obligation, and policy evidence used by one Payroll Run.
_Avoid_: a live query presented as historical payroll truth, a value without source and version, replacing evidence after approval

**Payroll Blocking Exception**:
An unresolved condition for a payroll participant, such as missing exit, conflicting schedule, unresolved attendance correction, or pending overtime decision, that prevents the participant from being finalized.
_Avoid_: silently paying from incomplete evidence, omitting the employee, blocking review work for every unaffected employee

**Payroll Deferral**:
The authorized, reasoned decision to exclude one unresolved participant from final payment in the regular run and carry the obligation into a linked Supplemental Payroll Run.
_Avoid_: silent omission, deleting the participant, approving an incomplete run without an accountable decision

**Supplemental Payroll Run**:
A linked payroll calculation that pays or corrects amounts not finalized in the regular run without changing the approved original.
_Avoid_: reopening an approved run, an unlinked manual payment, overwriting the original payslip

**Payroll Reversal Run**:
A linked payroll calculation that formally reverses all or part of an approved payroll result while preserving the original calculation and financial history.
_Avoid_: deleting an approved result, negative free-text adjustment without source, changing posted lines in place

**Approved Payroll Run**:
A Payroll Run whose population, evidence, policies, calculations, approvals, and results are immutable and ready for controlled Accounting consumption.
_Avoid_: editable approved payroll, approval with unresolved or undeferred participants, treating calculation completion as approval

**Payroll Separation of Duties**:
The rule that preparation, material adjustment, policy activation, and final approval require appropriately distinct accountable actors, including during ordinary administrator operation.
_Avoid_: self-approval, generic ADMIN bypass, one person controlling policy, calculation, approval, and payment

**Payroll Accounting Handoff**:
The immutable, idempotent transfer of an Approved Payroll Run summary and proposed accounting attribution from HR Payroll to Accounting for posting and settlement.
_Avoid_: Accounting editing employee calculation lines, duplicate financial posting, sending an unapproved payroll result

**Released Payslip**:
The employee-scoped, immutable statement from an Approved Payroll Run that becomes visible only after explicit authorized publication. A later correction creates a linked payslip rather than replacing it.
_Avoid_: draft calculation shown as a payslip, bulk unrestricted access, overwriting the original after a correction

**Payroll Obligation**:
An approved loan or advance balance whose installments, payroll deductions, pauses, adjustments, and settlement are recorded as an auditable ledger.
_Avoid_: directly editable remaining balance, deduction without an approved source, a full loan-origination workflow inside Payroll

**Job Evaluation Template**:
The versioned standard criteria and expectations shared by people performing the same Job.
_Avoid_: Position-specific operating context, one universal company template, changing active reviews when a template changes

**Position Evaluation Addendum**:
The versioned line-, shift-, location-, or responsibility-specific criteria added by a Position to its Job Evaluation Template.
_Avoid_: duplicating the complete Job template, silently replacing shared criteria, person-specific favoritism

**Review Template Snapshot**:
The immutable combination of the applicable Job Evaluation Template and Position Evaluation Addendum governing one performance review period.
_Avoid_: calculating a historical review from current templates, changing criteria or weights after the review opens

**Operational Evaluation Evidence**:
Traceable read-only facts supplied by the operational system that owns them, with source, definition, period, extraction time, version, and data-quality state retained for review context.
_Avoid_: editable evidence on the evaluation page, unreviewed data used directly as a rating, a number without provenance

**Employee Self-Assessment**:
The employee's criterion-level input and context for a review, distinct from the formal evaluation authored by the Responsible Supervisor.
_Avoid_: formal rating, employee approval of the outcome, substituting self-report for supervisor judgment

**Formal Performance Review**:
The Responsible Supervisor's documented, criterion-level judgment using the Review Template Snapshot, relevant evidence, contextual explanation, and transparent weighting.
_Avoid_: an automatically generated operational score, an opaque overall number, an automatic compensation or employment decision

**Performance Acknowledgement**:
The employee's confirmation that the formal review was received, without implying agreement with its findings.
_Avoid_: acceptance of the score, waiver of response or objection, forced agreement

**Employee Evaluation Response**:
The employee's recorded comment on a formal review that does not by itself open the formal objection process.
_Avoid_: Performance Acknowledgement, Formal Performance Objection, silent replacement of supervisor comments

**Formal Performance Objection**:
The employee's time-bounded request for authorized reconsideration of a formal review while the original review remains intact.
_Avoid_: deleting the original, editing the supervisor review in place, treating every employee comment as an objection

**Revised Performance Review**:
An authorized, reasoned version linked to the original review when a formal objection or exceptional review decision changes the outcome.
_Avoid_: overwriting history, an unlinked replacement, revision without accountable actors and reason

**Controlled Payroll Cutover**:
The transition after two reconciled parallel periods in which the new HR/payroll system becomes the sole ordinary writer and the first live payroll must be approved, posted, paid, and reconciled before the stability window begins.
_Avoid_: dual ordinary writers, cutover before reconciliation, treating parallel calculation alone as production proof

**Controlled Return Window**:
The 30-day critical-discrepancy-free period following complete reconciliation of the first live payroll, after which HR Payroll, Accounting, and the System Owner may authorize permanent removal of legacy editing.
_Avoid_: starting the clock at deployment, retiring fallback before the first live payroll proves stable, an exit without joint sign-off

**Legacy Break-Glass Access**:
Time-limited, least-privilege legacy editing available only to a named technical administrator for a documented critical incident, with full audit, automatic four-hour expiry, independent review, and mandatory reconciliation into the new system.
_Avoid_: normal legacy editing after cutover, standing emergency access, returning to normal operation before reconciliation

**Organizational Unit**:
A typed node in Sabalan's single organizational hierarchy, covering levels such as company, division, department, workshop, production line, and administrative section.
_Avoid_: a separate hierarchy or table for every organizational level, treating workplace or cost center as an organizational parent

**Workplace**:
The physical or operational location where work is performed, independent of the Organizational Unit hierarchy so one location may serve multiple units.
_Avoid_: Organizational Unit, Cost Center

**Cost Center**:
The accounting classification to which workforce cost is attributed, independent of the Organizational Unit and Workplace hierarchies.
_Avoid_: Department, Workplace, deriving accounting ownership only from organizational placement

**User Creation Provenance**:
The immutable origin of a system user account. Public self-registration is disabled, and managed accounts created after provenance tracking is introduced record their creation source and exact creating user when one exists. Existing accounts without trustworthy historical evidence are shown as `Unknown — Historical Data`; an administrator may record a historical creator only as an explicitly manual, timestamped, audited correction.
_Avoid_: guessing a creator from timestamps, roles, permissions, or the administrator who probably created the account; presenting a manual correction as automatically captured history

**Recognized Login Session**:
A server-tracked authorization created only after successful authentication. It represents one browser profile or client session rather than a guaranteed physical device, and records inferred browser, operating system, device category, IP address, login time, last activity, status, and revocation history. Active sessions may be revoked individually.
_Avoid_: claiming browser metadata proves a hardware identity, creating a recognized device from a failed login, or deleting session history when access is revoked

**Failed Authentication Event**:
A security-log record for an unsuccessful login attempt, kept separately from Recognized Login Sessions. It records the attempted identifier, time, IP address, available client metadata, and a safe failure classification without storing the submitted password.
_Avoid_: showing a failed attempt as an authorized device, recording plaintext credentials, or exposing overly specific failure details to the unauthenticated caller

**Authentication Security Log Access**:
Every authenticated user may view and revoke their own active Recognized Login Sessions through Personal Affairs. Only an ADMIN may inspect another user's active sessions, login history, and Failed Authentication Events or revoke that user's individual or complete set of sessions; managerial role alone does not grant access.
_Avoid_: exposing organization-wide IP and login history to ordinary users or managers, preventing users from securing their own account, or making remote revocation an unaudited action

**Authoritative Server Session**:
The server-side authentication state referenced by a secure HttpOnly cookie and checked on every protected request. Revocation takes effect immediately because an otherwise valid browser cookie cannot authorize access after its server session is revoked. Introducing this model invalidates legacy stateless JWT access and requires every user to sign in again once at deployment.
_Avoid_: treating the session list as informational only, retaining authentication secrets in browser JavaScript storage, or allowing legacy seven-day JWTs to bypass revocation

**Session Lifetime**:
An Authoritative Server Session expires after 12 hours without activity and always expires no later than 7 days after authentication, even with continuous use. Browser closure alone does not revoke it, there is no permanent remember-me mode in the initial version, and last activity is persisted at a controlled interval rather than on every request.
_Avoid_: indefinite sessions, extending a session beyond its absolute expiry, treating a closed browser as proven logout, or writing the database on every authenticated request solely to update activity

**Security-Sensitive Session Revocation**:
Changing one's own password revokes every other session while retaining the verified current session. An administrator resetting another user's password, or deactivating that user, revokes all of the affected user's sessions immediately; reactivation requires a fresh login. Every manual or automatic revocation retains actor, time, reason, and scope.
_Avoid_: leaving suspected sessions active after a password reset, allowing a deactivated account to retain access, or revoking sessions without accountable audit evidence

**Personnel Record Retirement**:
A completely unused Personnel record created by mistake may be hard-deleted. Once linked to a User or referenced by attendance, mission, leave, shift, report, Human Resources, or other operational history, the Personnel identity is retained and retired through deactivation or archival instead.
_Avoid_: hard-deleting a real organizational identity, relying on attendance count alone to decide deletability, or removing historical attribution to satisfy CRUD expectations

**Personnel Bulk Operation**:
An administrator or otherwise authorized operator's reviewed action over selected Personnel records. Initial operations are activate, deactivate, change department, and apply work schedule; every submission first previews selected, eligible, skipped, and conflicting records and requires confirmation tied to that exact preview. Any intervening selected-record change invalidates the whole operation. Confirmed eligible changes execute atomically while skipped and conflicting records remain untouched, with a parent audit event, per-record before/after results, completion counts, and downloadable results. Bulk hard-delete is not supported.
_Avoid_: applying an unpreviewed or stale mass mutation, partially committing eligible changes, silently ignoring conflicts, or treating bulk selection as permission to destroy personnel history

**Administrator Password Reset**:
An ADMIN-only User Management action that replaces another user's password with an administrator-entered temporary password, never displays that password after submission, revokes all of the affected user's sessions, and records the accountable security event.
_Avoid_: placing password reset in Personnel Management, generating or logging a retrievable plaintext password, leaving existing sessions active, or granting the action to managers automatically

**Linked Personnel and User Deactivation**:
Personnel and User remain separate identities. Deactivating Personnel offers an explicit, default-selected choice to also deactivate its linked User and previews the resulting loss of access; the operator may deliberately leave the account active. Reactivating Personnel never automatically reactivates the linked User, and bulk deactivation follows the same previewed rule.
_Avoid_: silently coupling every personnel status change to login access, hiding which accounts a bulk action disables, or restoring system access merely because a personnel record was reactivated

**Temporary Password State**:
After an Administrator Password Reset, the affected User must replace the temporary password immediately after the next successful authentication. Until replacement, that session is restricted to the forced password-change screen and logout; completing the change clears the state and is audited without retaining either plaintext password.
_Avoid_: allowing normal ERP access with an administrator-known temporary password, logging either password, or clearing the forced-change requirement before a successful owner-selected replacement

**User Account Erasure**:
An ADMIN-only irreversible removal for a User who is no longer part of the system. It permanently removes credentials, sessions, personal profile data, and access permissions while unlinking and preserving Personnel and all business records. Historical attribution survives only through an inert actor snapshot containing the former user ID, display name, and deletion time and is displayed as `Deleted user — [name]`; the erased account cannot be reactivated, and a returning person receives a new User account. Execution requires administrator password confirmation, impact preview, mandatory reason, and audit evidence, and cannot target the acting administrator or the last active administrator.
_Avoid_: cascading account deletion into business records, retaining usable credentials after erasure, reactivating an erased identity, deleting oneself, or removing the final active administrator

**Authentication Evidence Retention**:
Active sessions remain while authorized; successful, expired, and revoked session history remains for 180 days after session end; Failed Authentication Events remain for 90 days. Account-erasure and administrator-revocation audit events remain permanently. Scheduled cleanup enforces the finite periods, and administrator views separate active sessions, session history, and failed attempts.
_Avoid_: mixing failed attempts into device history, retaining ordinary IP and client metadata indefinitely, or deleting permanent administrator-accountability evidence during routine cleanup

**Recognized Browser Profile**:
A random identifier stored in a secure cookie after successful authentication and used to recognize later sessions from the same browser profile without fingerprinting the physical device. A missing identifier marks the successful login as new; clearing cookies or using another browser or profile creates a new identity. New-browser login produces an in-app security notification, and `This wasn't me` immediately revokes the reported session while recommending—but not requiring—a password change. Recognition never grants additional access.
_Avoid_: treating browser recognition as proof of hardware identity, silently fingerprinting users, trusting a recognized browser with extra permission, or forcing a password change after every user-reported session

**User and Personnel Administration Boundary**:
ADMIN and MANAGER may create and edit non-admin Users and may create, edit, activate, deactivate, and run approved bulk operations for Personnel. Only ADMIN may hard-delete an unused Personnel record, reset passwords, erase accounts, inspect organization-wide authentication evidence, revoke another user's sessions, correct historical creator attribution, change roles, or apply bulk permissions. Managers may never modify, deactivate, or erase an ADMIN.
_Avoid_: granting sensitive identity or authentication control through the manager role, blocking managers from routine personnel maintenance, or allowing a manager to affect an administrator account

**Failed Login Monitoring Without Throttling**:
Failed logins never permanently lock an account and do not trigger request rate limits or progressive delays. A successful login resets the applicable failure counter. Unauthenticated callers receive only a generic failure response, while ADMIN-visible security evidence retains a safe internal category and repeated failures generate administrator alerts.
_Avoid_: exposing whether an account exists through login errors, automatically locking legitimate users through hostile attempts, claiming alerts prevent brute force, or silently introducing throttling contrary to the accepted policy

**Suspicious Failed Login Alert**:
An administrator alert produced when one account identifier receives 10 failed attempts within 15 minutes or one IP address produces 25 failed attempts within 15 minutes. Matching alerts are deduplicated for one hour while every underlying Failed Authentication Event remains recorded.
_Avoid_: discarding attempts because an alert was deduplicated, treating the alert as automatic prevention, or revealing threshold details to unauthenticated callers

**User Creator Attribution Display**:
User lists identify the creator by display name and username, while User details also expose creator ID, creation source, account creation time, and whether attribution was automatic or manually asserted. Unknown legacy attribution displays as `Unknown — Historical Data`. ADMIN may add a historical creator with a mandatory reason as a separate audited assertion, but automatically captured provenance is immutable. Erased creators display through their snapshot as `Deleted user — [name]`.
_Avoid_: presenting raw IDs as the primary identity, disguising manual attribution as captured evidence, changing automatic provenance, or losing creator display after account erasure

**Authentication Approximate Location**:
Authentication views show the recorded IP address and may derive only an approximate country and city from a locally maintained IP database, clearly labeled as approximate. They never request browser GPS permission or send login IP addresses to a third-party geolocation service. Private addresses display as `Internal network`, and users viewing their own sessions receive the same IP and approximate-location context available to administrators.
_Avoid_: presenting IP geolocation as precise physical location, transmitting authentication metadata to an external lookup service, or hiding session network context from the account owner

**گزارش لحظه‌ای دسته‌محور حراست**:
An immutable timestamped Security shift-log observation whose category is always recorded directly and whose report type is present only when that category uses report types. Category and type names are preserved as they were at recording time. Description is optional, but every report must contain at least one meaningful detail through description, an image, or related personnel when that field is enabled.
_Avoid_: manufacturing a “without type” type, changing old classifications when settings change, or accepting an empty category-only row

**سیاست فیلدهای گزارش لحظه‌ای**:
Manager-controlled category and type policy for new report entry. A category decides whether report types appear and decides related-personnel visibility for category-only reports; when types are used, the selected type decides related-personnel visibility. Description remains visible and optional and images remain visible and optional in every category.
_Avoid_: showing irrelevant selectors, hiding the description or image controls, or applying new visibility policy retroactively to history

**بازه حضور فیزیکی پرسنل**:
One factual entry-to-exit interval inside a personnel attendance day. A day may have multiple ordered intervals, only one interval may be open for a person at a time, and an interval crossing midnight belongs to the date on which entry occurred. Gaps between intervals represent time outside the premises without assuming a fixed rest schedule.
_Avoid_: limiting a person to one entry and exit per day, hard-coding a lunch break, splitting an overnight interval, or allowing overlapping open intervals

**خلاصه روزانه حضور چندبازه‌ای**:
The personnel-day view derived from all physical intervals: first entry, final exit, total completed physical presence, total time outside between intervals, and whether the latest interval remains open. First entry determines lateness and final exit determines scheduled overtime, while detailed UI and outputs retain every movement.
_Avoid_: reporting only one arbitrary interval, counting a gap as presence, finalizing totals while an interval is open, or letting PDF and Excel disagree with the daily view

**استثنای حضور و غیاب حراست**:
A Security-created operational authority that excuses expected attendance for a full day or a precise hourly window. In the current phase any authorized Security user may create and manage it. New items are pending; only approved items affect attendance. Pending items may be edited or deleted, while decided or attendance-linked history is cancelled or corrected through reasoned audit actions rather than overwritten.
_Avoid_: calling it a personnel request, fabricating physical movements on approval, hard-deleting decided history, or letting pending/rejected/cancelled items change attendance

**ماموریت پرسنل در حراست**:
A Security-created precise time window of authorized work away from the premises. Only an approved mission contributes accounted work; it never pretends that the person was physically present, and actual entry/exit intervals remain visible alongside it. In the current phase any authorized Security user may create and manage missions.
_Avoid_: converting mission time into fake attendance movements, hiding real presence, double-counting overlapping mission and presence, or treating an unapproved mission as worked time

**تعارض زمانی استثنا و ماموریت**:
Pending authorities may overlap with a visible warning, but approval rejects overlapping leaves, overlapping missions, or a leave/mission conflict for the same person. Adjacent missions are valid. Physical presence may overlap any authority because it records fact, and accounted work uses the union of presence and mission windows so time is counted once.
_Avoid_: blocking factual entry/exit, approving contradictory authorities, counting overlapping work twice, or treating leave as worked time
