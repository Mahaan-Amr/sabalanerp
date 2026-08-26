# ممیزی پیامک، OTP و خروجی عمومی قرارداد Partner

وضعیت: تحقیق تکمیل‌شده  
تاریخ: ۱۴۰۵/۰۶/۰۴  
Issue: [#300](https://github.com/Mahaan-Amr/sabalanerp/issues/300)  
مبنای کد: `602923ebd1fac3234eea3dd5dea7021f4ebd541b`

## نتیجه اجرایی

جریان فعلی تأیید دیجیتال باید برای **قرارداد فروش Partner به مشتری نهایی** حفظ شود، نه برای سند داخلی فروش سبلان به Partner. ساخت نشست، ارسال OTP، lookup، تأیید و audit همگی باید فقط به شناسه قرارداد مشتری متصل باشند. سند داخلی، شماره آن، قیمت استعلام/خرید، سود یا زیان Partner، برنامه پرداخت Partner به سبلان و هر مدرک حسابداری سبلان نباید از مسیر عمومی قابل بازیابی باشند.

استفاده مستقیم از serializer فعلی امن نیست: این serializer کل `contractData` و اشیای رابطه‌ای `items`، `deliveries` و `payments` را برمی‌گرداند، نه یک DTO محدود و نسخه‌دار. در مدل دو‌سندی Partner، این رفتار می‌تواند با اضافه‌شدن metadata یا لینک سند داخلی، wholesale evidence را ناخواسته منتشر کند ([منبع](../../backend/src/services/contractConfirmationService.ts#L103)).

مسیر پیشنهادی:

1. چرخه فعلی `PENDING_APPROVAL → APPROVED` با OTP برای قرارداد مشتری حفظ شود.
2. یک projector/DTO صریح و allowlist‌شده برای خروجی عمومی ساخته شود.
3. هویت فروشنده از snapshot حساب تجاری Partner خوانده شود؛ قالب فعلی صفحه و PDF حفظ شود، اما ثابت‌های هویتی سبلان و `createdByUser` منبع هویت فروشنده نباشند.
4. گذار مالی سند داخلی فقط در هماهنگ‌کننده اتمیک پرونده Partner و هنگام قطعی‌شدن تعریف‌شده انجام شود؛ OTP به‌تنهایی بدهی سبلان را قطعی نکند.
5. قبل از عرضه Partner، قراردادهای رفتاری و امنیتیِ این جریان با تست‌های سرویس/API/E2E پوشش داده شوند؛ تست فعلی فقط عمومی‌بودن route و پایه‌های responsive را بررسی می‌کند ([منبع](../../tests/design-system-e2e/reference-surfaces.spec.ts#L1616)).

## جریان فعلی، از ارسال تا تأیید

### ۱. اختیار ارسال و انتخاب گیرنده

- endpointهای ارسال و ارسال مجدد به workspace فروش با دسترسی `EDIT` و feature مستقل `SALES_VERIFICATION_SEND` نیاز دارند. کنترل resource فعلی فقط `ADMIN` یا هم‌دپارتمان‌بودن قرارداد است؛ مالک قرارداد یا مشتری بررسی نمی‌شود ([ارسال](../../backend/src/routes/sales.ts#L2023)، [ارسال مجدد](../../backend/src/routes/sales.ts#L2085)).
- endpoint وضعیت نیز از همان مرز دپارتمان استفاده می‌کند و به feature مشاهده زمان تأیید متکی است ([منبع](../../backend/src/routes/sales.ts#L2147)).
- شماره گیرنده از CRM مشتری استخراج می‌شود و body درخواست اجازه انتخاب شماره دلخواه نمی‌دهد. اولویت فعلی: موبایل اصلی، سایر شماره‌های نوع mobile، شماره اصلی، موبایل/تلفن contact اصلی، شماره مدیر پروژه، شماره‌های فعال، سایر شماره‌ها، خانه و محل کار. فقط شماره‌ای پذیرفته می‌شود که بعد از normalize با `09xxxxxxxxx` منطبق باشد ([منبع](../../backend/src/services/contractConfirmationService.ts#L73)).
- بنابراین برای Partner باید کنترل resource از «هم‌دپارتمان» به «مالک پرونده/قرارداد مشتری یا مدیر مجاز» تغییر کند، ولی انتخاب گیرنده همچنان server-authoritative و از مشتری متعلق به همان Partner باشد. این محدودیت نباید رفتار فروشندگان داخلی را تغییر دهد.

### ۲. نشست عمومی، token و OTP

- TTL پیش‌فرض لینک ۶۰ روز، TTL کد ۱۰ دقیقه، سقف تلاش ۵ بار و cooldown ارسال مجدد ۶۰ ثانیه است؛ همه با environment قابل تنظیم‌اند ([منبع](../../backend/src/services/contractConfirmationService.ts#L8)).
- token با ۳۲ بایت تصادفی رمزنگاری‌شده تولید و فقط SHA-256 آن ذخیره می‌شود. OTP شش‌رقمی است و فقط hash آن در `ContractPublicConfirmation` ذخیره می‌شود؛ مدل همچنین شماره، انقضاها، تعداد تلاش و resend، وضعیت و سازنده نشست را نگه می‌دارد ([سرویس](../../backend/src/services/contractConfirmationService.ts#L247)، [schema](../../backend/prisma/schema.prisma#L4977)).
- در ارسال عادی، نشست‌های `PENDING` قبلی لغو و نشست جدید ساخته می‌شود. در resend، نشست فعال حفظ، OTP و انقضای آن عوض و تلاش‌ها صفر می‌شوند ([منبع](../../backend/src/services/contractConfirmationService.ts#L279)).
- لینک به شکل `/contracts/confirm/{rawToken}` ساخته و در پاسخ خصوصی API برگردانده می‌شود ([منبع](../../backend/src/services/contractConfirmationService.ts#L361)). با این حال، adapter پیامک فقط پارامترهای `Name`، `ContractNumber` و `Code` را به قالب SMS.ir می‌فرستد و `publicLink` پارامتر پیامک نیست ([منبع](../../backend/src/services/smsService.ts#L320)). پس «ارسال لینک در SMS» در کد فعلی قابل اثبات نیست؛ ممکن است متن ثابت قالب بیرونی کاربر را به صفحه lookup هدایت کند، اما repository این موضوع را ثبت یا تست نمی‌کند.
- اگر ارسال SMS موفق شود و قرارداد `DRAFT` باشد، وضعیت آن `PENDING_APPROVAL` و امضای دیجیتال آن `PENDING` می‌شود. شکست SMS نشست و audit ایجادشده را rollback نمی‌کند، ولی قرارداد را به `PENDING_APPROVAL` نمی‌برد ([منبع](../../backend/src/services/contractConfirmationService.ts#L361)).

### ۳. دسترسی عمومی با token یا lookup

- routeهای عمومی زیر `/api/public` بدون session ورود ERP نصب شده‌اند ([mount](../../backend/src/index.ts#L283)، [routes](../../backend/src/routes/public-contracts.ts#L9)).
- کاربر می‌تواند با token قرارداد را باز کند، یا با زوج «شماره قرارداد + شماره گیرنده نشست» lookup انجام دهد. lookup نشست‌های `PENDING` و `VERIFIED` را تا انقضای لینک برمی‌گرداند ([منبع](../../backend/src/services/contractConfirmationService.ts#L543)).
- صفحه عمومی مبلغ کل، مشتری، شماره تماس، وضعیت و ردیف‌های محصول/قیمت را نشان می‌دهد؛ اگر `contractData.products` وجود داشته باشد بر relation items مقدم است ([منبع](../../frontend/src/app/contracts/confirm/ConfirmationContractView.tsx#L72)).
- payload فعلی هویت فروشنده ندارد؛ در نتیجه صفحه عمومی Partner نمی‌تواند صرفاً با reuse فعلی نشان دهد طرف فروش Partner است. عنوان صفحه lookup نیز صریحاً «تایید قرارداد سبلان ERP» است ([منبع](../../frontend/src/app/contracts/confirm/page.tsx#L117)).

### ۴. تأیید، وضعیت و audit

- بازکردن لینک، lookup دستی، ارسال OTP، شکست OTP، موفقیت OTP، ساخت لینک، ارسال SMS و لغو قرارداد audit می‌شوند. audit شامل IP، user-agent، زبان، fingerprint، referrer، شناسه/پاسخ provider و payload رویداد است ([service](../../backend/src/services/contractConfirmationService.ts#L132)، [schema](../../backend/prisma/schema.prisma#L5002)).
- OTP منقضی یا بیش از سقف تلاش رد می‌شود. OTP درست در یک transaction نشست را `VERIFIED` و قرارداد را `APPROVED` می‌کند و snapshot شماره/زمان/session را در `signatures.digitalConfirmation` می‌گذارد ([منبع](../../backend/src/services/contractConfirmationService.ts#L576)). مسیر lookup دستی همین منطق را در متد موازی دیگری تکرار می‌کند ([منبع](../../backend/src/services/contractConfirmationService.ts#L703)).
- OTP فعلی قرارداد را `SIGNED` نمی‌کند. امضای داخلی endpoint جداگانه‌ای است که فقط قرارداد `APPROVED` را به `SIGNED` می‌برد ([منبع](../../backend/src/routes/sales.ts#L1452)). این جداسازی با تصمیم Partner سازگار است: تأیید مشتری نباید به‌تنهایی بدهی Partner به سبلان را قطعی کند.
- چاپ فعلی فقط اگر وضعیت قبلی `SIGNED` باشد آن را `PRINTED` می‌کند؛ چاپ قرارداد `APPROVED` مقدار `printedAt` می‌گذارد ولی وضعیت را `APPROVED` نگه می‌دارد ([منبع](../../backend/src/routes/sales.ts#L1299)). بنابراین قاعده Partner مبنی بر قطعی‌شدن در `SIGNED` یا `PRINTED` به یک فرمان صریح و اتمیک نیاز دارد و نباید از وجود `printedAt` استنتاج شود.

## PDF و هویت فروشنده در وضعیت فعلی

- PDF از قرارداد، customer، department، `createdByUser`، items، deliveries، payments و `contractData` ساخته می‌شود و fingerprint cache نیز تمام این اجزا را وارد hash می‌کند ([منبع](../../backend/src/utils/salesContractPdf.ts#L12)).
- قالب فعلی نام و تلفن فروشنده را از `createdByUser` می‌گیرد، اما آدرس مجموعه و تلفن مجموعه ثابت سبلان هستند ([منبع](../../backend/src/utils/printTemplate.ts#L207)، [مصرف](../../backend/src/utils/printTemplate.ts#L2131)). footer نیز «سامانه سبلان» را چاپ می‌کند ([منبع](../../backend/src/utils/printTemplate.ts#L2313)).
- بنابراین «همان قالب، فقط فروشنده و قیمت متفاوت» با تعویض `createdByUser` کامل نمی‌شود. باید یک `sellerIdentitySnapshot` صریح شامل نام قانونی/تجاری، شماره تماس و آدرس Partner به renderer داده شود. layout و جدول‌های فعلی قابل حفظ‌اند، اما داده‌های ثابت سبلان باید برای نسخه customer-facing Partner پارامتری شوند. PDF باید فقط از قرارداد مشتری ساخته شود؛ سند داخلی سبلان PDF و fingerprint مستقل خود را داشته باشد.

## شکاف‌ها و ریسک‌های قابل اقدام

| اولویت | یافته | اثر روی Partner | تصمیم لازم |
|---|---|---|---|
| بحرانی | serializer عمومی کل `contractData` و relationها را برمی‌گرداند. | هر wholesale field یا لینک داخلی آینده می‌تواند بی‌صدا public شود. | DTO نسخه‌دار و allowlist؛ query projection بدون relation سند داخلی. |
| بحرانی | کنترل ارسال/وضعیت فقط دپارتمانی است و کاربر بدون دپارتمان در helper عمومی دسترسی انعطاف‌پذیر دارد ([منبع](../../backend/src/services/contractService.ts#L1303)). | Partner ممکن است قرارداد دیگران را هدف ارسال، resend یا status قرار دهد. | policy مالکیت Partner روی هر endpoint خصوصی و تست cross-owner. |
| بالا | صفحه عمومی هویت فروشنده ندارد و PDF هویت ترکیبیِ creator + ثابت‌های سبلان دارد. | مشتری ممکن است سبلان را فروشنده تلقی کند یا هویت قراردادی مبهم شود. | snapshot هویت Partner در قرارداد مشتری و مصرف واحد آن در public/PDF/SMS copy. |
| بالا | لینک ساخته می‌شود اما به adapter SMS داده نمی‌شود. | انتظار «لینک پیامکی» با implementation قابل اثبات نیست. | قرارداد قالب SMS را صریح کنید: یا `Link` به template اضافه شود، یا متن و تست، lookup با شماره قرارداد را رفتار رسمی اعلام کند. |
| بالا | resend داخلی token را عوض می‌کند، ولی لینک جدید فقط در پاسخ خصوصی برمی‌گردد؛ resend عمومی token را ثابت نگه می‌دارد. | لینک قبلی مشتری پس از resend داخلی نامعتبر می‌شود، بدون اینکه لینک جدید الزاماً به او برسد. | token لینک در resend ثابت بماند، یا ارسال لینک جدید اتمیک و تست‌شده باشد. |
| بالا | در resend، شماره جدید CRM برای SMS استفاده می‌شود ولی `session.phoneNumber` به‌روز نمی‌شود. | OTP ممکن است به شماره جدید برسد، اما lookup آن شماره شکست بخورد و audit/status شماره قبلی را نشان دهد. | recipient snapshot را در resend حفظ کنید یا تغییر شماره را با نشست جدید و audit صریح انجام دهید. |
| بالا | لغو قرارداد فقط نشست‌های `PENDING` را لغو می‌کند؛ token یک نشست `VERIFIED` تا پایان ۶۰ روز همچنان payload قرارداد لغوشده را برمی‌گرداند ([منبع](../../backend/src/services/contractConfirmationService.ts#L902)). | قرارداد/اطلاعات مشتری بعد از لغو همچنان public است. | policy retention/view-after-cancel را صریح و برای Partner fail-closed کنید. |
| متوسط | OTP با `Math.random` ساخته می‌شود، route عمومی throttling سراسری/IP ندارد و lookup قابل تلاش است. | سطح حمله عمومی برای قراردادهای Partner گسترش می‌یابد. | `crypto.randomInt`، rate limit ترکیبی IP/phone/contract و telemetry بدون PII خام. |
| متوسط | دو پیاده‌سازی تقریباً تکراری برای verify token و verify lookup وجود دارد. | اصلاح یک شاخه می‌تواند شاخه دیگر را ناهمسان بگذارد. | هر دو route به یک command اتمیک `verifySessionOtp` متکی شوند. |
| متوسط | `eventHash` زنجیره یا قید یکتا ندارد و provider raw response ذخیره می‌شود. | audit موجود سابقه مفید است، اما مدرک tamper-evident یا حداقل‌سازی‌شده نیست. | schema داده provider، redaction/retention و در صورت نیاز chain/version مشخص شود. |
| متوسط | مدل قدیمی `ContractVerificationCode` کد را plaintext نگه می‌دارد و سرویس قدیمی آن route مصرف‌کننده ندارد ([schema](../../backend/prisma/schema.prisma#L4956)، [سرویس](../../backend/src/services/verificationService.ts#L35)). | reuse تصادفی مسیر قدیمی، امنیت Partner را پایین می‌آورد و وضعیت را مستقیماً `SIGNED` می‌کند. | Partner فقط از `ContractPublicConfirmation` استفاده کند؛ مسیر قدیمی retire یا صریحاً quarantine شود. |
| بالا | تست رفتاری برای service/routes OTP، recipient، public payload، resend، cancellation و audit یافت نشد. | regression یا افشای wholesale بدون هشدار CI ممکن است. | مجموعه تست اجباری زیر قبل از rollout ساخته شود. |

## قرارداد خروجی عمومی Partner

پاسخ عمومی باید فقط این داده‌ها را داشته باشد:

- شناسه و شماره **قرارداد مشتری**، وضعیت customer-facing، زمان‌های OTP/link و زمان تأیید؛
- snapshot هویت فروشنده Partner: نام قانونی/تجاری، تلفن و آدرسِ مجاز برای مشتری؛
- نام و شماره تماس مشتری نهایی؛
- اقلام customer-facing از Product Graph مشترک: نام/مشخصات، مقدار، واحد، فرآوری و خدماتی که در قرارداد مشتری فروخته شده‌اند؛
- **قیمت فروش Partner به مشتری**، تخفیف مشتری، مالیات/هزینه customer-facing، مبلغ نهایی و برنامه پرداخت مشتری به Partner؛
- برنامه تحویل مستقیم به مشتری در حدی که اکنون در قرارداد مشتری نمایش داده می‌شود.

این موارد باید هم در query و هم در serializer ممنوع باشند، نه اینکه فقط در UI پنهان شوند:

- شماره یا شناسه سند داخلی سبلان، شناسه پرونده داخلی در صورت غیرضروری‌بودن برای مشتری؛
- استعلام قیمت، قیمت خرید/wholesale، زمان اعتبار یا پاسخ‌دهنده استعلام؛
- اختلاف قیمت، سود/زیان Partner و محاسبات مدیریتی؛
- شرایط پرداخت، پرداخت‌ها، مانده و وضعیت حساب Partner نزد سبلان؛
- وضعیت یا note حسابداری، audit داخلی، permission/actor IDs و raw relation objects؛
- هر snapshot یا metadata آزاد که بعداً ممکن است evidence داخلی بگیرد.

این projector باید یک تابع pure و تست‌پذیر باشد و frontend نیز type دقیق همان نسخه را مصرف کند؛ `any` و fallback به object خام در مرز عمومی پذیرفته نشود.

## چرخه پیشنهادی Partner

1. Wizard اتمیک پرونده، سند داخلی و قرارداد مشتری را در `DRAFT` می‌سازد؛ تنها قرارداد مشتری قابلیت public confirmation دارد.
2. Partnerِ مالک یا مدیر مجاز `send-for-confirmation` را روی قرارداد مشتری اجرا می‌کند. backend مالکیت، فعال‌بودن Partner، تعلق مشتری و عدم اشاره به سند داخلی را دوباره بررسی می‌کند.
3. شماره موبایل معتبر مشتری به‌عنوان recipient snapshot نشست ثبت می‌شود. تغییر شماره پس از ارسال یا نشست جدید می‌سازد یا با فرمان ممیزی‌شده انجام می‌شود؛ resend گیرنده را بی‌صدا عوض نمی‌کند.
4. موفقیت SMS قرارداد مشتری را `PENDING_APPROVAL` می‌کند. شکست provider نباید نتیجه موفق به UI بدهد؛ وضعیت نشست ناموفق/قابل retry باید قابل مشاهده و idempotent باشد.
5. token یا lookup فقط DTO قرارداد مشتری را برمی‌گرداند. هر دو مسیر از یک projector و یک policy استفاده می‌کنند.
6. OTP درست فقط قرارداد مشتری را `APPROVED` می‌کند. قیمت و شرایط customer-facing snapshot می‌مانند؛ سند داخلی و بدهی سبلان تغییر نمی‌کنند.
7. فرمان قطعی‌سازی بعدی، با قفل/transaction پرونده، قرارداد مشتری را `SIGNED` یا `PRINTED` و سند داخلی را قطعی می‌کند. retry باید idempotent باشد و دو سند نتوانند نیمه‌قطعی بمانند.
8. چاپ/PDF مشتری از همان template فعلی با identity snapshot Partner و retail values ساخته می‌شود. PDF داخلی از identity و wholesale values سبلان ساخته و هیچ‌گاه از public route سرو نمی‌شود.

## حداقل تست‌های پذیرش

### backend service/API

- اولویت انتخاب موبایل، normalize ایران، نبود موبایل و تغییر موبایل بین send/resend؛
- Partner مالک مجاز است؛ Partner دیگر، فروشنده داخلی بدون مجوز و کاربر هم‌دپارتمانِ غیرمالک رد می‌شوند؛ رفتار فروشنده داخلی فعلی بدون regression حفظ می‌شود؛
- token و lookup payload دقیقاً برابر allowlist است و fixture حاوی `wholesalePrice`، `inquiryId`، `margin`، `internalDocument` و شرایط بدهی هیچ‌کدام را در JSON تولید نمی‌کند؛
- OTP درست/غلط/منقضی، سقف تلاش، cooldown، resend و race دو verify؛
- ارسال ناموفق، retry provider و idempotency؛
- لغو قبل و بعد از verify و policy مشاهده پس از لغو؛
- audit برای تمام transitionها با redaction و بدون OTP/token خام؛
- OTP فقط customer contract را `APPROVED` می‌کند و سند داخلی/بدهی تغییر نمی‌کند؛ فرمان finalization هر دو سند را اتمیک قطعی می‌کند.

### PDF و frontend E2E

- صفحه token و lookup نام/تلفن/آدرس Partner و فقط قیمت‌های retail را نشان می‌دهد؛
- متن، لوگو/هویت و footer مطابق تصمیم تجاری Partner است و هیچ ثابت گمراه‌کننده سبلان به‌عنوان فروشنده باقی نمی‌ماند؛
- PDF قالب فعلی را حفظ می‌کند ولی seller identity و retail payment plan را از customer-document snapshot می‌گیرد؛
- با جست‌وجوی متن PDF/HTML/JSON، wholesale evidence و شماره سند داخلی غایب است؛
- SMS contract test نام پارامترهای template و وجود یا عدم وجود رسمی لینک را قفل می‌کند؛
- تأیید OTP، refresh، resend، expiry و cancellation در token و manual lookup یکسان رفتار می‌کنند.

## مواردی که نباید با این قابلیت ادغام شوند

- `verificationService.ts` و `ContractVerificationCode` مسیر قدیمی متفاوتی هستند و نباید برای Partner دوباره فعال شوند.
- PDF حسابداری/کارگاه و سند داخلی سبلان نباید به public confirmation متصل شوند.
- تأیید OTP مشتری نباید معادل امضای داخلی، چاپ یا ایجاد بدهی سبلان تلقی شود.
- پنهان‌کردن wholesale field در React کافی نیست؛ حذف باید پیش از serialization در backend انجام شود.

