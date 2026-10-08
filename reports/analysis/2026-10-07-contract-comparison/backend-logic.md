# مقایسه بک‌اند و قواعد تجاری ایجاد قرارداد عادی و همکار

تاریخ بررسی: ۲۰۲۶-۱۰-۰۷. این گزارش بررسی منبع فعلی با اجرای محدود تست pure است؛ اجرای سناریو واقعی، اثبات همه raceها، تحویل SMS و وضعیت دیتابیس تولید از این بررسی نتیجه نمی‌شود. هیچ فایل محصول، داده یا سرویس تغییر نکرده است. شماره خطوط مربوط به checkout زمان بررسی است.

## نتیجه اصلی

دو جریان در پیکربندی محصول و ابزارهای خروجی اشتراک دارند، اما یک aggregate و یک قرارداد اقتصادی نیستند. عادی یک فروش سبلان به مشتری است؛ همکار یک پرونده با فروش همکار به مشتری و خرید مستقل همکار از سبلان است. یکسان‌کردن مستقیم API یا مدل داده، خطر انتقال بدهکار، افشای قیمت خرید، ثبت زودهنگام تعهد و حذف سابقه استعلام دارد.

## مرجع و تقدم تصمیم‌ها

- `CONTEXT.md`: واژگان یادداشت، پیش‌نویس، امضا شده، قطعی، قیمت خرید/فروش و وصول مستقل.
- ADR-0043: recovery ایجاد با قرارداد ثبت‌شده تفاوت دارد.
- ADR-0046: Case مالک گراف، لینک‌ها، نسخه‌ها و دو projection است؛ بخش‌هایی از lifecycle قدیمی آن بعداً تغییر کرده‌اند.
- ADR-0099: مشتری و پروژه مشترک؛ ADR-0101: عمر مستقل قیمت؛ ADR-0104: تفکیک شماره‌ها؛ ADR-0107: ادامه آماده‌سازی هنگام استعلام.
- ADR-0110: گردش جدید عادی؛ ADR-0111 `use-ordinary-sale-pricing...`: مبنای قیمت‌گذاری معمول در ورود محصول همکار.
- ADR-0113 و تمام اصلاحیه‌های انتهای فایل: مرجع فعلی همکار، شامل حذف امضای فروشنده، اصلاح چندباره، حذف بررسی دوم حسابداری و حذف عملیاتی با حفظ تاریخچه. متن قدیمی ADR-0046/0107 و READMEها به‌تنهایی مشخصات جاری نیست.
- ADR-0111 `authorize-ordinary-contract-dispatch...`: عادی مجوز مدیر و اعتبار فروشنده دارد؛ این استثنا به همکار تعمیم ندارد.

## جدول مقایسه قواعد و پیاده‌سازی

| محور | فروش عادی | فروش همکار | شاهد |
|---|---|---|---|
| واحد تجاری | `SalesContract`، فروش سبلان به مشتری | `PartnerSaleCase`، `SalesContract` با `PARTNER_CUSTOMER` و رکورد داخلی `SabalanToPartnerSaleRecord` | `backend/prisma/schema.prisma:1838,11974,12020` |
| بدهکار سبلان | مشتری قرارداد | حساب تجاری همکار؛ مشتری نهایی گیرنده فیزیکی/طرف فروش همکار | `partnerSales/cases/linkedPair.ts:116`، `partnerSales/cases/projections.ts:39` |
| زمان ثبت موجودیت | POST نهایی یک قرارداد و وابستگی‌ها را می‌سازد | انتخاب محصول می‌تواند Case شماره‌دارِ هنوز ناتمام بسازد؛ تکمیل آماده‌سازی زوج رکورد را تخصیص می‌دهد | `contractService.ts:782`، `partnerSales/cases/aggregate.ts:635,702` |
| API ایجاد | `/api/sales/contracts` | `/api/partner/cases/commands` با `CASE_SUBMIT` و `CASE_DRAFT_REVISE` | `routes/sales.ts:1153`، `routes/partner-cases.ts:586` |
| payload | عنوان، متن، customer/department/template، contractData، relations | command typed، intent، recovery revision، expected Case revision/hash، idempotency | همان مسیرها؛ `aggregate.ts:500` |
| شماره مشتری | lane مشترک قرارداد فروش | همان lane؛ شماره داخلی `PI-`؛ Case و tracking مستقل | `contractService.ts:801`، `linkedPair.ts:97` |
| قیمت مشتری | گراف canonical + تخفیف/جمع قابل پرداخت | قیمت مستقل retail؛ قیمت wholesale از پاسخ سبلان | `contractService.ts:829`، `projections.ts:22,39` |
| استعلام خرید | وجود ندارد | درخواست، پاسخ، پذیرش/رد و expiry جداگانه؛ محصول تغییرکرده نیازمند successor evidence | `partnerSales/inquiries/service.ts:197,341` |
| ادامه تحویل/پرداخت | پیش از ثبت نهایی تکمیل می‌شود | مستقل از pending/rejected wholesale؛ دریافت قرارداد مشتری مشروط به آمادگی retail | `linkedPair.ts:38`، `commercialLifecycle.ts:34` |
| تأیید فروش | revision جاری | revision تجاری جاری همکار؛ مستقل از inquiry | `ordinaryContractLifecycle.ts:106`، `commercialLifecycle.ts:107` |
| پذیرش مشتری | DIGITAL/PAPER، revision مشخص | DIGITAL/PAPER، revision مشخص؛ قیمت خرید مخفی | `ordinaryContractLifecycle.ts:130`، `commercialLifecycle.ts:123` |
| قطعی‌شدن | تأیید فروش + پذیرش مشتری همان نسخه | همان دو تأیید + تمام قیمت‌های لازم معتبر و پذیرفته‌شده + آمادگی | `ordinaryContractLifecycle.ts:24`، `commercialLifecycle.ts:48` |
| شروع مهلت مالی | زمان ایجاد/پذیرش گردش جدید | تکمیل آماده‌سازی و پذیرفته‌شدن همه قیمت‌های معتبر | `ordinaryContractLifecycle.ts:70`، `commercialLifecycle.ts:59` |
| تحقق فروش | اولین رکورد مالی موفق؛ حذف آخرین رکورد اثر برگشتی دارد | همان trigger برای گردش جدید؛ مبلغ سبلان از wholesale | `partnerSales/accounting/commercialRealization.ts:7`؛ ADR-0110 |
| تحویل عملیاتی | قطعی + تأیید مالی/مجوز مدیر/دریافت و اعتبار معتبر؛ استثنای مشتری اعتباری | قطعی + تعهدات معتبر داخلی و وصول کامل همکار به سبلان | `ordinaryContractDispatchEligibility.ts:55`، `partnerSales/fulfillment/commercialSettlement.ts:8` |
| ویرایش دارای مالی | دوره اصلاح حسابداری؛ re-finality به بررسی حسابداری برمی‌گردد | مجوز جاری اصلاح؛ re-finality وظیفه را بدون بررسی دوم می‌بندد | `ordinaryContractLifecycle.ts:80`؛ ADR-0113:156 |
| حذف | مسیر کنترل‌شده حذف و وابستگی‌ها | حذف عملیاتی، Case/نسخه/استعلام و audit حفظ می‌شود | `contractLifecycleService.ts:415`، `partnerSales/cases/operationalDeletion.ts:3` |

نام‌های کوتاه خدمات در جدول زیر `backend/src/services/` هستند؛ نام‌های `routes/` زیر `backend/src/` هستند.

## ۱. مسیر واقعی عادی؛ مسیر legacy را نباید اشتباه گرفت

`backend/src/routes/contracts.ts` مسیر legacy جداگانه با featureهای `SALES_LEGACY_*` است. جریان فعلی ایجاد از `backend/src/routes/sales.ts:1153` به `backend/src/services/contractService.ts:782` می‌رود. مقایسه با route قدیمی به‌جای مسیر فعلی، تأیید ADMIN، SIGNED/PRINTED و محدودیت ویرایش را اشتباه نشان می‌دهد.

ترتیب createContract: اعتبارسنجی هویت مشتری/پروژه؛ تخصیص شماره؛ بررسی فرصت CRM؛ تعمیر identity عملیات/معنای محصول؛ normalization تخفیف؛ ساخت migration plan با `CURRENT_CONTRACT_PRODUCT_POLICY_V3`؛ seal کردن total؛ ساخت SalesContract؛ ذخیره اقلام، تحویل و پرداخت؛ snapshot canonical و audit repair؛ اعتبارسنجی quantity evidence؛ لینک CRM؛ اعتبار فروشنده و مشتری اعتباری؛ notification در همان transaction. (`contractService.ts:790-1000`)

مسیر عادی lease را پیش از create می‌سنجد و پس از transaction آزاد می‌کند (`routes/sales.ts:1168,1232`). ورودی department برای کاربر دارای department محدود می‌شود؛ ADMIN یا کاربر بدون department شرط متفاوت دارد (`:1191`). این رفتار متفاوت با ownership پرونده همکار است، نه لزوماً ایراد.

## ۲. مسیر واقعی همکار و ثبت زودهنگام Case

بک‌اند همکار technical recovery را ذخیره و canonical technical evidence تولید می‌کند (`partnerSales/cases/technicalSave.ts:39,63`). سپس `CASE_SUBMIT` می‌تواند `preparationCompleted:false` داشته باشد و Case، revision، ردیف‌ها و قیمت‌گذاری را پیش از تکمیل قرارداد بسازد. `routes/partner-cases.ts:586-664` ساخت Case و `CASE_PRICING_SUBMIT` را در یک transaction با timeout ۳۰ ثانیه انجام می‌دهد؛ failure هرکدام rollback کل عملیات است. notification پس از commit dispatch می‌شود و event durable برای retry باقی می‌ماند.

`aggregate.ts:500-572` payload hash، actor سرور، recovery lock، idempotency receipt و reauthorization را بررسی می‌کند. replay نتیجه فعلی پرونده را با رسید معتبر برمی‌گرداند؛ صرف ذخیره شدن نتیجه قبلی مجوز جدید ایجاد نمی‌کند. optimistic revision/hash و lockهای Case/Recovery جلوی تغییر روی head اشتباه را می‌گیرند.

`linkedPair.ts:38` برای گردش جدید اجازه تخصیص زوج قبل از آماده بودن قیمت خرید می‌دهد، اما retail preparation باید کامل باشد. شماره مشتری از lane عادی و شماره داخلی از `PI-` می‌آید. `SalesContract.contractData` یک customer projection typed است، نه شکل legacy عادی. account همکار، department، متن حقوقی، currency و payable برای تخصیص لازم‌اند. customer contract و internal record در transaction پیوند می‌خورند؛ allocation دوباره روی زوج کامل idempotent است و زوج نیمه‌کاره integrity conflict است.

## ۳. مدل داده و یکپارچگی

عادی `SalesContractProductGraphState` و graph audit همراه collections وابسته قرارداد دارد (`schema.prisma:1939,1955`). همکار head و append-only `PartnerCaseRevision` دارد که graph، parties، retail/wholesale envelopes، payment evidence و projections را نگه می‌دارد (`:12056`). `PartnerProductRow` و bindingها هویت مشترک محصولات را حفظ می‌کنند؛ delivery و plan به case/revision متصل‌اند (`:12104-12220`). رکورد داخلی مالک customer sale نیست و مشتری نهایی نباید جای commercialAccount بنشیند.

دو شمارنده یکسان نیستند: Case revision برای شواهد graph/wholesale و commercialRevision قرارداد برای تأییدهای تجاری. همچنین عددهای flow مختلف‌اند: عادی Contract flow=1، جدید Partner Case flow=1 ولی customer Contract flow=2. هر refactor که همه `1`ها را معنای یکسان فرض کند امکان تغییر مسیر تاریخی/جاری دارد.

schema روابط nullable زوج Case را مجاز کرده چون Case ناتمامِ شماره‌دار وجود دارد. بنابراین قاعده قدیمی «هر Case همیشه فوراً زوج non-null دارد» را نباید invariant فعلی معرفی کرد. قواعد SQL migration/trigger به‌صورت کامل در این زیرگزارش اجرا/اثبات نشده‌اند.

## ۴. قیمت‌گذاری و پول

اشتراک مبنای عادی طبق ADR-0111 به معنی اشتراک rate نیست. retail seller-entered مستقل از wholesale responder-entered است؛ حکمی هر توافق از همان مبلغ ماده محاسبه می‌شود؛ fixed ancillary rates و paid-remainder zero-material مشترک‌اند. هندسه مصرف مادر لزوماً مساحت محصول نهایی نیست؛ units و child graph باید در هر دو projection معنا را حفظ کنند.

عادی total را از canonical reconciliation seal می‌کند و با total ارسال‌شده تطبیق می‌دهد (`contractService.ts:837-845`). تخفیف eligibility و no-discount evidence نیز normalized است. همکار projection مشتری از retailEnvelope و accounting از wholesaleEnvelope ساخته می‌شود (`projections.ts:32,47`)، پیش‌نمایش خرید از quote دقیق و material quoteهای معتبر استفاده می‌کند، و incomplete quote جمع حدسی نمی‌دهد (`inquiries/wholesalePricing.ts:8-44`). مشتری نباید rate خرید یا mandatory خرید را دریافت کند.

سرویس مستقل می‌تواند بدون سنگ قرارداد بسازد (`routes/partner-cases.ts:590`). نرخ مشتری editable است، نرخ خرید trusted catalog است؛ service row جای inquiry سنگ مصنوعی نمی‌نشیند و quantity اجرای خدمت با delivery خدمت توزیع می‌شود؛ physical fulfillment از stone graph است. این semantics نیازمند آزمایش جامع همه خانواده‌های محصول است؛ گزارش بک‌اند به‌تنهایی همه arithmetic branchها را اثبات نمی‌کند.

## ۵. استعلام و نسخه‌بندی قیمت

همکار per-offer `expiresAt=approvedAt+48h` دارد (`inquiries/service.ts:197`)؛ inquiry submission مبدأ expiry نیست. predecessor/successor در همان Case lineage بررسی می‌شوند (`:411-423`) و prior successor مانع شاخه تکراری است. نرخ پذیرفته‌شده فقط برای configuration دقیق و owned profile معتبر است؛ material layerها نیز approval مستقل و hash دارند (`aggregate.ts:30-73`).

قیمت retail، مشتری، payment و delivery نباید بی‌دلیل wholesale quotation را نامعتبر کند؛ technical configuration یا ancestor price-dependent چنین می‌کند. after-final قیمت frozen معتبر می‌ماند؛ گذشت ۴۸ ساعت تعهد قبلی را پس نمی‌گیرد (`commercialLifecycle.ts:53-57`). این مفهوم در عادی همتا ندارد و حذف آن در یکپارچه‌سازی اشتباه است.

## ۶. وضعیت، ترتیب تأیید و امضای مشتری

عادی: نه تأیید = DRAFT/یادداشت؛ تنها فروش=PENDING_APPROVAL/پیش‌نویس؛ تنها مشتری=APPROVED/امضا شده؛ هر دو=SIGNED/قطعی (`ordinaryContractLifecycle.ts:24-30`). PRINTED در گردش جدید trigger مستقل مالی یا قطعی نیست. نسخه قدیمی قواعد متفاوت دارد.

همکار همین commercial approvals را دارد اما `reconcilePartnerCommercialFinality` آمادگی و قیمت پذیرفته‌شده را اضافه می‌کند. READY پاسخ همه ردیف‌ها می‌تواند label «استعلام شده» بدهد؛ با acceptance همه مشتری/فروش/خرید FINAL می‌شود. UI display status با persistence status و Case state یک چیز نیست (`commercialLifecycle.ts:174-198`؛ `routes/sales.ts:703-719`). label استعلام شده به‌تنهایی به معنی ایجاد بدهی نیست.

`approvePartnerCommercialSales` preparation کامل و revision جاری را لازم می‌داند، نه تکمیل استعلام (`:107`). `acceptPartnerCustomer` DIGITAL/PAPER را ثبت می‌کند و reconciliation می‌کند (`:123`). `rejectPartnerCustomer` مشتری قبلاً پذیرفته همان نسخه را رد نمی‌کند، acceptance را پاک و case confirmation را REJECTED می‌کند (`:143`). endpoint رد عمومی ordinary fallback فعال ندارد (`contractConfirmationService.ts:773-774`)؛ این تفاوت محصولی باید در مصاحبه روشن بماند.

فروشنده مرحله امضای مستقل ندارد؛ اصلاحیه قدیمی امضای فروشنده در ADR-0113 صریحاً superseded است. دلیل reject مشتری/قیمت و تاریخچه وظیفه‌ها نباید با cancel Case اشتباه شود.

## ۷. مهلت و expiry

عادی از creation/adoption مدت تخصیص‌یافته را نگه می‌دارد (`ordinaryContractLifecycle.ts:70`)، با firstFinancialRecordAt از expiry تجاری خارج می‌شود. در کد فعلی dispatchExpiryExempt هم وجود دارد (`:31,40`)؛ برای فهم رفتار نهایی باید ADR اعتبار/ارسال جدید را هم خواند.

همکار تنها وقتی قیمت پذیرفته و preparation کامل است اولین commercialExpiresAt را می‌گیرد (`commercialLifecycle.ts:59-63`)، نه در انتظار پاسخ سبلان. edit مدت را از نو آغاز نمی‌کند. renew با reason و صلاحیت مدیریت effective Sales بررسی می‌شود (`routes/partner-cases.ts:862-868`). حذف رکورد مالی firstFinancialRecordAt را پاک نمی‌کند؛ renew/re-inquiry راه دورزدن مالی قبلی نیست.

## ۸. recovery و ownership

زیرساخت مشترک `SalesContractEditSession` دارای purpose `STANDARD` و `PARTNER_TECHNICAL` است؛ lease ۷۵ ثانیه، lifetime creation unbound هفت روز است (`contractEditSessionService.ts:7-8`). acquisition همکار purpose را server-owned تعیین می‌کند (`:526-539`)؛ generic Sales route نباید آن را از browser قبول کند. technical saved snapshots monotonic و hash-bound هستند؛ readSaved و save نیز lease می‌خواهند (`technicalSave.ts:42-94`).

همکار recovery برای Case شماره‌دار/اصلاح ممکن است حفظ شود؛ lifetime قرارداد را از lifetime draft unbound نمی‌توان استنتاج کرد. checkpoint به‌تنهایی نه تغییر تجاری است نه مصرف مجوز حسابداری. unchanged return باید approvals/debt/revision را حفظ کند؛ aggregate customer-visible equality و wholesale equality را برای این تفکیک دارد (`aggregate.ts:329-344`، `customerOutput/customerVisible.ts:5`).

## ۹. دسترسی و حریم اقتصادی

عادی primarily workspace/feature/departments/responsible seller است (`routes/sales.ts:1153`، `contractService.ts:1496`). همکار purpose/root/channel، owner profile، lifecycle، assignment و authorization revision را در مرکز policy بررسی می‌کند (`authorization/service.ts:18-81`). partner profile حتی با user role ADMIN شخصیت INTERNAL ADMIN نمی‌گیرد (`:32`). در public channel فقط CUSTOMER_OUTPUT مجاز است (`:24`). profile suspended read و mutation قواعد جدا دارد؛ عدم فعالیت profile با غیرفعال‌بودن User یکسان نیست.

price responder فقط assignment و evidence تکنیکی/wholesale دارد، مالک sale credit و retail evidence نمی‌شود. override داخلی named management هم به معنای حق نوشتن retail از طرف همکار نیست. مشتری فقط allowlist customer DTO دارد. authenticated Sales detail برای PARTNER_CUSTOMER نیز authorization/projection خصوصی جدا دارد (`routes/sales.ts:912-941`).

## ۱۰. خروجی، OTP و فایل

shared `ContractConfirmationService` ابتدا partner hook را صدا می‌زند (`:265,499,609`)؛ partner مسیر ordinary fallback نیست. sessionها باید snapshot/revision/recipient/hash مشخص داشته باشند؛ تغییر تجاری pending links را CANCELLED می‌کند (`commercialLifecycle.ts:168`). customer projection در `projections.ts:22-36` تنها retail rows/totals/plan/parties را می‌سازد. حسابداری/fulfillment فقط هنگام قیمت کامل projection معتبر دارند (`:37-49`).

`projectCustomerVisibleRevisionContent` identity تولیدشده، revision و workflow را از مقایسه تغییر تجاری کنار می‌گذارد؛ aliased product identity در deliveries حفظ می‌شود (`customerVisible.ts:5-33`). PDF و چاپ مشتری نباید از wholesale view ساخته شود. چاپ حسابداری variantهای عمومی را حفظ می‌کند؛ خرید unresolved به معنی zero نیست. README customerOutput توضیح SIGNED/PRINTED commitment قدیمی دارد و باید با runtime/ADR جدید سنجیده شود.

## ۱۱. حسابداری و گزارش

همکار financial source=`PARTNER_INTERNAL_RECORD`، sourceId رکورد داخلی است (`accounting/commercialRealization.ts:11`)، monetary reporting از `caseComparableAmount(views.accounting.totals)` استفاده می‌کند (`:27`). retail receipts حق همکار است و بدهی/وصول سبلان را تعیین نمی‌کند. first successfully saved record شامل draft تحقق فروش را ثبت می‌کند؛ subsequent record/retry نباید double-count کند. آخرین مالی معتبر اگر حذف/void شود reversal ثبت می‌شود و firstFinancialRecordAt باقی می‌ماند.

approval invoice با ایجاد receivable همکار جداست؛ explicit receivable action narrow permission و frozen source را بررسی می‌کند (بخش پایانی `partnerSales/accounting/README.md`؛ ownership writerها برای runtime جداست). quote acceptance، customer signature، print یا opening unsaved form financial realization نیست. مشخصات قدیمی «commit همان realization» در READMEها فعلی نیست.

## ۱۲. ویرایش، لغو و فعال‌سازی مجدد

عادی financial record یا firstFinancialRecordAt قفل اصلاح حسابداری را لازم می‌کند (`contractService.ts:1100-1121`)؛ هر successful commercial save revision و approvals را reset می‌کند (`:1317-1324`). دوره چند save با تجدید قطعی بسته و به بررسی ordinary برمی‌گردد.

همکار `aggregate.ts:169-179` financial evidence یا COMMITTED را با current commercial edit permission کنترل می‌کند؛ visible NOTE پس از edit مجوز بی‌انتها نمی‌سازد. exact hash/revision و customer/project authority مجدداً سنجیده می‌شوند. technical correction physical floor را حفظ می‌کند. reset در `commercialLifecycle.ts:156` approvals و links نسخه جدید را بی‌اعتبار و تاریخچه را حفظ می‌کند. finishCommercialCorrection Partner branch (`ordinaryContractLifecycle.ts:84-98`) بدون ایجاد round دوم حسابداری وظیفه را می‌بندد؛ این تفاوت عمدی و مصوبه آخر ADR-0113 است.

cancel Case کل زوج/تعهد را با history/adjustments کنترل می‌کند؛ physical exit یا open reservation blocker است. reactivation برای previously final مجوز تازه و قیمت تازه تمام ردیف‌ها می‌خواهد و مالی voided خودکار زنده نمی‌شود. این مسیرها فقط نقطه اتصال و قواعد منبع بررسی شدند؛ اجرای کامل همه receipt/check/tax branchهای لغو در این زیرگزارش انجام نشده است.

## ۱۳. لجستیک

ordinary gate فعلی `ordinaryContractDispatchEligible` است، نه صرف جمله تاریخی «قطعی و وصول کامل»: special customer credit، financial approval، manager approval و seller credit مسیرهای عمدی فعلی‌اند (`ordinaryContractDispatchEligibility.ts:55-64`). check باید cleared باشد و vouchers authoritative posted کنترل می‌شوند (`:17-52`).

partner gate فقط contract SIGNED و current finality، accounting projection معتبر و settled official obligations داخلی را قبول می‌کند (`commercialSettlement.ts:8-30`). receipt retail یا seller credit عادی در این gate نیست. هر obligation داخلی باید مثبت، با currency درست و fully collected باشد و total حداقل wholesale payable را پوشش دهد. loss settlement آینده loading/exit را می‌بندد؛ physical evidence قبلی حفظ می‌شود.

## ۱۴. حذف و غیرفعال‌سازی

`contractLifecycleService.ts:71-145` partner invoices/receivables/tax/retail receipt/shipment/loading/reservations را هم در dependency preview می‌سنجد. NOTE/CANCELLED eligibility و Case سپس contract locks بررسی می‌شوند (`:222-235`). branch همکار `:415-422` حذف عملیاتیِ irreversible و auditHistoryRetained است؛ schema Case را hard-delete نمی‌کند. `partnerContractWasDeleted` از EXECUTED DELETE می‌خواند و read/mutate بعدی باید fail closed باشد (`operationalDeletion.ts:3-5`).

## ۱۵. ریسک‌های قابل پیگیری؛ باگ اثبات‌شده نیستند

1. **عدم تقارن idempotency create:** PartnerCommandOutcome رسید durable دارد؛ ordinary create فقط unique-number retry دارد (`contractService.ts:1000`)، سپس release lease بیرون commit می‌شود (`routes/sales.ts:1232`). اگر پاسخ پس از commit قطع شود یا release خطا بدهد، رفتار retry عادی باید جداگانه اثبات شود. بدون اجرای این سناریو نمی‌توان ادعای duplicate قطعی کرد.
2. **اسناد قدیمی متعارض:** README customerOutput/accounting و متن اصلی ADR-0046 هنوز commitment/PRINTED/one-save قبلی را توصیف می‌کنند. آخرین amendments ADR-0113 و runtime معیارند؛ refactor بر اساس README تنها خطر regression دارد.
3. **چند معنای status و version:** CaseState، pricingState، customerConfirmationState، ContractStatus و commercial display یک عدد/label مشترک نیستند. shared component نباید SIGNED را بدون partner guards کافی برای finality/dispatch بداند.
4. **legacy mutation compatibility:** CRUD اقلام/تحویل/پرداخت مستقل در `routes/sales.ts:2080-2593` وجود دارد؛ ordinary versioned contract مالک full editor است (`ordinaryContractLifecycle.ts:47`). partner linked pair هیچ writable independent graph نباید پیدا کند. همه compatibility endpoints باید با permission/schema test پوشش داده شوند؛ audit call sites کامل اینجا اجرا نشده.
5. **quote-only broad error mapping:** Partner commands بعضی exceptions را INTEGRITY_CONFLICT می‌کنند (`routes/partner-cases.ts:656`)، commercial endpoint بسیاری failureها را 409 message می‌دهد (`:881`). مقایسه UX خطای واقعی لازم است؛ input mistake نباید support incident به نظر برسد.
6. **حریم در shared output/accounting refactor:** استفاده از customer SalesContract.totalAmount برای financial partner یا استفاده از internal projection در customer DTO، هم بدهی را غلط و هم قیمت خرید را افشا می‌کند.

## پوشش و محدودیت صریح

بررسی مستقیم: دو مسیر create جاری و legacy distinction؛ ordinary create transaction و total sealing؛ partner command/aggregate/linked-pair/technical-save؛ schema Case/revision/internal/customer links؛ current commercial lifecycle هر دو؛ inquiry expiry/lineage؛ purpose authorization؛ customer projection/confirmation hook؛ financial realization و dispatch gates؛ correction closure؛ operational deletion و shared recovery.

نتیجه‌های قبلی درج‌شده در ADR-0113 مشاهده شدند اما تست تازه محسوب نمی‌شوند. گسترش زیر، migrationهای مرتبط با creation، compatibility routes و output را تکمیل و تست pure فعلی را ثبت می‌کند. فرمول تمام familyهای سنگ/اسلب/پله/حکمی/ابزار/برش/children در گزارش تخصصی گراف پوشش دارد. UI و runtime evidence به گزارش جداگانه تعلق دارد. source comparison با اثبات runtime یکسان نیست.

## ۱۶. بررسی تکمیلی migration و constraintهای ایجاد

تعریف Prisma تمام invariantها را نشان نمی‌دهد؛ migrationهای SQL زیر و overrideهای بعدی خوانده شدند:

| migration در `backend/prisma/migrations/` | invariant و تقدم فعلی |
|---|---|
| `20260827120300_partner_pair_commit_constraints/migration.sql:1-148` | FKهای deferred، exact-pair constraint triggers بر سه مالک، reserved numbers، immutable customer/internal identity، منع independent graph، append-only/no-truncate evidence |
| `20260827120400_partner_payments_outputs_and_corrections/migration.sql:265-441` | payment plan/receipt allocation revision owner، events، snapshot، correction و immutable history؛ نسخه‌های بعد lifetime/purpose را تکمیل می‌کنند |
| `20260830160000_partner_integration_hardening/migration.sql:1-78` | artifact composite snapshot/case/revision FK، output/byte SHA256 shape، non-empty bytes، immutable artifacts، revision/row/internal exact fulfillment lineage |
| `20260920134000_partner_deferred_pair_guards/migration.sql:6-98` | Case immutable identity + pair link once و اجازه Case بدون زوج؛ head/hash/current seller/customer/commercialAccount تطبیق می‌شوند |
| `20261003140000_partner_commercial_approvals/migration.sql:4-127` | آخرین `partner_check_pair` و finalize projection؛ service-only rows/economics، canonical catalog rate witness، customer commercial flow=2، SIGNED نیازمند COMMITTED/current two approvals/READY_TO_FINALIZE؛ projection فقط یک‌بار attach می‌شود |
| `20261005000400_partner_reactivation_permission_table/migration.sql:6-56` | آخرین Case CAS: +1 state revision و head همان یا +1، committed evidence دست‌نخورده، terminal reopening فقط exact retained reactivation/cancellation event؛ previously VOIDED مجوز live owned correction با dueAt لازم دارد |
| `20261004121000_partner_commercial_edit_duty_guard/migration.sql:1-103` | آخرین persona guard: partner معمول نمی‌تواند internal authority داشته باشد؛ exceptionها فقط bound technical recovery، own active pricing-result duty و own approved commercial-edit duty هستند |
| `20260920139000_partner_case_single_pricing_package/migration.sql:3` → `20261004120000_partner_price_negotiation_rounds/migration.sql:3` | unique case/revision inquiry index قبلی در migration آخر DROP می‌شود تا negotiation تکراری ممکن باشد؛ predecessor row uniqueness و Case lock/command idempotency باقی می‌مانند |
| `20260927110000_partner_price_package_earliest_expiry/migration.sql:4-17` | package expiry حداکثر ۴۸ ساعت پس از ready و می‌تواند به‌علت قدیمی‌تر بودن یکی از row offerها کوتاه‌تر باشد؛ ready/expires nullness متقارن |
| `20261002000100_ordinary_commercial_contract_lifecycle/migration.sql:1-18` | افزودن revision/approval/method/firstFinancial fields عادی؛ persisted default=0 برای untouched legacy؛ settings expiryDays محدود به ۱..۳۶۵ |
| `20261006120000_partner_wholesale_mandatory/migration.sql:2` | JSON حکمی wholesale به approval اضافه می‌شود؛ NULL تفسیر تاریخی را حفظ می‌کند |

در creation، constraint trigger `partner_exact_pair` در commit اجرا می‌شود، پس ترتیب insert Case→revision→pair به‌تنهایی تضمین نیست: آخر transaction باید owner/hash/customer/account/number-count کاملاً سازگار باشد. `partner_case_link_once` اجازه null/null→both IDs را یک بار می‌دهد و relink یا one-null را رد می‌کند. `partner_reject_duplicate_graph` مستقل INSERT/UPDATE به contract_items، deliveries، payments و graph_states برای linked Partner را با SQLSTATE 23514 می‌بندد. این guard application permission نیست و برای UX خطای قابل‌فهم جای guard route را نمی‌گیرد.

در مقایسه با ordinary lifecycle migration، Partner invariantهای aggregate و historical evidence بسیار بیشتری در SQL دارد. ordinary primarily service transaction/lease/canonical validation دارد؛ مهاجرت lifecycle آن explicit cross-field CHECK مشابه Partner FINAL ندارد. صحت instance واقعی این triggerها باید با schema-installed integration بررسی شود؛ خواندن SQL به معنی اجراشدن migration در محیط نیست.

## ۱۷. همه خانواده‌های endpoint سازگاری مرتبط با ایجاد

| خانواده | fence فعلی | نتیجه بررسی |
|---|---|---|
| `/sales/contracts` POST | workspace EDIT/create feature، maintenance graph flag، ownership lease، persona SQL | partner active persona نمی‌تواند ordinary responsibility/session ساخته‌شده را نگه دارد؛ current Partner command مسیر مجاز خودش است |
| `/sales/contracts/:id` PUT | workspace/edit feature، lease، department access، financial correction؛ canonical graph persistence | Partner deny صریح در `contractService.updateContract` نیست؛ independent graph-state SQL INSERT/UPDATE جلوی snapshot عادی linked Case را می‌گیرد. route-level domain routing باید در acceptance پوشش داشته باشد |
| `/sales/contracts/:id/items` و item services | feature/workspace + department، mutateLegacyCommercialContract | versioned ordinary full-editor-only؛ Partner از ordinary predicate عبور می‌کند ولی SQL duplicate graph reject می‌کند |
| `/sales/contracts/:id/deliveries` و delivery services | feature/workspace + department، mutateLegacyCommercialContract | ordinary full-editor-only؛ Partner independent insert/update توسط SQL بسته است؛ get collection عادی معادل Case delivery نیست |
| `/sales/contracts/:id/payments` و payment services | feature/workspace + department، mutateLegacyCommercialContract | ordinary full-editor-only؛ Partner independent insert/update توسط SQL بسته است؛ private Partner plans در Case owner قرار دارند |
| `/sales/contracts/:id/approve` | feature + `approveContract` department guard برای ordinary | partner reject صریح ندارد؛ generic legacy branch برای Partner DRAFT/PENDING می‌تواند status APPROVED بدون current salesApprovalRevision بنویسد، اگر SQL new-flow branch آن را منع نکند؛ Case-root authority اجرا نمی‌شود. اثبات رفتار HTTP با actor داخلی لازم است |
| `/sales/contracts/:id/sign` | feature، department، ordinary new-flow deny، current status APPROVED، quantity guard | Partner explicit deny ندارد؛ quantity guard COMMITTED/current binding لازم دارد و deferred SIGNED guard approvals/pricing را کنترل می‌کند؛ این مسیر intended Partner seller-sign حذف‌شده نیست |
| `/sales/contracts/:id/print` | feature، department، inactive و concurrency check | current Partner route-specific deny ندارد؛ اثر خطرناک آن در بخش ۱۸ با trace توضیح داده شده است |
| `/sales/contracts/:id/pdf` GET | workspace/view، partner visibility، original Partner customer projection branch | typed retail original route دارد؛ print mutation generic با این GET یکی نیست |
| `/contracts` legacy POST/PUT/approve/reject/sign/print/delete | `SALES_LEGACY_*` permissions، ADMIN بعضی actions؛ جداول Contract قدیمی | legacy Contract با SalesContract Partner pair یک aggregate نیست و IDs دوتا را نباید به‌جای هم گرفت |
| `/public/contracts/confirm/*` | token/manual lookup validation و confirmation hook routing | Partner hook پیش از ordinary fallback، snapshot-bound؛ public هیچ private Case action ندارد |
| `/partner/cases/commands` و `/technical/recoveries/*` | strict command/schema، owned profile/purpose، server actor، lease/hash/revision/idempotency | مسیر مجاز graph و linked aggregate |

route mountها در `backend/src/index.ts:174-186` بررسی شدند؛ auth middleware token/user authentication می‌کند و global Partner-specific redirect/fence برای generic `/api/sales` ندارد. feature/workspace internal privileged actor همچنان باید separately از Case domain authority پیروی کند.

## ۱۸. یافته‌های مشخص حاصل از گسترش؛ منشأ در کد، اجرای واقعی لازم

### A. generic print می‌تواند lifecycle و تحقق مالی همکار را به مسیر قدیمی ببرد

Trace کامل `backend/src/routes/sales.ts:1551-1621`: feature PRINT، lookup، isInactive، department، printable reload، PDF generation؛ سپس transaction contract lock + concurrent-version check؛ هیچ Partner deny یا Case authority پیش از update نیست. در `:1603` شرط `!isOrdinaryCommercialFlow && status==='SIGNED'` شامل Partner flow=2 می‌شود و status را PRINTED می‌کند. سپس `:1619` `snapshotRealizedSale` را صدا می‌زند.

`backend/src/services/salesAttributionService.ts:36-46` فقط ordinary flow را از trigger COMMERCIAL کنار می‌گذارد؛ Partner اگر realizedAt نداشته باشد، مقدار `SalesContract.totalAmount` (retail) را به realizedAmount می‌برد. این با «اولین مالی» و مبلغ wholesale سبلان اختلاف مستقیم دارد. `generateSalesContractPdf` در `backend/src/utils/salesContractPdf.ts:195-299` Partner deny ندارد؛ renderer `printTemplate.ts:2678` نیز gate authorization نیست. latest SQL `partner_check_pair` فقط وضعیت SIGNED را مشروط به approvals می‌کند و PRINTED را برای new-flow branch رد نمی‌کند (`20261003140000:85-95`).

اثر محتمل: چاپ generic توسط internal privileged actor می‌تواند قبل از first financial record فروش retail را realize کند و status PRINTED بگذارد، درحالی‌که `assertPartnerFinancialFinality` و Partner dispatch فقط SIGNED را قبول می‌کنند. source path مشخص است؛ HTTP reproduction/transaction rollback لازم است تا تمام اثرهای دیتابیس و gate actual معلوم شوند. این مسیرِ قابل‌بررسی باید پیش از هر یکپارچه‌سازی اصلاح شود.

### B. ordinary service schedule در payload و متن قرارداد از دست می‌رود

`frontend/src/features/contract-creation/hooks/useContractSubmission.ts:326-341` `rowType==='service'` را حذف می‌کند و service-only قرارداد deliveries=[] می‌شود. `:355-356` همان filtered deliveries را به HTML می‌دهد؛ `:372` پس از spread wizardData، deliveries را با filtered value جایگزین می‌کند؛ `:398-405` relations نیز filtered است. backend `contractService.ts:931` فقط همان submitted delivery/products را می‌نویسد؛ مسیر جداگانه persistence خدمات در ordinary یافت نشد. پس حفظ schedule در raw wizardData هم نجات‌دهنده نیست چون override شده است.

همکار `partnerSales/cases/revisions.ts:126-143` exact serviceRowId/quantity و توزیع کامل را بررسی می‌کند؛ customer projection schedule را حفظ و print renderer service execution را می‌آورد (`printTemplate.ts:2629-2636`). تنها fulfillment projection عمداً serviceItems را حذف می‌کند (`projections.ts:52`). حذف service از physical FK عادی می‌تواند درست باشد، اما حذف از customer snapshot/HTML یک اختلاف واقعی و خلاف ADR-0111 است. بازکردن ذخیره/خروجی service-only و mixed در runtime، اندازه دامنه آسیب را اثبات می‌کند.

### C. race انتشار PDF final جدید پس از rendering

`routes/partner-cases.ts:1007-1055` داخل transaction اول Case lock، authorization، expected snapshot و FINAL state را بررسی می‌کند. rendering بیرون transaction است. transaction دوم `:1071-1082` artifact upsert می‌کند و اگر prepared commercialFlowVersion=1 باشد فوری content برمی‌گرداند؛ در این branch Case/head lock و current authorization/state/hash مجدد وجود ندارد. مسیر legacy پایین‌تر lifecycle command revalidation دارد، مسیر جدید ندارد.

اگر بین prepare و publish contract commercial edit/cancel یا authority change رخ دهد، source نشان می‌دهد current final-publication guard برای flow جدید اجرا نمی‌شود. immutable snapshot/bytehash حفاظت تاریخی می‌دهد اما current authority را اثبات نمی‌کند. ادعای exploit/repro قطعی مطرح نیست؛ سناریوی race با pause renderer و revoke/edit باید آزموده شود.

### D. دلیل رد مشتری در endpoint عمومی پشتیبانی نشده است

ADR-0113 رد مشتری با دلیل را بیان می‌کند. `routes/public-contracts.ts:182-195` فقط token و meta را می‌فرستد؛ `customerOutput/prismaHooks.ts:321-357` reason از کاربر ندارد و audit تنها snapshot/rejectedAt دارد؛ `rejectPartnerCustomer` نیز reason argument ندارد. ثبت خودِ رد برقرار است، ولی دلیلِ مشتری در این مسیر قابل ثبت نیست. ordinary fallback rejection نیز فعال نیست. این شکاف مشخصات/پیاده‌سازی، مستقل از رد قیمت wholesale با reason است.

## ۱۹. نتیجه تست‌های pure تازه

با موافقت هماهنگ‌کننده، بدون Docker action، دیتابیس جدید یا restart، فرمان زیر روی tsx موجود اجرا شد:

```text
node backend/node_modules/tsx/dist/cli.mjs --test backend/src/services/__tests__/partnerContractVisibility.test.ts backend/src/services/__tests__/partnerAuthorization.test.ts backend/src/services/__tests__/partnerAuthorizationV2.test.ts backend/src/services/__tests__/partnerContractCustomerWorkflow.test.ts backend/src/services/__tests__/contractLifecyclePolicy.test.ts
```

نتیجه **۲۱ موفق / ۱ ناموفق از ۲۲**، صفر skipped. شکست در `partnerAuthorizationV2.test.ts:45` deep-equal متن قدیمی FORBIDDEN است؛ code=FORBIDDEN، status=403 و enabled=false بدون تغییر باقی مانده‌اند، متن actual راهنمای فارسی اضافه دارد. شکست مجوز بازتر یا دسترسی موفق نشان نداد. تست‌ها source policy/schema/fixture scope را پوشش می‌دهند؛ SQL triggers و real-role HTTP lifecycle را اثبات نمی‌کنند. فایل محصول یا تست برای سبزکردن نتیجه تغییر نکرد.

## ۲۰. inventory و مجموعه محدود سناریوهای runtime باقی‌مانده

مسیرهای منبع مستقیماً خوانده/جستجو شدند: `backend/src/index.ts`؛ `middleware/auth.ts,workspace.ts,feature.ts`؛ `routes/sales.ts,contracts.ts,partner-cases.ts,partner-technical.ts,public-contracts.ts`؛ `services/contractService.ts,contractEditSessionService.ts,ordinaryContractLifecycle.ts,ordinaryContractDispatchEligibility.ts,contractQuantityEvidenceGuard.ts,contractLifecycleService.ts,salesAttributionService.ts,deliveryService.ts,paymentService.ts,contractItemService.ts,contractConfirmationService.ts`؛ `services/partnerSales/cases/aggregate.ts,linkedPair.ts,projections.ts,revisions.ts,commercialLifecycle.ts,technicalSave.ts,canonicalWholesale.ts,partnerDraftRetention.ts,operationalDeletion.ts`؛ `partnerSales/authorization/service.ts,centralAuthority.ts`؛ `partnerSales/inquiries/service.ts,wholesalePricing.ts`؛ `partnerSales/customerOutput/customerVisible.ts,casePdf.ts,prismaHooks.ts,README.md`؛ `partnerSales/accounting/commercialRealization.ts,README.md`؛ `partnerSales/fulfillment/commercialSettlement.ts`؛ `utils/salesContractPdf.ts,printTemplate.ts`؛ `backend/prisma/schema.prisma`؛ migrationهای جدول بخش ۱۶؛ frontend submission مورد بخش ۱۸؛ پنج pure test و domain docs/ADRs ارجاع‌شده.

سناریوهای runtime تکمیلی مشخص و محدودند:

1. create ordinary interruption-after-commit/lease-release retry و uniqueness؛ rollback failure در graph/item/delivery/payment.
2. Partner submit products pending inquiry، service-only، preparation complete، exact-pair SQL و rollback failpoints.
3. دو actor هم‌زمان lease، revision conflict، idempotency replay و changed payload؛ repeated rejected-offer successor.
4. هر ترتیب فروش/مشتری/قیمت، pending/partial/rejected/correction/expired inquiry، current vs previous revision و paper acceptance.
5. generic internal approve/sign/print/update/CRUD به owned Partner ID؛ مخصوصاً A و retail reporting/financial gate آن.
6. ordinary mixed و service-only schedule ذخیره/بازگشایی/HTML/PDF؛ Partner serviceItems با physical exclusion.
7. OUTPUT FINAL renderer race با edit/cancel/permission change، byte corruption، historical download، no wholesale output.
8. expiry before/after first financial، edit بدون renewal، reasoned renewal، independent 48h quote؛ Tehran correction period.
9. pre/post-financial multi-save/unchanged-return، re-finality، cancellation و reactivation fresh approvals/prices؛ reserved/dispatched floors.
10. internal financial draft→issued→approved→receivable→receipt/check clearing، last-record void reversal، wholesale debt/customer privacy و loss-settlement blocking subsequent exit.

این سناریوها حذف از دامنه نیستند؛ مرز میان مقایسه source کاملِ مسیرهای شناسایی‌شده و acceptance runtime تازه‌اند. همچنین صحت migration نصب‌شده و محتوای دیتابیس واقعی صرفاً از SQL فایل استنتاج نشده است.
