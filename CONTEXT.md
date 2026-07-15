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
A per-contract-product material-consumption adjustment for physical cuttable stone. When enabled, the saved row carries `sawKerfEnabled: true` and `sawKerfCm: 0.3`; each actually cut axis consumes the finished requested dimension plus 3mm for source-material charge, smart packing, and remaining-stone geometry. Finished dimensions, delivery, standalone services, tools, and finishing calculations stay based on the customer-requested size.
_Avoid_: applying kerf to service rows, applying it to a full-width/full-length axis with no cut, or changing printed finished dimensions.

**برش کالیبر**:
A cutting-charge modifier for طولی and stair product rows that adds one paid side-edge longitudinal cut for each consumed source band while leaving material area, delivery dimensions, and remaining-stone geometry unchanged. It is included inside the normal برش total and printed cutting details rather than shown as a separate add-on.
_Avoid_: treating برش کالیبر as extra consumed material, a separate service row, or a separate printed line item

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
_Avoid_: omitting a priced operation from the final payable amount, adding a displayed dependent service on top of an already all-in product total, presenting physical non-billable حکمی cutting as a customer charge, or silently rewriting a finalized historical contract

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
فقط برای محصول سنگ طولی، تعداد خالی یا صفر اجازه یک برآورد داخلی برای جلوگیری از بیش‌برآورد هزینه است؛ تعداد، طول و عرض واردشده همچنان عین درخواست مشتری باقی می‌مانند. برای نمونه درخواست `40cm` منبع، `7cm` عرض، `50m` طول و تعداد صفر در همه ردیف‌ها و خروجی‌ها همان `0 / 50m / 7cm` می‌ماند و نتیجه بهینه‌ساز جایگزین آن نمی‌شود. در مقابل، تعداد مثبت صریح است و طول را به طول هر قطعه تبدیل می‌کند؛ `2 / 50m` یعنی دو قطعه 50 متری و مجموع 100 متر. ردیف قدیمی که مقادیر صفر را با خروجی بهینه‌ساز جایگزین کرده، هنگام خواندن از provenance بازسازی می‌شود و فقط با ذخیره صریح قرارداد اصلاح پایدار می‌گردد.
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

**برش غیرقابل دریافت در حکمی**:
A physical stone cut that remains part of the contract product's workshop and remaining-stone truth but has no separate billable cutting charge because the product is marked حکمی. The product may still show that it has a physical cut, but invoice-facing totals should not include a paid برش amount for that cut.
_Avoid_: removing the cut geometry, hiding the workshop cut, charging both حکمی and برش for the same mandatory product row, or showing a priced برش line for a non-billable mandatory cut

**هزینه فیزیکی برش و مبلغ قابل دریافت برش**:
هزینه فیزیکی برش ارزش محاسبه‌شده عملیات واقعی برای برنامه تولید و کنترل داخلی است؛ مبلغ قابل دریافت برش بخشی از همان عملیات است که طبق قواعد فروش از مشتری دریافت می‌شود. در محصول حکمی، عملیات و هزینه فیزیکی باقی می‌ماند اما مبلغ قابل دریافت برش صفر است.
_Avoid_: استفاده از یک مبلغ مشترک برای حقیقت تولید و مبلغ فاکتور، حذف عملیات فیزیکی به دلیل رایگان‌بودن آن برای مشتری، یا استفاده از هزینه فیزیکی در جمع قابل پرداخت

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
A reporting workspace for aggregate operational data such as attendance, exceptions, missions, shift sessions, and signatures over a selected date range. It is separate from گزارش شیفت حراست and should be filterable by date range, department, shift, and personnel when those dimensions apply.
Across a date range, absence is derived per day from active users in scope minus users with an attendance record for that day; it is not limited to stored ABSENT rows.
_Avoid_: using mock analytics, mixing narrative shift closure reports into aggregate KPIs, or showing labels that do not match the underlying metric

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
Manager-level Security workspace access to the detailed performance view and its operational narratives. This access is distinct from ordinary guard self-service and aggregate report viewing.
_Avoid_: protecting detailed personnel performance only by hidden interface controls, or exposing guard narratives to generic workspace viewers

**خروجی عملکرد نیروهای حراست**:
The manager-only performance PDF may include detailed operational evidence from finished security shifts in the selected date range: shift date/time and status, planned/replacement/temporary coverage person, attendance and delay, closure summary, instant report rows with report type names and descriptions, and patrol sessions. Active shifts are excluded. Both CLOSED and FORCE_CLOSED sessions count as finished, with force-closed shifts clearly labeled.
_Avoid_: exporting active shifts, hiding force-closed status, or exposing detailed operational narratives outside the manager/admin performance export.

**تاریخچه تفصیلی شیفت نیروی حراست**:
A manager/admin-only dedicated page for chronological review of one Security guard's shifts in the selected range. Each expandable shift keeps scheduled and actual coverage, attendance and session timing, exceptions, patrols, closure data, and the complete instant-report audit trail together.
_Avoid_: flattening evidence from different shifts into one unscoped activity feed, showing detailed history to ordinary guards, or losing the report date context when navigating to the history

**گزارش لحظه‌ای باطل‌شده حراست**:
An instant report that remains visible in the shift audit trail with a clear voided state, void time, and void reason. It is historical evidence rather than active shift content.
_Avoid_: deleting voided reports, or presenting them as active without their void context

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
An exact duplicate full name inside the same department is treated as a likely duplicate and should be blocked or require explicit admin confirmation, while the same full name may exist in different departments. User-to-personnel migration should link to an existing matching personnel record instead of creating a duplicate.
_Avoid_: silently creating same-name same-department duplicates, globally blocking common names across departments, or duplicating personnel records during user migration

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

**طراحی عملیاتی موبایل حراست**:
Core حراست operational pages must follow Sabalan ERP's shared design system, mobile-first RTL layout, teal primary actions, neutral surfaces, and semantic status tones. The deepest mobile-first treatment belongs to داشبورد حراست, حضور و غیاب, گزارش شیفت, خودرویی, and شیفت‌ها; manager/config/report pages remain responsive and consistent without becoming one-handed field workflows.
_Avoid_: reviving the older red/rose security theme, table-only mobile attendance, cramped side-by-side fields that break Persian labels, or hiding the core action list behind horizontal scrolling

**خروجی گزارش‌های حراست**:
A PDF or Excel rendition of the currently filtered aggregate security report, containing its summary metrics and daily attendance breakdown. It is not an export of shift logs, personal schedules, or other operational records whose report layouts have not been defined.
_Avoid_: placeholder export buttons, ignoring active report filters, or exporting sensitive operational data under an ambiguous report name

**دو نوع خروجی گزارش حراست**:
Security reporting has two distinct export families. The حضور و غیاب کارکنان scope exports aggregate attendance PDF/Excel. The عملکرد نیروهای حراست scope has its own manager-only detailed PDF for finished security shifts and operational evidence.
_Avoid_: one ambiguous PDF button that sometimes exports attendance aggregates and sometimes exports detailed shift narratives.

**صادرکننده گزارش حراست**:
A security manager, supervisor, or explicitly authorized read-only report viewer who may generate aggregate security report exports. A regular guard may use personal scheduling and shift-report workflows but cannot export aggregate reports.
_Avoid_: granting aggregate-report export to every user who can work a security shift, or relying only on hidden front-end buttons to protect report data

**محتوای خروجی گزارش حراست**:
The privacy-minimized first export layout: selected date range and filters, generation time, aggregate KPIs, and the daily attendance breakdown without employee names.
_Avoid_: a report with no filter context, exposing individual personnel data when aggregate data answers the reporting need, or a file that differs materially from the on-screen report

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

**جایگزینی شیفت حراست**:
A slot-specific exception that preserves the annual A→B→C baseline while assigning another eligible security user as the actual worker for an absent planned guard. Later planned assignments do not shift, and rest or overlap conflicts require a manager override reason.
_Avoid_: regenerating the rotation after leave, transferring ownership of later slots to the substitute, or hiding rest violations created by coverage

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
A manager-maintained roster of active organizational personnel who should appear in حراست attendance, metrics, reports, and absence calculations. Personnel outside this roster remain normal Personnel records but are excluded from the حراست daily attendance population.
_Avoid_: treating all active personnel as automatically in scope, using an exclusion list as the primary model, or counting people outside the roster in حراست attendance metrics

**فهرست خالی حضور و غیاب حراست**:
An empty فهرست حضور و غیاب حراست is an intentional empty attendance scope. حراست attendance pages and metrics should show no population and guide managers to configure the roster, rather than falling back to all active personnel.
_Avoid_: silently loading all personnel when the roster is empty, calculating attendance percentages from an unconfigured population, or hiding the need for manager configuration

**مالکیت فهرست حضور و غیاب حراست**:
Only حراست manager/admin users maintain the attendance roster. Operational guards use the resulting roster for attendance work but do not add or remove personnel from it during daily operations.
_Avoid_: letting guards quietly expand the metric population from the attendance screen, mixing roster governance with check-in/check-out actions, or making roster membership a personal preference

**عضویت تاریخ‌دار در فهرست حضور و غیاب حراست**:
Roster membership is effective-dated: adding or removing personnel changes the حراست attendance population from the effective date forward, while historical attendance reports keep the roster truth that applied on each past day.
_Avoid_: recalculating old attendance rates from today's roster, using a current-only checkbox for a historical metric boundary, or erasing past roster membership when someone leaves the attendance scope

**راه‌اندازی اولیه فهرست حضور و غیاب حراست**:
On first rollout of the roster model, currently active personnel may be seeded into the فهرست حضور و غیاب حراست effective from the rollout date so daily operations do not go blank. This is a one-time transition; after rollout, an empty roster remains an intentional empty attendance scope.
_Avoid_: treating the seed as a permanent fallback to all active personnel, backfilling old roster history without an explicit decision, or changing pre-rollout reports unexpectedly

**حذف از فهرست حضور و غیاب حراست**:
Removing personnel from the attendance roster ends their future attendance scope but does not delete or rewrite existing attendance records. If removal is effective for the current day, that person leaves the current day's roster population and metrics while their raw attendance record remains available for audit/history.
_Avoid_: deleting attendance evidence, changing historical days where the person was in scope, or keeping removed personnel in current metrics because they had a record earlier that day

**افزودن به فهرست حضور و غیاب حراست**:
Adding personnel to the attendance roster is effective from the selected date. If the effective date is today, the person immediately appears in today's حراست attendance population and metrics, usually as غایب until ورود or an exception is recorded; managers can choose a future effective date to avoid changing today's metrics.
_Avoid_: delaying today-effective additions until tomorrow, hiding newly scoped personnel from current attendance, or changing today's metrics without making the effective date explicit

**برابری پرسنل در حضور و غیاب**:
In daily security attendance, user-linked and non-user personnel behave the same from the acting guard's perspective: both can be searched, filtered, checked in, checked out, marked with exceptions, and signed. Permissions belong to the acting system user, not to the personnel record being attended.
_Avoid_: exposing login-account status as an attendance concern, hiding non-user personnel from security actions, or requiring attended personnel to have system permissions

**ثبت ورود تکراری در حضور و غیاب حراست**:
When حراست records ورود for a person and that same person already has an entry time for the selected attendance date, the operation should behave as a successful idempotent action and return the existing attendance truth to the operator. The visible daily list should then show the existing حاضر record instead of leaving the person as غایب.
_Avoid_: showing English duplicate errors to operators, treating a successful earlier ورود as a failed action, or displaying غایب for a person whose same-day ورود already exists

**زمان ثبت حضور و غیاب حراست**:
ورود and خروج actions in حراست default to the current time, but the operator may change the time before submitting when the event was forgotten or recorded late. If the submitted time differs from the default current time, a short reason is required and should remain visible as attendance context.
_Avoid_: forcing a separate manual-entry mode, blocking forgotten attendance correction, or allowing silent backdated times without a reason

**حضور باز روز قبل**:
If a person has an older attendance record with ورود and no خروج, حراست must close that previous record with an explicit خروج time and reason before registering a new ورود for a later date. The system should surface this open previous attendance state instead of silently creating a new day entry or auto-filling the old exit.
_Avoid_: overwriting yesterday's record with today's action, creating automatic خروج without operator confirmation, or allowing overlapping open attendance records for the same person

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
