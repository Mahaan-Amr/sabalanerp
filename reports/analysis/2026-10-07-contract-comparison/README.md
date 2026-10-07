# مقایسهٔ ایجاد قرارداد فروش عادی و فروش همکار

تاریخ: ۱۵ مهر ۱۴۰۵ / ۲۰۲۶-۱۰-۰۷. checkout: `3f72c3b64893df14d9d9061f0572526e04c1cb06`.

این بررسی برای تصمیم‌گیری پیش از تغییر جریان انجام شده است. هیچ کد محصول، مجوز، رکورد تجاری، migration یا سرویس اجرایی تغییر نکرد؛ سرویس‌ها متوقف یا بازسازی نشدند. فایل‌های ثبت‌نشدهٔ قبلی حفظ شدند. گزارش‌ها، اسکریپت تصویربرداری و تصاویر این پوشه خروجی همین بررسی‌اند.

## نتیجه اصلی

اشتراک اجزای ظاهری و موتور محاسبه، به معنای یکسان‌بودن جریان نیست. فروش عادی یک قرارداد سبلان با مشتری است؛ فروش همکار یک Case با فروش مستقل همکار به مشتری و خرید مستقل همکار از سبلان است. مسیر عادی ۷ مرحله دارد؛ همکار ۸ مرحله، با استعلام قیمت میان محصول و تحویل. کنترل‌کننده‌ها، draftها، payloadها، مرزهای ثبت و مجوزهای آن‌ها متفاوت‌اند. مسیر «قرارداد همکاری در فروش» (`collaboration/create`) فروش همکار نیست.

یکسان‌سازی آینده باید قابلیت‌ها و رفتارهای مشترک را بهبود دهد و دو رابطه تجاری، مالکیت مشتری، محرمانگی خرید، تاریخچه نسخه‌ها و شرط استعلام معتبر را حفظ کند. خود فروش عادی نیز ایراد دارد و نباید بدون بررسی مرجع مطلق شود.

## نقشهٔ گزارش و شواهد

| بخش | سند |
|---|---|
| رابط، فیلدها، مراحل، ناوبری، بازیابی و کنترل‌کننده | [frontend-ui.md](frontend-ui.md) |
| API، داده، مجوز، lifecycle، حسابداری و خروجی | [backend-logic.md](backend-logic.md) |
| تمام خانواده‌های محصول، هندسه، برش، باقی‌مانده، ابزار، قیمت و تخفیف | [product-graph.md](product-graph.md) |
| بازتولید عددی و گراف با توابع جاری | [fresh-probe.json](fresh-probe.json) |
| مشاهدهٔ مرورگر، تم/عرض و disabled روزهای تقویم | [ui-observations.json](ui-observations.json) |
| اسکریپت قابل تکرار تصاویر | [capture-ui.mjs](capture-ui.mjs) |

گزارش‌های قبلی `reports/analysis/contract-creation-comparison` صرفاً شواهد قبلی‌اند؛ جملهٔ unavailable بودن Docker در آن‌ها وضعیت این اجرا نیست. این اجرا `sabalanerp-local` سالم را مشاهده کرد و فقط از همان محیط استفاده کرد. متن و نظرات GitHub Issues #375، #381 و #391 خوانده شدند؛ تصمیم‌های تازه ADR-0110، ADR-0111، ADR-0113 با تمام اصلاحیه‌ها و ADR-0116 بر بخش‌های قدیمیِ ناسازگار تقدم دارند.

## ماتریس سراسری مقایسه

«مشترک» در این جدول به معنای اشتراک قواعد یا اجزا در منبع است؛ به معنای اثبات اجرایی همه ترکیب‌های ممکن نیست. جزئیات مسیر و خط کد در سه زیرگزارش آمده است.

| محور | عادی | همکار | ارزیابی |
|---|---|---|---|
| ورود | ordinary component در route مشترک | runtime با creation context | مسیر مشترک، کنترل‌کننده متفاوت |
| مراحل | تاریخ، مشتری، پروژه، محصول، تحویل، پرداخت، تأیید | همان‌ها + استعلام | تفاوت عمدی |
| ایجادکننده/مالک | کاربر جاری و مسئول فروش | actor و profile مالک | مالکیت مستقل لازم |
| تاریخ | تقویم شمسی، گذشته disabled | تقویم شمسی با ذخیره Gregorian، گذشته selectable | تفاوت رفتار، مشاهده مرورگر |
| شماره پیش از ثبت | پیش‌نمایش احتمالی | اطلاع تخصیص بعدی؛ tracking Case مستقل | تفاوت معنای شماره |
| مشتری | scope فروش/CRM/مجوز | مشتری خصوصی همان profile | اشتراک UX، تفاوت scope عمدی |
| ساخت مشتری | فرم مشترک، قواعد انواع و duplicates | همان composition با فرمان owner-safe | ownership و انتقال پوشیده حفظ شود |
| پروژه | کارت کامل، آدرس و مدیر | projection محدود عمدتاً عنوان | شکاف اطلاعات/default |
| کاتالوگ | قیمت/اطلاعات محصول و مدیریت مجاز | safe technical snapshots، inquiry به جای ایجاد catalog | تفاوت مجوز عمدی |
| خانواده محصول | طولی، اسلب، پله، آماده/کیوبیک | همین چهار خانواده ورود جاری | پایه مشترک |
| واحدها/هندسه | عدد UI + canonical witnesses | decimal strings + refs نسخه‌دار | seam تبدیل حساس |
| مساحت/مصرف | مساحت تمام‌شده با مصرف ماده فرق دارد | همین معنا | مشترک، مبنای قیمت مصرف |
| برش/حکمی | physical و billable جدا | همان هندسه؛ حکمی خرید مستقل | ADR-0116 عمدی |
| ابزار/پرداخت سطح | collections و edge quantities | اجزای مشترک و نرخ trusted | مشترک با projection محدود |
| پله/لایه | سه part، system/quantity mode، stock | بخش‌های مشترک و شناسه‌های مستقل | parity پایه؛ state writer جدا |
| باقی‌مانده/فرزند | allocation replay پیش از commit | preview و server compiler | شکاف اعتبارسنجی محلی مهم |
| تکثیر | هویت تازه، حفظ منبع child اصلی | remap شناسه‌ها، child اصلی همان منبع | در آزمون‌های انتخابی برابر |
| حذف منبع | child مستقل مانع حذف | cascade وابسته‌ها | تفاوت با ریسک حذف کار |
| عنوان/شرح/تصویر | تصاویر ردیف و شرح child | تصاویر ندارد؛ child عنوان read-only | شکاف قابلیت |
| خدمات مستقل | قیمت و schedule در UI | قیمت و serviceItems schedule | حذف schedule در submission عادی |
| قیمت ماده | نرخ فروش canonical | retail مستقل و wholesale معتبر استعلام | تفاوت بنیادی عمدی |
| اعتبار قیمت خرید | ندارد | ۴۸ ساعت مستقل، successor و negotiation | ویژگی ضروری همکار |
| تخفیف | پایه ماده و سقف تنظیم‌شده | کل retail شامل خدمات، تا ۱۰۰٪ | تصمیم تجاری لازم |
| زیان | قیمت یک رابطه | هشدار retail کمتر از wholesale | تفاوت عمدی |
| تحویل | project defaults، تطبیق با tolerance | customer defaults، exact decimal | اختلاف پیش‌فرض و سخت‌گیری |
| تغییر ردیف/تحویل | row identity canonical | allocation قبلی حفظ و خطا آشکار | حفظ معنی تحویل ضروری |
| پرداخت | روش‌های عمومی + اعتبارات/مانده مجاز | برنامه خصوصی مشتری؛ بدون اعتبار فروشنده عادی | تفاوت اقتصادی عمدی |
| کدملی/چک | validation شرطی تاریخ/روش | validation شرطی و retained installment | مشابه، lifecycle retention متفاوت |
| دقت مبلغ | Number UI و witnesses | decimal domain، ولی adapter پرداخت Number | کاهش دقت بازتولید شد |
| فرم باز محصول | draft در recovery گسترده | modal.draft بیرون autosave میزبان | ریسک از دست رفتن تغییر ذخیره‌نشده |
| بازیابی/مالکیت | local journal + server، lease | runtime/entry/technical/wizard چندلایه | رفتار باید هماهنگ، مدل یکی نیست |
| ثبت | POST نهایی SalesContract | Case زودهنگام، technical save و تکمیل pair | مرزهای متفاوت |
| retry/رقابت | lease و unique-number retry | durable command/idempotency + revision/hash | رفتار failure باید جدا سنجیده شود |
| ارسال/پذیرش مشتری | نسخه جاری، SMS/OTP یا paper | همان زیرساخت، allowlist retail | wholesale در خروجی ممنوع |
| قطعی‌شدن | تأیید فروش + پذیرش همان نسخه | همان‌ها + قیمت‌های معتبر پذیرفته‌شده | تفاوت عمدی |
| مهلت اولین مالی | از ایجاد سیستمی/ورود گردش جدید | از تکمیل آمادگی و پذیرش آخرین قیمت | تفاوت عمدی |
| حسابداری | مشتری بدهکار | همکار بدهکار، رکورد داخلی مستقل | خلط retail/wholesale ممنوع |
| تحقق فروش | اولین ثبت مالی موفق | همان trigger، مبلغ خرید سبلان | چاپ/تأیید به‌تنهایی کافی نیست |
| اصلاح دارای مالی | مجوز و بررسی مجدد عادی | مجوز مشترک و حذف review دوم طبق مصوبه | تفاوت عمدی جاری |
| لغو/بازگشت/حذف | guards مالی/فیزیکی و audit | Case/قیمت/تعهد/زوج با retained history | اشتراک safeguards، aggregate جدا |
| ارسال فیزیکی | settlement یا مجوز/اعتبار مجاز عادی | تسویه واقعی همکار به سبلان | وصول مشتری خصوصی شرط سبلان نیست |
| چاپ/PDF/مسیر قدیمی | ordinary guards و legacy branch | customer projection و internal renderer | ریسک generic endpoint عبور از policy |
| RTL/تم/موبایل | design system مشترک | همان shell و presentation | مرحله تاریخ در ۴ حالت مشاهده شد |

## ایرادها و شکاف‌های اولویت‌دار

### ۱. ویرایش منبع با فرزند نامعتبر در همکار — بازتولید شد

کاهش تعداد منبع ۲→۱، یا افزایش عرض ۲۰→۴۰cm، خود ردیف اصلی را معتبر نگه می‌دارد ولی child باقی‌مانده با `selected-remainder-insufficient` یا `selected-remainder-missing` نامعتبر می‌شود. `preview.conflicts=[]` باقی می‌ماند؛ خطا در `dependents[].calculation` است. مودال فقط root/operations/global conflicts را می‌سنجد و draft نامعتبر را می‌پذیرد؛ ذخیرهٔ سرور بعداً fail closed می‌کند. این ایراد اعتبارسنجی محلی و زمان آشکارشدن خطاست؛ فساد قطعی داده ثبت‌شده اثبات نشده است. شاهد: PG-01 و fresh-probe.

### ۲. حذف منبع، فرزندان همکار را نیز حذف می‌کند — بازتولید شد

عادی حذف parent دارای child مستقل را متوقف می‌کند. همکار descendants را cascade حذف می‌کند و سؤال UI تنها «حذف این محصول؟» است. شمار و اثر حذف وابسته‌ها روشن نیست. شاهد: PG-02، adapter و editor. تصمیم مناسب باید از دست رفتن کار و تحویل‌های وابسته را پیشگیری کند.

### ۳. تخصیص اجرای خدمات مستقل در قرارداد عادی حذف می‌شود — مسیر منبع قطعی

در `useContractSubmission.ts:326–340` service rows از `contractDeliveries` حذف می‌شوند؛ در :372 همین فهرست روی `wizardData.deliveries` overwrite می‌شود؛ HTML و `_relations` هم نسخه فیلترشده را می‌گیرند. backend مسیر دیگری برای service schedule در این submission ندارد. همکار serviceItems را در snapshot/customer projection حفظ می‌کند و فقط fulfillment فیزیکی آن‌ها را حذف می‌کند. filtering فیزیکی مجاز، حذف schedule قراردادی یک شکاف جداست. بازتولید ذخیره→reload روی دیتابیس در این اجرا انجام نشده است.

### ۴. تغییرات باز مودال همکار از recovery میزبان بیرون است — شاهد کد

`modal.draft` فقط با Save به technicalDraft میزبان می‌رود؛ close آن را پاک می‌کند. autosave میزبان محتوای همین مودال را ندارد. عادی draftهای مودال/پله را capture و برای discard پله تأیید می‌گیرد. refresh/crash/storage-full همه به‌صورت زنده بازتولید نشده‌اند؛ نیازمند سناریوی هدفمند است.

### ۵. تبدیل مبلغ decimal به Number — بازتولید شد

`123456789.123456789` در رفت‌وبرگشت `partnerPaymentEntryAdapter` به `123456789.12345679` تبدیل شد. این تفاوت دقت عددی واقعی است؛ اثر مبلغ قابل پرداخت پس از قواعد rounding باید سنجیده شود و نباید معادل قطعی خسارت پولی همان مثال اعلام شود.

### ۶. مسیر چاپ عمومی و گردش جدید همکار — ریسک مهم منبع

`PUT /api/sales/contracts/:id/print` در `sales.ts:1551` Partner را صریحاً کنار نمی‌گذارد؛ branch «غیر ordinary» در :1603 شامل Partner است و SIGNED را PRINTED می‌کند. :1619 تابع legacy تحقق فروش را فراخوانی می‌کند، در حالی که جدید Partner تحقق مالی wholesale دارد. guardها، مبلغ retail و authorization فعلی این مسیر باید با fixture ایزوله اثبات شوند. هیچ قرارداد واقعی برای این بازتولید چاپ یا mutate نشد. نتیجه source risk است، نه رخداد اجرایی اثبات‌شده. زیرگزارش backend سایر compatibility routeها و DB fences را توضیح می‌دهد.

### ۷. شکاف‌های UX/قابلیت و تصمیم‌های باز

تاریخ گذشته selectable همکار در برابر disabled عادی با DOM تقویم تأیید شد. کارت پروژه و پیش‌فرض آدرس/مدیر/گیرنده متفاوت‌اند. تصویر ردیف همکار در strict schema پذیرفته نمی‌شود. child باقی‌مانده شرح/عنوان آزاد عادی را ندارد. مبنای تخفیف و tolerance تحویل/پرداخت مختلف‌اند. sheet finalization داخل PartnerContractWizard unreachable است؛ مسیر واقعی آخرین قدم save draft/open Case است، نه فقدان نهایی‌سازی کل سامانه.

### ۸. دو شکاف دیگر در خروجی و پاسخ مشتری — شاهد منبع

رد عمومی مشتری همکار ثبت می‌شود، اما endpoint دلیل رد را دریافت نمی‌کند و hook آن را ذخیره نمی‌کند؛ این با الزام دلیل در ADR-0113 اختلاف دارد و با رد قیمت سبلان که دلیل دارد یکی نیست. همچنین final PDF پس از rendering در transaction دوم، برای flow جدید Case/head/authority جاری را دوباره بررسی نمی‌کند؛ تغییر یا لغو میان آماده‌سازی و انتشار یک سناریوی race مهم است. snapshot immutable به‌تنهایی مجوز جاری را اثبات نمی‌کند. جزئیات مسیر و سناریوی اجرایی در بخش ۱۸ backend report است؛ race در این اجرا بازتولید نشده است.

## تفاوت‌های عمدی که باید محفوظ بمانند

دو قیمت و دو بدهکار، Case/revision/hash، مالکیت خصوصی مشتری و پروژه، assignment پاسخ‌دهنده، مدت مستقل هر پیشنهاد، حکمی مستقل خرید، عدم افشای wholesale/margin/internal number، قطعی‌شدن مشروط به استعلام، شروع متفاوت مهلت مالی، وصول خصوصی مشتری و تسویه همکار با سبلان، حفظ قراردادهای تاریخی، مجوز اصلاح و تاریخچه حذف/لغو. اسناد قدیمی درباره PRINTED، سکوت مشتری و نهایی‌سازی بدون پذیرش مشتری برای گردش جدید authority نیستند.

## آزمون‌های تازه و حدود نتیجه

| اجرا | نتیجه | نوع شاهد |
|---|---|---|
| `npm --prefix frontend run test:contract-creation` | تمام زنجیره پاس، exit 0 | tests محصول/گراف/قیمت/تحویل/recovery/submission |
| `npm run test:partner-sales-contracts` | ۸۹/۸۹ پاس | package schema/policy/consumer |
| `npm --prefix backend run test:contract-monetary-reconciliation` | ۱۸/۱۸ پاس | canonical money/wholesale/internal document |
| انتخاب تخصصی product agent | ۱۹ frontend و ۳۵ backend پاس | technical/layer/service/pricing/graph؛ برخی با بالا overlap دارند |
| مرورگر creation-entry / contract-wizard / draft-navigation | ۲۴ پاس، ۱ شکست | UI روی runtime محلی، Partner APIs عمدتاً mocked |
| pure authorization/lifecycle backend | ۲۱ پاس، ۱ شکست | شکست equality متن FORBIDDEN؛ code=403 و FORBIDDEN ثابت |
| fresh-probe | پاس، خروجی ذخیره شد | child conflict، duplicate/delete، decimals/payment/date policy |
| تصویر مرحله تاریخ دو مسیر | ۱۲۸۰ و۳۹۰، light/dark؛ overflow=false | ordinary live blank data با recovery intercepted؛ Partner mocked context/catalog/lease |

شکست مرورگر: fixture `COMMITTED + canContinue=false + canRequestCorrection=true` انتظار «ویرایش» دارد؛ کد درست همان permission را «درخواست اصلاح» نشان می‌دهد. تست نیز commercial payload جدید را کامل ندارد. محصول یا fixture برای سبزکردن audit تغییر نکرد. screenshot/trace در `test-results/design-system/partner-contract-wizard-Pa-15d9c-ith-the-preserved-SMS-label-desktop-chromium/` محفوظ است.

شکست authorization: انتظار متن قدیمی با متن جدید راهنمای دسترسی تطابق ندارد؛ نتیجهٔ مجوز یکسان است. این شکست را از شکست امنیتی یا بازشدن دسترسی تفکیک کنید. جزئیات در backend report است.

تصاویر تاریخ: [عادی desktop](ordinary-date-1280-light.png)، [همکار desktop](partner-date-1280-light.png)، [عادی mobile dark](ordinary-date-390-dark.png)، [همکار mobile dark](partner-date-390-dark.png). نخستین mock تصویربرداری ناقص بود و banner integrity می‌داد؛ شکل lease/recovery طبق schema اصلاح و همه تصاویر نهایی دوباره گرفته شدند. آن banner باگ محصول نبود.

ارقام فارسی در کنترل مقدار تحویل توسط `ErpInput inputMode=decimal` عادی‌سازی می‌شوند؛ پاس‌دادن رقم فارسی خام به helper و دیدن failure، اثبات خرابی تایپ کاربر نیست. preview فرزند نامعتبر و کاهش دقت payment adapter برعکس با ورودی پذیرفته‌شدهٔ جاری بازتولید شدند.

مقایسهٔ منبع تمام محورهای بالا انجام شده؛ اجرای همه permutationهای داده/نقش/device، همه raceها، دیتابیس→reload→PDF→حسابداری→خروج فیزیکی، SMS واقعی، دانلود فایل و همه legacy cohortها انجام نشده است. هیچ نتیجه‌ای در این سند «برابری کامل اثبات‌شده» یا «آماده انتشار بدون ایراد» نامیده نمی‌شود. بررسی UI با mock معادل roundtrip دیتابیس و actor واقعی همکار نیست.

## تصمیم‌های لازم پیش از طراحی تغییر

۱. هدف اشتراک تا کجاست؟ پیشنهاد: همه قابلیت‌های مشترک عادی/همکار یک رفتار داشته باشند، با استثناهای صریح اقتصادی/مالکیت/استعلام؛ ایرادهای عادی هم مستقل اصلاح شوند.

۲. تخفیف مشتری همکار روی کل retail بماند یا پایه/سقف عادی را بگیرد؟ پیشنهاد: اختیار مستقل همکار روی retail بماند، مگر مصوبه تجاری جدید؛ wholesale هیچ تغییری نکند.

۳. حذف parent دارای child چه کند؟ پیشنهاد: مثل عادی مسدود شود و ابتدا childها صریحاً مدیریت شوند. cascade بدون شرح اثر قابل دفاع نیست.

پس از روشن‌شدن این تصمیم‌ها، ابتدا حفاظت گراف و recovery و حفظ service schedule، سپس شکاف‌های UX و قابلیت، و در نهایت بررسی compatibility routeهای backend با سناریوی ایزوله انجام شود. این گزارش مجوز پیاده‌سازی تصمیم‌های تازه یا تغییر production نیست.
