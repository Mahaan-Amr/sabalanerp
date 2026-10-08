# مقایسه قواعد مستند و ماتریس سناریو ایجاد قرارداد

تاریخ بررسی: ۲۰۲۶-۱۰-۰۷. بررسی فقط‌خواندنی اسناد، Issueها و منابع تست؛ این فایل گزارش تحلیل است و تغییر رفتار محصول نیست. نتایج قدیمی QA با اجرای امروز یکی نیستند. آزمون زنده این بخش اجرا نشد؛ والد گزارش داد Docker daemon و localhost:3000 در دسترس نیستند.

## تقدم منابع و تصمیم‌های ناسازگار تاریخی

1. ADR-0099 خط 7 رابط مشترک ورود، recovery، ایجاد/انتخاب مشتری و پروژه را مقرر می‌کند؛ مالکیت خصوصی Partner و مرز قیمت/شماره/تعهد مستقل می‌مانند.
2. ADR-0110 خطوط 7–15 مدل جاری ordinary را مقرر می‌کند: یادداشت، تأیید فروش، پذیرش مشتری برای همان نسخه، قطعیت خودکار، اولین رکورد مالی به‌عنوان تحقق فروش، مهلت اختصاصی قرارداد و ویرایش چندباره مجاز حسابداری. ADR-0111 به‌ویژه خط 11 شرط ارسال ordinary را تغییر می‌دهد: تأیید مالی با تطبیق سپیدار یا مجوز مدیریتی/پوشش اعتبار فروشنده؛ صرف ایجاد رکورد مالی کافی نیست.
3. ADR-0113 خطوط 9–32 قواعد Partner را با دو حقیقت مالی حفظ می‌کند: تعهد خرید فقط با تأیید فروش + پذیرش مشتری + همه قیمت‌های معتبر پذیرفته‌شده؛ ارسال مشتری مستقل از پاسخ استعلام؛ مهلت از پذیرش آخرین استعلام و تکمیل آماده‌سازی شروع می‌شود؛ ارسال فیزیکی به وصول واقعی همکار به سبلان وابسته است.
4. ADR-0113 خط 53 حذف امضای فروشنده را صریحاً جایگزین اصلاحات خطوط 45 و 49 کرده است. گزارش session-visual-qa-2026-10-03.md خط 139 همین حذف نهایی را ثبت می‌کند. وجود عنوان تاریخی PARTNER_SELLER_SIGNED در PartnerCaseDetail.tsx:49 دلیل وجود فرمان فعال امضا نیست.
5. ADR-0113 خط 115 (۵ اکتبر) اختیار مستقیم Accounting Processor برای بازکردن اصلاح را supersede کرده و مسیر ordinary با تأیید جداگانه مدیر حسابداری را لازم کرده است. خطوط 119–127 فعال‌سازی پس از لغو را به تأییدهای تازه و **استعلام تازه برای همه اقلام** وابسته می‌کنند. خط 132 بازگشت بدون تغییر را از ویرایش واقعی جدا می‌کند: بازگشت بدون تغییر قطعیت و تعهد را حفظ می‌کند.
6. ADR-0113 خطوط 209–217 چرخه حذف/غیرفعال‌سازی و حفظ audit را ثبت می‌کنند. حذف عملیاتی، حذف سوابق مالی/فیزیکی نیست.

Issueهای خوانده‌شده با `gh issue view ... --json ...` شامل body، labels و تمام comments برگشتی بودند؛ هیچ پیام/ویرایش خارجی انجام نشد:

| Issue | معنای مستند | نسبت با امروز |
|---|---|---|
| [#375](https://github.com/Mahaan-Amr/sabalanerp/issues/375) | ۶۰ user story درباره اشتراک wizard، محصولات، استعلام، تحویل، پرداخت، recovery، محرمانگی و UI | CLOSED؛ سکوت مشتری مانع نبود، approval کاتالوگی قابل استفاده مجدد بود، اولین ذخیره سه شماره می‌ساخت؛ این بخش‌ها با ADRهای بعدی جایگزین شده‌اند |
| [#381](https://github.com/Mahaan-Amr/sabalanerp/issues/381) | استعلام Case-scoped، واحد متفاوت خانواده‌ها، عدم پذیرش cubic، finalization قبل از ارسال مشتری، داشبورد دوحقیقتی | OPEN و ready-for-agent اما بر ADR-0062 قدیمی تکیه دارد؛ مرز customer-before-finality با ADR-0113 ناسازگار است؛ وضعیت OPEN به‌تنهایی spec فعلی نیست |
| [#391](https://github.com/Mahaan-Amr/sabalanerp/issues/391) | ویرایش اولین‌کلیک محصول ردشده، حفظ داده روی خطا، re-inquiry صریح همان ردیف، شماره و فهرست ترکیبی حسابداری | OPEN؛ بخش CTA مسدود قبل از تحویل و عدم نمایش pre-commit در حسابداری باید با قواعد بعدی بازسنجی شود. comment مالک ۲۶ سپتامبر تأیید مالی در detail کامل را لازم می‌کند؛ تأیید مستقیم از list ممنوع |

## تفاوت‌های عمدی قواعد

| محور | فروش عادی | فروش همکار | مرجع |
|---|---|---|---|
| مالک مشتری | مشتری مستقیم سبلان با دسترسی CRM | مشتری خصوصی همان همکار؛ انتقال مالکیت فرایند مستقل ممیزی‌شده | ADR-0099:7 |
| فروشنده مسئول | از creator یا پروژه بالقوه؛ reassignment مجاز با دلیل | همکار مالک ثابت؛ پاسخ‌دهنده قیمت فروشنده مسئول نیست | ADR-0011:17؛ ADR-0046:29 |
| پروژه | رفتار ordinary باید از controller خوانده شود | پروژه مشتری canonical؛ برای submit الزامی | ADR-0059:7؛ ADR-0099:7 |
| محصولات | گراف canonical، هندسه و عملیات و باقی‌مانده | همان گراف با wholesale/retail جدا و نرخ استعلام؛ cubic خارج دامنه | ADR-0062:15–25؛ #381 |
| قطعیت | تأیید فروش و پذیرش مشتری همان نسخه | همان دو تأیید، به‌علاوه قیمت لازم معتبر و پذیرفته‌شده | ADR-0110:7؛ ADR-0113:11–23 |
| امضای فروشنده | شرط مستقل ندارد | فرمان مستقل حذف شده؛ سابقه قبلی محفوظ | ADR-0113:53 |
| ارسال مشتری | جریان تأیید ordinary | قبل از پاسخ یا پذیرش wholesale ممکن؛ فقط retail | ADR-0113:15 |
| مهلت اولین ثبت مالی | ایجاد سیستمی یا adoption؛ تاریخ تجاری مبنا نیست | آخرین پذیرش لازم استعلام + تکمیل آماده‌سازی؛ پاسخ دیرهنگام سبلان مهلت را نمی‌سوزاند | ADR-0110:15؛ ADR-0113:13 |
| وصول/ارسال فیزیکی | entitlement مالی/مدیریتی/اعتبار فروشنده طبق ADR-0111 | وصول واقعی پاک‌شده همکار به سبلان؛ وصول مشتری نهایی مستقل و خصوصی | ADR-0111:7–11؛ ADR-0113:14,32 |
| برنامه پرداخت | می‌تواند اعتبار فروشنده/مشتری خاص مجاز داشته باشد | پرداخت مشتری مستقل از برنامه همکار به سبلان؛ مانده مشتری مستقیم قابل مصرف نیست | ADR-0059:9؛ partnerPaymentValidation.test.ts:15 |
| تحقق فروش | اولین رکورد مالی ذخیره‌شده یک‌بار | همان رویداد، به مبلغ سبلان به همکار؛ قیمت retail در گزارش سبلان نیست | ADR-0110:13؛ ADR-0113:28 |
| اصلاح | پس از اولین رکورد مالی مجوز؛ چند save در دوره سه روز کاری تهران | همان مسیر approval مدیر؛ مجوز مشترک ویرایش و لغو؛ بدون تغییر approval حفظ می‌شود | ADR-0110:9؛ ADR-0113:115,132 |
| لغو/فعال‌سازی | قواعد عمومی financial/physical dependency | لغو تعهد با adjustment تاریخی؛ فعال‌سازی همه استعلام‌ها و دو تأیید را تازه می‌خواهد | ADR-0113:72–75,119–127 |

## ماتریس پذیرش جامع برای هر دو مسیر

وضعیت تمام ردیف‌های زیر «سناریوی لازم» است؛ وجود تست نام‌برده به معنی پاس امروز نیست. هر سناریو باید UI → payload → persisted rows → reload → output/accounting/logistics را با یک مجموعه facts تطبیق دهد.

| گروه | سناریوهای لازم | شاهد/تابع مناسب |
|---|---|---|
| ورود و recovery | wizard دست‌نخورده draft ندارد؛ اولین تغییر معنادار؛ ذخیره آخرین تغییر؛ reload؛ discard؛ lease فعال/منقضی؛ takeover؛ رقابت sequence؛ پایان موفق پاک‌سازی | ADR-0043:3؛ frontend services/__tests__/contractCreationDraftPolicy.test.ts، contractRecoveryJournal.test.ts، contractEditorIdentity.test.ts |
| تاریخ و هویت | تقویم تهران، ارقام فارسی/عربی، تاریخ قراردادی جدا از سیستم، maker/responsible seller صحیح، allocation شماره idempotent | ADR-0110:15؛ partnerCustomerCreation.test.ts:40 |
| مشتری | Individual/Company/Government؛ مشتری موجود/جدید؛ blacklist/lock؛ duplicate همان مالک و مالک خارجی؛ انتقال pending/cancel؛ نتیجه create مشتری+اولین پروژه atomic؛ owner leakage | ADR-0099:7؛ partnerCustomerCreation.test.ts:6,20,33,50 |
| پروژه | انتخاب پروژه همان مشتری؛ تغییر مشتری clears project؛ پروژه نامعتبر/حذف‌شده؛ إنشاء پروژه اول/اضافی؛ پروژه بالقوه با Customer Project اشتباه نشود | ADR-0099:7 |
| کاتالوگ | خانواده‌ها؛ inactive/missing catalog؛ فقدان add-on تاریخی؛ Partner بدون اختیار ساخت catalog؛ loading error و absent واقعی جدا | partnerCatalogAvailability.test.tsx:22؛ ADR-0001:3 |
| هندسه محصول | طولی، slab مادر مصرف‌شده، پله tread/riser/landing، prepared واحد کاتالوگ؛ precision؛ integral در برابر split؛ quantity مقابل area؛ mandatory با برش فیزیکی ولی هزینه صفر | .agents/skills/audit-contract-product-graph/REFERENCE.md:7–16 |
| گراف وابسته | دو parent هم‌کاتالوگ؛ duplicate/delete/reorder؛ child مستقل ابزار/پرداخت؛ parent edit همه fit؛ child دوم conflict؛ child اول conflict؛ ترتیب replay متفاوت؛ atomic rollback | remainingStoneAllocationReplayService.ts:276؛ REFERENCE.md:18–30 |
| ابزار و پرداخت سطح | meter/sqm/عدد؛ مقدار جزئی قابل ویرایش؛ parent add-on بدون inheritance ضمنی؛ قیمت عملیات پس از تغییر quantity/geometry؛ rows قدیمی missing catalog | ADR-0002:7؛ REFERENCE.md:34–46 |
| دو قیمت | wholesale rate فقط main material؛ cutting/tools/finishing ثابت canonical؛ remainder پول‌داده‌شده دوباره charge نشود؛ retail کمتر از buy و loss؛ zero/decimal/large totals؛ تومان/ریال | partnerCanonicalRowAmounts.test.ts:15,30؛ ADR-0059:7 |
| استعلام Partner | هیچ/partial/ready/accepted/rejected/correction/expired؛ validity دقیق ۴۸ساعت؛ آخرین package؛ سبب رد در همان duty؛ repeated rejection؛ reassign مجاز؛ حفظ قیمت unaffected؛ superseded WAIVED | ADR-0113:18,59,96–104؛ partnerRequoteIdentity.test.ts:7 |
| تغییرات و invalidation | ابعاد/عملیات/subject/quantity/retail/date/customer/project/تحویل/payment جدا؛ قیمت وابسته descendants؛ checkpoint در برابر commercial change؛ version links invalidation | ADR-0113:22,53,61,132 |
| تحویل | گراف بدون deliverable مرحله ندارد؛ تخصیص دقیق count/ton/area و rowId؛ گیرنده/مدیر/نشانی؛ under/over allocation؛ child حذف/تغییر؛ plan ناسازگار حفظ و نیازمند اصلاح | ADR-0113:61؛ frontend services/__tests__/deliveryProductIdentity.test.ts |
| پرداخت | cash/check/transfer/installments؛ total exact؛ due dates و ID شرطی؛ تعهد امروز در برابر آینده؛ historical payment unchanged معتبر ولی duplicate جدید نیازمند کنترل؛ discount customer هیچ wholesale تغییر نمی‌دهد | partnerPaymentValidation.test.ts:5–60؛ partnerPaymentEntryAdapter.test.ts:5,25 |
| تأیید تجاری | هر دو ordering؛ current revision؛ no approval/فروش-only/مشتری-only/both؛ استعلام pending/ready/accepted در همه حالت‌ها؛ قطعی خودکار آخرین gate؛ همزمان approval/acceptance | backend cases/commercialLifecycle.ts:51,103,118,164,193 |
| مشتری عمومی | SMS failure و retry/cooldown؛ OTP نادرست/منقضی؛ replay؛ رد دلیل‌دار؛ لینک نسخه قبلی؛ cancel/expire/deactivate/delete؛ عدم افشای wholesale/margin/internal numbers از HTML/JSON/PDF/SMS | ADR-0113:15,23؛ partnerCaseLifecycle.integration.test.ts:1649 |
| وضعیت و فیلتر | priority cancelled/expired/final/inquired/customer-accepted/sales-approved/note؛ READY offered در برابر accepted؛ UI filters قبل pagination؛ label فارسی و تم | ADR-0113:49,53؛ readPartnerCommercialState:164 |
| حسابداری | view/print پیش از قطعی؛ ایجاد record/receivable/receipt قبل قطعی ممنوع؛ paper acceptance جدا از phone verification؛ اختلاف finance amount؛ تنها internal projection Partner | ADR-0113:27,127؛ assertPartnerFinancialFinality:193 |
| تحقق و expiry | اولین persisted financial draft یک‌بار؛ failed save صفر؛ removal آخرین valid record reversal؛ restore بدون double count؛ expiry origin درست؛ renewal دلیل؛ settings تغییر گذشته را تمدید نکند | ADR-0110:13–15؛ ADR-0113:28–30 |
| ویرایش | no financial repeat saves؛ financial manager authorization؛ سه روز کاری؛ انقضای authorization با lease هنوز فعال؛ unchanged return هیچ revision/debt reset نکند | ADR-0113:115,132,148–152 |
| لغو و بازگشت | open loading مانع؛ physical exit مانع full cancellation؛ no auto refund؛ dated adjustment؛ fresh manager permission؛ همه inquiry تازه؛ repeated cycles؛ historical record void با احیای case احیا نشود | ADR-0113:72–75,119–127 |
| حذف و غیرفعال‌سازی | no financial/conclusive physical dependencies برای حذف؛ actor permissions؛ retained audit/revisions؛ explicit inactive view؛ عملیات تازه ممنوع، بدهی موجود قابل پیگیری | ADR-0113:209–217 |
| UI واقعی | desktop/mobile 390px؛ light/dark؛ keyboard/tab/focus؛ 200% zoom؛ dialogs/stepper/recovery؛ narrow long labels؛ no horizontal overflow؛ empty/loading/error/permission states | #375 stories 58–60؛ docs/design-system/catalog.md |

## تست‌های ناسازگار و حدود شواهد

- backend/src/services/__tests__/partnerCaseLifecycle.integration.test.ts:369 عنوان «finalize without customer response» دارد؛ commit helper در خط358 triggerهای SIGNED/PRINTED می‌پذیرد و خطوط536–540 وضعیت PRINTED و commitmentTrigger SIGNED را assert می‌کنند. این suite شامل مسیرهای قدیمی و جدید با هم است؛ باید commercialFlowVersion fixture هر تست بررسی شود. بدون تشخیص cohort، تغییر assertion یا پاس نام suite به‌عنوان اثبات ADR-0113 خط11 نادرست است.
- همان suite خطوط1707 به بعد financial void مستقل را با حفظ commercial commitment می‌سنجد و خط1779 lifecycle حسابداری را اضافه کرده است؛ وجود این تست‌های جدید suite قدیمی را خودبه‌خود به معیار کامل new flow تبدیل نمی‌کند.
- ADR-0113:168 صریحاً گفته همه خانواده‌های فنی و همه device combinations browser-tested نشده‌اند. خط217 دانلود browser PDF را تأییدنشده اعلام می‌کند؛ ساخت PDF موفق جای download acceptance نیست.
- گزارش broad acceptance گذشته (ADR-0113:197–201) وابسته به source/runtime همان زمان است؛ worktree امروز و runtime باید مجدداً تطبیق داده شوند.
- برای مقایسه، مهم‌ترین شکاف coverage یک سناریوی **واحد fresh cross-adapter** است: دقیقاً یک intent canonical، دو adapter، یک geometry و عملیات، retail مورد انتظار ordinary، wholesale rate replacement Partner، DTO/persistence/output برابر به‌جز تفاوت‌های عمدی. suiteهای جدا دلیل بر parity نیستند.

## ابزارهای مناسب و محدودیت اجرای تازه

- Pure scenario harness با imports جاری frontend services/pricingService.ts و remainingStoneAllocationReplayService.ts:276 و packages/contract-product-graph؛ parent/child graph کامل قبل و بعد capture شود. contractCreationComplexScenarios.test.ts الگوی ورودی است، نه منبع truth.
- برای parity monetary: `npm --prefix backend run test:contract-monetary-reconciliation` و frontend `test:contract-creation` و root `test:contract-product-graph`؛ قبل اجرا script dependency و DB side effects بررسی شوند. هیچ نتیجه‌ای در این گزارش پاس اعلام نشده است.
- root scripts/run-partner-sales-tests.mjs:76–165 برای browser/all تصاویر را build می‌کند، دیتابیس QA ایجاد می‌کند و backend سرویس اصلی را force-recreate کرده و سپس برمی‌گرداند. این دستور برای ممیزی بدون توقف مناسب نیست. مسیر مرورگر مستقیم روی خدمات موجود پس از preflight و با fixture محدود یا کنترل‌شده انتخاب شود؛ stack جدید ممنوع.
- tests/partner-sales/harness/safety.mjs:51–96 وضعیت sabalanerp-local، پورت‌های loopback، سلامت سرویس‌ها و sandbox بدون credential SMS را validate می‌کند. localSql در خط121 قبل هر SQL preflight دارد؛ fixture cleanup در tests/partner-sales/harness/fixtures.mjs namespace-owned است.
- اعتبارنامه synthetic مرورگر در tests/partner-sales/browser/live-runtime.spec.ts و fixtureهای مربوط تعریف شده؛ مقادیر در این گزارش بازنشر نمی‌شوند. backend/src/scripts/provision-partner-local-qa.ts مشتری/پروفایل/مجوز provision می‌کند و mutation است؛ صرف یافتن این script اجازه اجرای بی‌نیاز آن را ثابت نمی‌کند. به جای دستکاری کاربر واقعی، fixture موجود namespace-owned و password/token بدون چاپ در logs مصرف شود.
- با daemon unavailable، آزمون DB، UI واقعی، مسیر دانلود، currency reconciliation داده واقعی، و permissions live **تأییدنشده** می‌مانند. بررسی source و تست pure ادامه‌پذیر است و نباید این محدودیت به گزارش «همه‌چیز کامل آزمایش شده» تبدیل شود.
