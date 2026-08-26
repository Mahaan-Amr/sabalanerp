# ممیزی مرزهای دسترسی فروش، CRM و فروشنده همکار

تاریخ: ۱۴۰۵/۰۶/۰۴ (2026-08-26)

مبنای بررسی: commit `9fcf2edb`

پرسش: کد و schema فعلی چگونه مالکیت مشتری، دسترسی قرارداد، مجوزهای Sales/CRM، فعال‌سازی Partner و دسترسی بین‌فضای‌کاری را اعمال می‌کنند؛ شکاف‌های leakage یا coupling کجاست؛ و specification جدید باید بر کدام seamهای authoritative بنا شود؟

## نتیجه اجرایی

مدل فعلی برای افزودن امن «فروشنده همکار» آماده نیست، چون سه مفهوم مستقل را در چند نقطه با هم مخلوط کرده است:

1. **ورود به یک سطح عملیاتی** با Workspace/Feature permission کنترل می‌شود؛
2. **دسترسی به یک رکورد مشخص** گاهی با دپارتمان، گاهی با فروشنده مسئول و گاهی اصلاً فیلتر نمی‌شود؛
3. **نوع رابطه تجاری کاربر** فقط از `UserRole` و `departmentId` قابل استنتاج است و هیچ پروفایل Partner یا چرخه فعال‌سازی‌ای در schema وجود ندارد ([schema](../../backend/prisma/schema.prisma#L11)، [UserRole](../../backend/prisma/schema.prisma#L4403)).

مهم‌ترین یافته‌ها:

- `CrmCustomer.ownerUserId` وجود دارد و مشتری جدید به سازنده نسبت داده می‌شود، اما فهرست و جزئیات مشتری از مالکیت استفاده نمی‌کنند؛ `buildCustomerScope` صراحتاً `{}` برمی‌گرداند. بنابراین هر دارنده مجوز مشاهده مشتری می‌تواند اطلاعات همه مشتریان را بخواند ([schema](../../backend/prisma/schema.prisma#L1932)، [scope خالی](../../backend/src/routes/crm.ts#L13)، [list](../../backend/src/routes/crm.ts#L490)، [detail](../../backend/src/routes/crm.ts#L621)).
- دسترسی قرارداد فروش، PDF، محصول قرارداد، پرداخت و تحویل بر پایه `departmentId` است. `validateContractAccess` حتی به کاربر بدون دپارتمان دسترسی انعطاف‌پذیر به همه قراردادها می‌دهد؛ مالک مشتری، سازنده، فروشنده مسئول یا نوع Partner در تصمیم دخیل نیستند ([policy فعلی](../../backend/src/services/contractService.ts#L1233)، [list](../../backend/src/routes/sales.ts#L594)، [detail](../../backend/src/routes/sales.ts#L763)).
- کاتالوگ و ورودی‌های قیمت برای دارنده مجوز ساخت/مشاهده قرارداد، رکورد کامل را برمی‌گردانند. محصول شامل `basePrice` است و cutting، sub-service و finishing نیز نرخ‌هایشان را در همان read model عمومی قرارداد برمی‌گردانند؛ مخفی‌کردن قیمت فقط در UI کافی نخواهد بود ([products](../../backend/src/routes/products.ts#L209)، [cutting types](../../backend/src/routes/cutting-types.ts#L14)، [sub-services](../../backend/src/routes/sub-services.ts#L14)، [finishings](../../backend/src/routes/stone-finishings.ts#L63)).
- مجوز Feature به‌طور پیش‌فرض از Workspace permission fallback می‌گیرد. پس یک Workspace grant وسیع می‌تواند همه Featureهای آن سطح را باز کند؛ این رفتار برای عملیات حساس Partner، مانند فعال‌سازی، تعیین پاسخ‌دهنده، شرایط تجاری و انتقال مالکیت، بیش‌ازحد گسترده است ([feature precedence](../../backend/src/middleware/feature.ts#L728)، [workspace fallback](../../backend/src/middleware/feature.ts#L759)).
- مسیر عمومی OTP کل `contractData`، آیتم‌ها، پرداخت‌ها و تحویل‌ها را serialize می‌کند. در مدل دوسندی Partner، اگر داده داخلی سبلان داخل همین aggregate یا JSON قرار گیرد، این serializer یک مرز leakage مستقیم خواهد بود ([public serializer](../../backend/src/services/contractConfirmationService.ts#L110)).

نتیجه معماری: specification باید **پروفایل Partner را از Role جدا کند**، **یک policy مرکزی actor-resource برای مشتری/پرونده/سند بسازد**، **read model فنی محصول را از read model قیمت جدا کند**، و **هر نمای داخلی، حسابداری، پاسخ‌دهنده و عمومی را projection مستقل و allowlist‌شده بداند**. وصله‌کردن شرط `role === ...` روی routeهای موجود، هم فروشندگان عادی را ناخواسته محدود می‌کند و هم child endpointهای قرارداد را باز می‌گذارد.

## ۱. مدل داده و هویت فعلی

### ۱.۱ کاربر و نقش

`User` یک `role` سراسری از enum پنج‌عضوی `ADMIN | USER | MODERATOR | SALES | MANAGER`، یک `departmentId` اختیاری، و grantهای Workspace/Feature دارد. هیچ discriminator، پروفایل تجاری، بدهکار تجاری، پاسخ‌دهنده قیمت یا وضعیت چرخه Partner در این مدل نیست ([User](../../backend/prisma/schema.prisma#L11)، [UserRole](../../backend/prisma/schema.prisma#L4403)، [WorkspacePermission](../../backend/prisma/schema.prisma#L1668)، [FeaturePermission](../../backend/prisma/schema.prisma#L1699)).

بنابراین افزودن `PARTNER` به `UserRole` به‌تنهایی seam مناسبی نیست:

- Role در fallback مجوزها مصرف می‌شود و ممکن است مجموعه‌ای از workspace/feature defaults را به همه اعضای آن نقش بدهد؛
- نوع تجاری Partner دارای lifecycle و پیش‌نیازهای مستقل است، درحالی‌که `User.isActive` فقط فعال‌بودن حساب ورود را نشان می‌دهد؛
- یک کاربر داخلی می‌تواند `SALES` باشد بدون اینکه بدهکار تجاری سبلان، مشتری محدود، یا نیازمند استعلام قیمت باشد.

**seam پیشنهادی:** `PartnerProfile` یک‌به‌یک با `User` و یک aggregate جدا برای `PartnerCommercialAccount`. پروفایل باید حداقل status، گیت هویت HR، گیت شرایط تجاری، پاسخ‌دهنده فعال، زمان‌های فعال‌سازی/تعلیق/خاتمه و actor/reason ممیزی را نگه دارد. authorization باید ابتدا هویت session و `User.isActive` و سپس status پروفایل را بررسی کند؛ تعلیق Partner نباید با غیرفعال‌کردن یا حذف User، سابقه تجاری را مخدوش کند.

### ۱.۲ مالکیت مشتری

Schema فیلدهای مناسب اولیه را دارد: `ownerUserId`، `createdBy` و `updatedBy` روی `CrmCustomer` و index روی owner ([schema](../../backend/prisma/schema.prisma#L1932)). هنگام ایجاد مشتری، backend مالک و سازنده را از session می‌گیرد، نه از body؛ این بخش مبنای مناسبی برای مالکیت اولیه است ([create assignment](../../backend/src/routes/crm.ts#L877)).

اما enforcement متناقض است:

- `buildCustomerScope` خالی است، پس list همه مشتریان را query می‌کند ([scope](../../backend/src/routes/crm.ts#L15)، [list](../../backend/src/routes/crm.ts#L490)).
- detail با `findUnique` همه contactها، تلفن‌ها، پروژه‌ها، communicationها و پنج قرارداد آخر را بدون ownership check برمی‌گرداند ([detail](../../backend/src/routes/crm.ts#L621)).
- write helper، تمام کاربران غیر-Admin را owner-scoped فرض می‌کند؛ این رفتار با تصمیم «فقط Partner محدود شود و فروشندگان داخلی فعلی تغییر نکنند» سازگار نیست ([isOwnerScopedUser](../../backend/src/routes/crm.ts#L13)، [ensureOwnershipOrDeny](../../backend/src/routes/crm.ts#L310)).
- assign-owner با Feature permission انجام می‌شود، اما انتقال، دلیل، درخواست، تصمیم و تاریخچه مالک قبلی را مدل نمی‌کند ([owner route](../../backend/src/routes/crm.ts#L1118)).
- duplicate-check از همان `customerSuggestionSelect` شامل national code، owner، phone و project address استفاده می‌کند؛ برای Partner باید نتیجه حداقلی «تکراری هست/نیست + امکان درخواست انتقال» باشد، نه اطلاعات شناسایی کامل رکورد متعلق به دیگری ([duplicate route](../../backend/src/routes/crm.ts#L383)، [projection](../../backend/src/routes/crm.ts#L261)).

**seam پیشنهادی:** یک `CustomerAccessPolicy` سروری با ورودی `(actor, action, customer|customerId)` و خروجی `allow | not-found` و predicate query. این policy فقط وقتی `actor.partnerProfile.status` نشان‌دهنده Partner است، `ownerUserId = actor.id` را اجبار کند؛ برای فروشندگان داخلی همان رفتار موجود/مجوز مدیریتی را حفظ کند. تمام queryهای list/detail و تمام منابع فرزند (`contacts`, `phones`, `projectAddresses`, `communications`, `potentialProjects`, `followUps`, `nextActions`, shipment/customer statements) باید از همین policy استفاده کنند، نه شرط‌های مستقل route.

انتقال مشتری باید aggregate و audit مستقل داشته باشد؛ approve شدن فقط `CrmCustomer.ownerUserId` جاری را تغییر دهد و تاریخچه پروژه‌ها/قراردادهای قبلی را بازنویسی نکند. این اصل با ADR فروش نیز هم‌راستاست که مسئول فعلی، creator و اعتبار فروش قطعی را سه حقیقت جدا و تاریخچه فروش را append-only می‌داند ([ADR-0011](../adr/0011-stable-sales-attribution-and-reporting-events.md#L11)).

## ۲. قرارداد فروش و منابع فرزند

### ۲.۱ مرز فعلی

`SalesContract` به یک Customer، یک Department، creator، responsible seller و realized seller متصل است ([schema](../../backend/prisma/schema.prisma#L1732)). ایجاد قرارداد، مسئول فروش را از potential project یا creator تعیین می‌کند؛ این seam برای اعتبار فروش Partner قابل استفاده است ([creation](../../backend/src/services/contractService.ts#L584)).

بااین‌حال authorization رکورد به این هویت‌ها توجه نمی‌کند. policy فعلی:

- Admin: همه؛
- کاربر دارای دپارتمان: همه قراردادهای همان دپارتمان؛
- کاربر بدون دپارتمان: همه قراردادها.

این منطق در یک helper مشترک استفاده می‌شود، اما ورودی helper فقط `{departmentId}` از contract و `{role, departmentId}` از user است؛ پس اصولاً توان بیان مالکیت Partner را ندارد ([validateContractAccess](../../backend/src/services/contractService.ts#L1233)). list نیز مستقلاً همین scope دپارتمان را بازسازی می‌کند ([contract list](../../backend/src/routes/sales.ts#L594)).

پیامدها:

- Partner هم‌دپارتمان با فروشندگان داخلی می‌تواند قراردادهای آنان را ببیند؛
- Partner بدون دپارتمان عملاً broad access می‌گیرد؛
- ownership مشتری در create بررسی نمی‌شود؛ route فقط department را کنترل می‌کند و service فقط وجود/سازگاری customer snapshot را می‌سنجد ([create route](../../backend/src/routes/sales.ts#L956)، [party validation call](../../backend/src/services/contractService.ts#L592)).
- delivery و payment نیز همان department policy را مصرف می‌کنند، پس محدودسازی فقط list/detail کافی نیست ([delivery service](../../backend/src/services/deliveryService.ts#L31)، [payment service](../../backend/src/services/paymentService.ts#L61)).
- PDF، product graph، edit sessions، SMS/confirmation، sign/print/cancel و lifecycle endpoints نیز باید با همان resource policy جدید بازبینی شوند؛ اکنون چند route مستقیماً شرط دپارتمان را تکرار می‌کنند ([PDF access](../../backend/src/routes/sales.ts#L817)، [SMS access](../../backend/src/routes/sales.ts#L2060)).

### ۲.۲ seam پیشنهادی پرونده و دو سند

برای قابلیت جدید، `SalesContract` موجود نباید با دو مبلغ و دو بدهکار به یک سند مبهم تبدیل شود. یک aggregate «پرونده فروش همکار» باید مالک لینک‌های زیر باشد:

- Partner و حساب تجاری او؛
- customer نهایی و owner فعلی آن؛
- سند داخلی سبلان؛
- قرارداد مشتری؛
- Product Graph/version مشترک؛
- quote snapshots مصرف‌شده؛
- lifecycle و mutation version پرونده.

هر سند شماره، وضعیت، total، payment schedule و projection دسترسی مستقل داشته باشد. قرارداد مشتری می‌تواند از مسیرها و template فعلی استفاده کند، اما سند داخلی باید مدل مستقل حسابداری باشد؛ `contractData` مشترک محل امنی برای پنهان‌کردن قیمت خرید نیست.

یک `PartnerSalesAccessPolicy` مرکزی باید دست‌کم این projectionها را تعریف کند:

| actor | دامنه مجاز |
| --- | --- |
| Partner | پرونده‌های خودش، قرارداد مشتری خودش، نمای خصوصی حساب خودش با سبلان |
| Admin/مدیر فروش با action grant | دو سند و اختلاف، در scope مجاز |
| پاسخ‌دهنده قیمت | quote و وضعیت استفاده حداقلی؛ بدون قیمت فروش مشتری |
| حسابداری | سند داخلی، بدهی و شواهد مالی؛ بدون قرارداد retail مگر گزارش مدیریتی صریح |
| مشتری عمومی | فقط قرارداد customer-facing پس از token/OTP معتبر |
| فروشنده دیگر | هیچ داده‌ای از پرونده Partner |

هر child operation باید `case/document id + actor` را به policy بدهد؛ lookup مستقیم Payment/Delivery/Item بدون بررسی parent مجاز نیست.

## ۳. CRM pipeline و گزارش‌ها

Pipeline CRM نسبت به Customer خواندن امن‌تری دارد: پروژه‌های احتمالی برای کاربر عادی با `responsibleSellerId = req.user.id` فیلتر می‌شوند و detail فقط برای مسئول/مدیر مجاز باز است ([project list](../../backend/src/routes/crm.ts#L2026)، [project access](../../backend/src/routes/crm.ts#L232)). follow-upها با seller و next-actionها با assignee scope می‌شوند ([follow-ups](../../backend/src/routes/crm.ts#L2299)، [next-actions](../../backend/src/routes/crm.ts#L2424)).

ولی این scopeها «مسئولیت عملیاتی» هستند، نه مالکیت Customer. create potential project فقط وجود customer را می‌سنجد؛ Partner می‌تواند با شناسه یک customer غیرخودی پروژه بسازد، مگر policy مشتری پیش از mutation اعمال شود ([project create](../../backend/src/routes/crm.ts#L2112)). follow-up بدون potential project نیز فقط وجود customer را می‌سنجد و می‌تواند روی customer غیرخودی نوشته شود ([follow-up create](../../backend/src/routes/crm.ts#L2328)). specification باید قاعده دهد که برای Partner، هر پروژه/پیگیری/action علاوه بر seller/assignee scope، به customer متعلق به همان Partner متصل باشد.

گزارش فروش seam قابل استفاده‌ای دارد: ordinary seller با `responsibleSellerId OR realizedSellerId OR createdBy = actor` scope می‌شود و test این رفتار را تثبیت کرده است ([report policy](../../backend/src/services/salesReportingService.ts#L202)، [where](../../backend/src/services/salesReportingService.ts#L246)، [test](../../backend/src/services/__tests__/salesReportingFoundation.test.ts#L96)). بااین‌حال گزارش فعلی یک `totalAmount` و حقیقت مالی سبلان را فرض می‌کند. گزارش Partner باید retail amount، internal Sabalan amount، margin و وصول مشتری را از projectionهای دوسندی بخواند؛ نباید `totalAmount` قرارداد مشتری وارد درآمد سبلان یا receivable داخلی شود.

## ۴. کاتالوگ، قیمت و استعلام

### ۴.۱ leakage فعلی

`GET /api/products` از `findMany` بدون `select` استفاده می‌کند، پس تمام ستون‌های Product از جمله `basePrice` را برمی‌گرداند ([route](../../backend/src/routes/products.ts#L209)، [query](../../backend/src/routes/products.ts#L324)، [schema price](../../backend/prisma/schema.prisma#L2231)). همین الگو برای رکوردهای کامل CuttingType، SubService و StoneFinishing وجود دارد و نرخ‌های `pricePerMeter`/`unitPrice` بخشی از پاسخ‌اند ([cutting](../../backend/src/routes/cutting-types.ts#L59)، [sub-service](../../backend/src/routes/sub-services.ts#L60)، [finishing](../../backend/src/routes/stone-finishings.ts#L110)).

چون wizard قیمت را در frontend محاسبه و در payload contract ذخیره می‌کند، Partner با دسترسی به فرم کامل محصول، قیمت پایه و اجزای نرخ را نیز دریافت می‌کند. UI masking امنیت نیست و endpoint فعلی «اطلاعات فنی بدون قیمت» را ارائه نمی‌دهد.

### ۴.۲ seam پیشنهادی

دو projection صریح لازم است:

1. `ProductConfigurationCatalog`: شناسه‌ها، نام‌ها، گزینه‌های فنی، قواعد سازگاری و واحدها؛ بدون هر نرخ یا هزینه؛
2. `InternalPricedCatalog`: projection فعلی قیمت‌دار برای فروشندگان داخلی واجد مجوز.

Partner wizard باید projection اول را مصرف کند. قیمت سبلان فقط از `ApprovedPartnerQuoteLine` معتبر و immutable بیاید. backend هنگام submit نهایی باید زیر transaction:

- Partner فعال، ownership customer و assignment پاسخ‌دهنده را recheck کند؛
- fingerprint/version دقیق Product Graph مؤثر بر قیمت را با quote line تطبیق دهد؛
- `approvedAt <= now < expiresAt` را با ساعت server بررسی کند؛
- quote و case را lock کند؛
- snapshot قیمت خرید را در سند داخلی و قیمت پیش‌فرض قابل‌ویرایش retail را در قرارداد مشتری ثبت کند؛
- هر دو سند را اتمیک بسازد یا هیچ‌کدام را نسازد.

Approved pricing حسابداری موجود برای مرحله downstream قرارداد طراحی شده و به Contract متصل است؛ نباید به‌عنوان quote پیش‌قرارداد Partner بازتفسیر شود ([approved pricing models](../../backend/prisma/schema.prisma#L2988)). همچنین برنامه Inquiry فعلی سرویس جدا با SQLite و auth مستقل است، پس source of truth مناسب برای ERP Partner نیست ([integration note](../inquiry-integration.md#L3)).

## ۵. مجوزها، HR و فعال‌سازی Partner

### ۵.۱ رفتار فعلی

Middleware عمومی ترتیب `user feature → user workspace → role feature → role workspace` دارد و Workspace grant را fallback همه Featureها می‌داند ([feature middleware](../../backend/src/middleware/feature.ts#L728)). این مدل برای سطح‌های عادی مناسب است، اما actionهای Partner باید explicit باشند.

علاوه بر آن، routeهای user و permission فعلی `MANAGER` را همراه Admin برای ایجاد/ویرایش کاربر و مدیریت grantها مجاز می‌کنند ([users](../../backend/src/routes/users.ts#L158)، [features](../../backend/src/routes/permissions.ts#L225)، [workspaces](../../backend/src/routes/workspace-permissions.ts#L123)). policy نقش نیز MANAGER را مجاز می‌داند هر نقش غیر-Admin را assign کند و test همین را تثبیت کرده است ([policy](../../backend/src/services/userRoleAdministrationPolicy.ts#L3)، [test](../../backend/src/services/__tests__/userRoleAdministrationPolicy.test.ts#L4)). حتی `narrowFeatureAccess` فعلی ADMIN یا MANAGER را بدون بررسی workspace/action، admin می‌داند ([narrow policy](../../backend/src/services/narrowFeatureAccess.ts#L22)). بنابراین استفاده مستقیم از `authorize('ADMIN','MANAGER')` یا narrow helper فعلی، شرط «HR manager فقط با مجوز صریح Partner» را برآورده نمی‌کند.

ADR-0037 seam مطلوب را روشن می‌کند: action permission مجوز کامل همان عملیات است، frontend effective permissions سرور را مصرف می‌کند، و override مدیر فقط با دسترسی کامل همان workspace معتبر است؛ مدیر workspace نامرتبط از عنوان داخلی دسترسی نمی‌گیرد ([ADR-0037](../adr/0037-authorize-hr-work-through-workspace-and-action-permissions.md#L9)).

### ۵.۲ action catalog پیشنهادی

حداقل actionهای مستقل:

- `partner_identity_manage` و `partner_identity_approve` در HR؛
- `partner_commercial_terms_manage` در حوزه تجاری/Accounting؛
- `partner_price_responder_assign` در Sales؛
- `partner_lifecycle_activate`, `suspend`, `terminate` با prerequisites صریح؛
- `partner_customer_transfer_decide` در CRM؛
- `partner_quote_respond` و `partner_quote_reassign` در Sales؛
- `partner_management_reporting_view` برای مشاهده قیمت retail/margin تجمیعی.

این actionها نباید از `workspace edit` ارث ببرند. Admin override می‌تواند صریح باشد؛ HR Manager فقط با grant فعال همان action و HR workspace مناسب شود. هر mutation باید effective authority، actor، before/after، reason، زمان و در صورت override بودن آن را audit کند.

Partner status باید state machine جدا باشد: `PENDING_COMPLETION → ACTIVE → SUSPENDED | TERMINATED`. activation فقط وقتی commit شود که هر سه گیت هویت، شرایط تجاری و پاسخ‌دهنده معتبرند. این invariant باید در service/transaction و ترجیحاً constraintهای قابل بیان در DB enforce شود، نه صرفاً disabled button در frontend.

## ۶. دسترسی بین‌فضای‌کاری و کارتابل

Specification پروژه برای وظایف بین‌واحدی اصل مهمی دارد: duty projection هرگز source of truth دوم نیست؛ adapter حقیقت منبع را load می‌کند، حداقل evidence را projection می‌دهد و پاسخ را در همان transaction روی منبع اعمال می‌کند ([duty spec](../specs/project-wide-cross-workspace-duty-engine.md#L9)، [adapter boundary](../specs/project-wide-cross-workspace-duty-engine.md#L95)). همچنین داشتن workspace access به‌تنهایی برای دیدن/claim کردن duty کافی نیست و task-scoped access نباید دسترسی عمومی به source workspace بدهد ([assignment](../specs/project-wide-cross-workspace-duty-engine.md#L181)، [minimum evidence](../specs/project-wide-cross-workspace-duty-engine.md#L282)).

این seam برای دو workflow Partner مناسب است:

- استعلام قیمت معطل: منبع authoritative خود Quote Request است؛ پاسخ‌دهنده فقط projection فنی لازم و فرم پاسخ را می‌بیند؛
- درخواست انتقال مشتری: منبع authoritative Customer Transfer Request است؛ تصمیم‌گیر فقط duplicate evidence حداقلی و history امن را می‌بیند.

اما نباید Quote lifecycle را فقط به duty تبدیل کرد. Quote header/lines، نسخه‌ها، وضعیت، expiry و پاسخ‌ها حقیقت تجاری مستقل‌اند؛ duty صرفاً projection اقدام معطل است. تغییر پاسخ‌دهنده باید assignment/audit duty و رابطه فعال Partner را هماهنگ کند، بدون اینکه تأییدهای قبلی را بازنویسی کند.

## ۷. صفحه عمومی، PDF و محرمانگی دوسندی

Serializer عمومی فعلی کل `contractData`، آیتم‌ها، deliveryها و paymentها را به client عمومی می‌دهد ([serializer](../../backend/src/services/contractConfirmationService.ts#L110)). برای Partner، حتی اگر UI فیلدی را render نکند، وجود internal price یا margin در JSON افشا محسوب می‌شود.

الزام specification:

- `PublicPartnerContractProjection` فقط allowlist customer-facing داشته باشد؛
- هیچ JSON مشترک شامل internal document، quote snapshot، margin، commercial terms یا بدهی Partner وارد serializer نشود؛
- PDF و OTP همان template/تجربه فعلی را با seller identity Partner و retail price مصرف کنند، اما ورودی‌شان projection customer document باشد؛
- حسابداری فقط internal document projection را بگیرد؛
- تست contract-level تضمین کند کلیدهای ممنوع در response JSON، HTML و PDF وجود ندارند.

## ۸. شکاف‌ها بر حسب شدت

| شدت | شکاف | اثر روی Partner |
| --- | --- | --- |
| بحرانی | Customer list/detail بدون owner scope | افشای PII، قراردادها و فعالیت مشتریان دیگر |
| بحرانی | Contract access دپارتمان‌محور و allow-all برای user بدون department | مشاهده/ویرایش قرارداد، پرداخت، تحویل و PDF دیگران |
| بحرانی | Product/config endpoints قیمت‌دار | افشای قیمت پایه و نرخ‌های داخلی قبل از استعلام |
| بحرانی | Public serializer رکورد گسترده | افشای قیمت خرید/margin/سند داخلی در لینک مشتری |
| بالا | create contract مالکیت customer و quote را server-side enforce نمی‌کند | ساخت قرارداد با customer یا قیمت غیرمجاز |
| بالا | Workspace fallback و MANAGER override وسیع | اعطای ناخواسته فعال‌سازی، انتقال یا پاسخ قیمت |
| بالا | Customer transfer فقط update مستقیم owner است | حذف provenance و نبود تصمیم/دلیل ممیزی‌شده |
| بالا | CRM project/follow-up فقط وجود customer را می‌سنجند | نوشتن Partner روی customer غیرخودی |
| متوسط | scopeهای متعدد و تکراری در route/service | drift و جاافتادن child endpointها هنگام تغییر |
| متوسط | نبود profile/status Partner | ناتوانی در fail-closed کردن گیت‌ها و تعلیق مستقل |

## ۹. الزامات آزمون و پذیرش specification

Specification جدید باید حداقل matrix زیر را اجباری کند:

1. **Customer:** Partner A فقط list/detail/update فرزندان customer A را دارد؛ دسترسی به customer B پاسخ 404/403 بدون PII می‌دهد؛ فروشنده داخلی regression-free باقی می‌ماند؛ duplicate response حداقلی است؛ انتقال تاریخچه قدیمی را بازنویسی نمی‌کند.
2. **Contract/case:** Partner فقط case/document خود را در list، detail، PDF، edit، product graph، SMS، delivery و payment می‌بیند؛ user بدون department broad access نمی‌گیرد؛ Admin/explicit managers طبق scope عمل می‌کنند.
3. **Price:** technical catalog هیچ rate ندارد؛ quote responder retail price را نمی‌بیند؛ Partner قیمت داخلی دیگران را نمی‌بیند؛ submit با expired/mismatched quote در transaction fail می‌شود؛ دستکاری payload قیمت خرید بی‌اثر است.
4. **Activation:** هر گیت ناقص activation را fail-closed می‌کند؛ HR title بدون action grant مجاز نیست؛ suspend ساعت quote را متوقف نمی‌کند؛ terminated user سابقه را حفظ می‌کند.
5. **Projection:** public JSON/PDF/SMS فاقد internal document، Sabalan buy price و margin است؛ Accounting فاقد retail-only evidence است؛ quote responder فاقد retail price است.
6. **Concurrency:** submit هم‌زمان، expiry مرزی و تغییر owner/Partner status در لحظه submit تنها یک نتیجه اتمیک معتبر می‌دهند؛ هیچ پرونده تک‌سندی باقی نمی‌ماند.
7. **Normal-sales regression:** list مشتری و قرارداد، price catalog، CRM manager scope و گزارش‌های فروشندگان داخلی مطابق رفتار تأییدشده فعلی باقی می‌مانند.

## ۱۰. تصمیم نهایی برای seamهای authoritative

Specification باید روی این هفت seam بنا شود:

1. `PartnerProfile/PartnerCommercialAccount` برای نوع تجاری، lifecycle و گیت‌ها؛ نه Role جدید به‌تنهایی.
2. `CustomerAccessPolicy` برای predicate و authorization واحد تمام customer graph، با owner scope فقط برای Partner.
3. `PartnerSalesCase` به‌عنوان aggregate دو سندی و transaction boundary.
4. `PartnerSalesAccessPolicy` برای actor-resource scope تمام اسناد و child endpointها.
5. `ProductConfigurationCatalog` بدون قیمت + priced internal catalog مستقل.
6. `PartnerQuote` به‌عنوان source of truth استعلام و Cross-Workspace Duty فقط به‌عنوان projection اقدام.
7. projectionهای allowlist‌شده جدا برای Partner، مدیریت، پاسخ‌دهنده، Accounting و public customer.

این طراحی از seamهای موجودِ مفید—مالک جاری Customer، فروشنده مسئول/اعتبار فروش SalesContract، action permission، گزارش seller-scoped و duty adapter—استفاده می‌کند، ولی couplingهای فعلی به department، workspace fallback، JSON گسترده و route-local checks را به مرز امنیتی جدید منتقل نمی‌کند.
