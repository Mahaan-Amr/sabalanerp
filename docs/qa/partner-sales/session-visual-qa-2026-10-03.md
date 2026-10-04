# گزارش QA بصری تغییرات فروش همکار — ۳ اکتبر ۲۰۲۶

نتیجهٔ فعلی: پنج ایراد UI اصلاح شدند؛ همهٔ ۴۷ سناریوی متمایز پس از بازآزمایی نتیجهٔ موفق دارند. علت اصلی پاسخ متناوب 409 کاتالوگ همچنان تأیید نشده است.

نتیجهٔ اجرای اولیه، پیش از اصلاح: بررسی انجام شد، اما پذیرش کامل تغییرات تأیید نمی‌شود. از ۴۷ سناریوی مرورگری متمایز، ۴۴ سناریو موفق و ۳ سناریو دارای خطای دسترس‌پذیری بودند. بررسی دستی صفحهٔ واقعی نیز خطای متناوب دریافت کاتالوگ و دو ایراد متن صفحهٔ مشتری را نشان داد.

## محیط و روش

- محیط موجود `sabalanerp-local`؛ بدون ایجاد سرویس یا پایگاه دادهٔ دوم.
- مرورگر واقعی Arc برای پروندهٔ گزارش‌شدهٔ همکار-۰۰۱۵۵؛ تست‌های Playwright روی همان فرانت‌اند محلی برای پوشش سناریوها و ثبت تصاویر.
- عرض‌های ۱۲۸۰ و ۳۹۰ پیکسل؛ حالت روشن و تاریک برای جزئیات پرونده، پنجرهٔ بازگشت و صفحهٔ مشتری؛ بزرگ‌نمایی ۲۰۰٪ برای جزئیات پروندهٔ دسکتاپ.
- تصاویر خروجی پرونده، پنجرهٔ اصلاح، مشتری، رد مشتری، حسابداری و محصول جدید به‌صورت بصری بازبینی شدند.
- آزمون‌های تأیید/رد مشتری و ثبت مالی با پاسخ‌های API ساختگی و کنترل‌شده اجرا شدند. هیچ قرارداد واقعی تأیید یا رد نشد و هیچ ثبت مالی واقعی انجام نشد. این آزمون‌ها پذیرش درگاه واقعی پیامک یا اجرای کامل نقش فروشندهٔ سبلان نیستند.
- در این نوبت کد محصول تغییر نکرد؛ سناریوی QA و گزارش اضافه شدند. پوش، استقرار و حذف پیش‌نمایش موقت کد انجام نشد.

## پوشش تغییرات جلسه

| تغییر یا مسیر | نتیجه و حد شواهد |
| --- | --- |
| قیمت فروش محصول جدید خالی باشد | موفق؛ با وجود قیمت پیشنهادی کاتالوگ، ورودی قیمت سنگ جدید در دسکتاپ و موبایل خالی بود. |
| حفظ قیمت دستی هنگام برگشت و ویرایش | موفق در پروندهٔ واقعی؛ قیمت‌های ۳٬۰۰۰٬۰۰۰ و ۴٬۰۰۰٬۰۰۰ و جمع ۳۸۱٬۷۵۰٬۰۰۰ تومان حفظ شدند. |
| انتخاب، ویرایش، تکثیر، حذف، لایه‌ها و خدمات مستقل | سناریوهای مرورگری قبلی موفق؛ خدمات مستقل همچنان نرخ قابل‌ویرایش خود را دارند. خالی‌بودن قیمت لایهٔ جدید در تست‌های رفتاری قبلی پوشش دارد؛ برای هر خانوادهٔ محصول تصویر مستقل جدید تهیه نشده است. |
| ارسال استعلام و ادامه با پاسخ معلق | صفحهٔ واقعی دو محصول «در انتظار پاسخ» را نشان داد؛ ورود به برنامهٔ تحویل مجاز بود. ادامه بدون برنامهٔ تحویل، پیام اعتبارسنجی مناسب داد. |
| قبلی ← ویرایش محصولات ← استعلام تازه | ورود و حفظ داده‌ها بازبینی شد؛ خطای متناوب کاتالوگ ثبت شد. در این نوبت روی پروندهٔ واقعی محصول یا استعلام تازه ذخیره نشد. جایگزینی واقعی و لغو وظیفهٔ قدیمی قبلاً در همین جلسه تأیید شده؛ شواهد در گزارش پذیرش محلی پیوندشده آمده‌اند. |
| چهار وضعیت استعلام پیش‌نویس | موفق در نمایش UI: تأیید استعلام، رد استعلام، در حال انتظار و نیازمند اصلاح. داده‌های وضعیت تزریق‌شده‌اند؛ این آزمون تغییر وضعیت سرور را اثبات نمی‌کند. |
| یادداشت، امضا شده، قطعی | نمایش برچسب‌های پرونده موفق؛ صفحهٔ عمومی هنوز وضعیت انگلیسی DRAFT نشان می‌دهد. |
| ارسال کد پیش از تکمیل استعلام | دکمه در پروندهٔ منتظر فعال بود؛ آزمون قبلی ارسال ساختگی، کد آزمایشی و لینک قرارداد را کنار هم نشان داد. |
| مشاهده و تأیید/رد مشتری مستقل از استعلام | موفق در هر دو عرض و هر دو حالت؛ قرارداد خوانده شد، کد خالی/نادرست خطا داد، ارسال مجدد و کد صحیح کار کردند و رد نسخه ثبت شد. |
| رد مشتری، اصلاح و شروع دوبارهٔ تأییدها | پنجرهٔ بازگشت و پاک‌شدن کد قبلی/نمایش تأیید فروش مجدد موفق؛ ابطال واقعی کد قدیمی و ریست تأییدها در تست یکپارچهٔ قبلی همین جلسه پوشش دارند. |
| نسخهٔ قدیمی مشتری | موفق؛ نسخهٔ جایگزین‌شده فقط قابل مشاهده بود و دکمهٔ تأیید نداشت. |
| قطعی‌شدن فقط پس از تأیید مشتری و استعلام معتبر | تست یکپارچهٔ قبلی همین جلسه موفق؛ در این QA نمایش حالت‌ها بررسی شد، قرارداد واقعی قطعی نشد. |
| ثبت مالی حسابداری پس از قطعی‌شدن | موفق در UI کنترل‌شده؛ پروندهٔ امضاشده با استعلام معلق دکمهٔ ثبت مالی نداشت. بازکردن صفحه هیچ درخواست ثبت مالی نداد؛ کلیک صریح فقط یک درخواست ثبت فرستاد. |
| امضای کاغذی مشتری | نمایش اقدام برای پروندهٔ مجاز بررسی شد؛ ثبت واقعی امضا انجام نشد. |
| فاکتور و دریافتنی جدا باشند | سناریوی مرورگری موفق؛ ایجاد دریافتنی تا صدور فاکتور بسته بود و پس از تأیید صریح انجام شد. |
| زمان ثبت دریافت و انتقال مشتری | تست ساعت با ثانیه، و تست‌های انتقال مشتری در مجموعهٔ قبلی موفق بودند. |

## ایرادهای ثبت‌شده در اجرای اولیه

### ۱. اولویت بالا: خطای متناوب کاتالوگ و اعلام نادرست غیرفعال‌بودن محصول

در پروندهٔ واقعی همکار-۰۰۱۵۵، از مرحلهٔ استعلام با «قبلی» به محصولات و سپس «ویرایش محصولات» رفتم. صفحه پیام «دریافت کاتالوگ فنی انجام نشد» داد و برای محصولات حفظ‌شده نوشت «این محصول دیگر در کاتالوگ فعال نیست. آن را با محصول دیگری جایگزین کنید.»

لاگ محلی درخواست‌های `POST /api/partner/technical/catalog/query` با پاسخ 409 در 09:56:50، 09:56:51 و 09:57:02 UTC ثبت کرد. در بازآزمایی بعدی همان صفحه ۵۱۵ محصول بارگذاری کرد و محصولات قبلی قابل ویرایش بودند؛ بنابراین این خطا متناوب است، نه اثبات حذف محصولات از کاتالوگ. علت اصلی هنوز تعیین نشده است.

انتظار: خطای دریافت کاتالوگ باید حالت خطا/تلاش مجدد نشان دهد؛ از شکست دریافت نباید نتیجهٔ «محصول غیرفعال است» گرفت یا کاربر را به حذف محصول هدایت کرد.

### ۲. اولویت متوسط: کنتراست پایین زیرعنوان پرونده در حالت روشن

آزمون ۱۲۸۰ پیکسل روشن روی متن «وضعیت پرونده و وصول مشتری» خطای جدی `color-contrast` ثبت کرد: نسبت ۳٫۳۱ به ۱، در برابر حد لازم ۴٫۵ به ۱ برای متن ۱۲ پیکسل. این خطا در معیار دسترس‌پذیری محسوب می‌شود، هرچند اقدام‌های پرونده و پنجرهٔ اصلاح کار کردند.

### ۳. اولویت متوسط: جدول محصولات مشتری با صفحه‌کلید قابل پیمایش نیست

در عرض ۳۹۰، حالت روشن و تاریک، آزمون `scrollable-region-focusable` شکست خورد. جدول محصولات داخل `div.overflow-x-auto` پیمایش افقی دارد، اما خود ناحیه یا محتوای آن قابل فوکوس نیست. کاربر لمسی می‌تواند آن را جابه‌جا کند؛ دسترسی با صفحه‌کلید ناقص است. صفحه در مجموع سرریز افقی نداشت.

### ۴. اولویت متوسط: وضعیت انگلیسی در قرارداد عمومی

خلاصهٔ قرارداد مشتری برای پیش‌نویس مقدار `DRAFT` را نمایش می‌دهد. انتظار: برچسب فارسی هماهنگ با چرخهٔ قرارداد، از جمله «پیش‌نویس».

### ۵. اولویت متوسط: متن تأیید مشتری با شرط قطعی‌شدن هماهنگ نیست

بالای صفحهٔ مشتری آمده است: «ثبت کد پیامک شده به منزله تایید نهایی قرارداد و شرایط درج شده در آن است.» هم‌زمان بنر پیش‌نویس نمایش داده می‌شود. مطابق تصمیم جلسه، پذیرش مشتری و قطعی‌شدن پرونده دو مرحله‌اند و قطعی‌شدن شرط استعلام معتبر نیز دارد. متن باید ثبت پذیرش همین نسخه توسط مشتری را توضیح دهد تا این دو مفهوم اشتباه نشوند.

## نتایج اجرا

| مجموعه | موفق | ناموفق |
| --- | ---: | ---: |
| ۸ فایل مرورگری قبلی فروش همکار | ۳۲ | ۰ |
| ماتریس جدید پرونده، مشتری، وضعیت‌ها و حسابداری | ۹ | ۳ |
| قیمت خالی محصول جدید، دو عرض | ۲ | ۰ |
| انتخاب ساعت ثبت دریافت با ثانیه | ۱ | ۰ |
| مجموع سناریوهای متمایز | ۴۴ | ۳ |

اجراهای اولیهٔ سناریوهای جدید دو اشتباه در دادهٔ آزمون داشتند: مسیر public API و ورود مستقیم به ویرایش بدون snapshot. سناریوها اصلاح و دوباره اجرا شدند؛ این دو شکست، باگ محصول محسوب نشده‌اند و در جدول نهایی شمرده نشده‌اند. خطاهای واقعی دسترس‌پذیری حذف یا نادیده گرفته نشدند.

## شواهد

- [نتیجهٔ ۳۲ آزمون قبلی](/Users/ferferi/Documents/ChatGPT/sabalanerp/tmp/qa/partner-visual-2026-10-03/existing-32-results.json)
- [نتیجهٔ ماتریس جدید](/Users/ferferi/Documents/ChatGPT/sabalanerp/tmp/qa/partner-visual-2026-10-03/final-matrix-results.json)
- [نتیجهٔ قیمت خالی](/Users/ferferi/Documents/ChatGPT/sabalanerp/tmp/qa/partner-visual-2026-10-03/price-final-results.json)
- [جزئیات پرونده، موبایل تاریک](/Users/ferferi/Documents/ChatGPT/sabalanerp/tmp/qa/partner-visual-2026-10-03/case-390-dark.png)
- [پنجرهٔ بازگشت به یادداشت، موبایل روشن](/Users/ferferi/Documents/ChatGPT/sabalanerp/tmp/qa/partner-visual-2026-10-03/dialog-390-light.png)
- [قرارداد مشتری، موبایل روشن](/Users/ferferi/Documents/ChatGPT/sabalanerp/tmp/qa/partner-visual-2026-10-03/customer-390-light.png)
- [پنجرهٔ رد مشتری، موبایل تاریک](/Users/ferferi/Documents/ChatGPT/sabalanerp/tmp/qa/partner-visual-2026-10-03/customer-reject-390-dark.png)
- [حسابداری، موبایل](/Users/ferferi/Documents/ChatGPT/sabalanerp/tmp/qa/partner-visual-2026-10-03/accounting-390.png)
- [قیمت خالی محصول جدید، موبایل](/Users/ferferi/Documents/ChatGPT/sabalanerp/tmp/qa/partner-visual-2026-10-03/empty-price-390.png)
- [شواهد یکپارچه و جایگزینی واقعی استعلام در همین جلسه](/Users/ferferi/Documents/ChatGPT/sabalanerp/docs/qa/partner-sales/commercial-confirmation-local-acceptance.md)
- [سناریوهای جدید QA](/Users/ferferi/Documents/ChatGPT/sabalanerp/tests/design-system-e2e/partner-visual-audit.spec.ts)

تصاویر و traceها خروجی محلی آزمون هستند و برای تحویل کد نباید همراه فایل‌های منبع commit شوند. پیش‌نمایش موقت OTP طبق درخواست قبلی باقی است و پیش از پوش آینده باید برداشته شود.

## اصلاح و بازآزمایی به درخواست کاربر

- دریافت کاتالوگ وضعیت مستقل «در حال دریافت / آماده / خطا» دارد. شکست دریافت دیگر به معنای غیرفعال‌بودن محصولات ذخیره‌شده تفسیر نمی‌شود؛ نام و قیمت ذخیره‌شده حفظ می‌شوند و اقدام «تلاش مجدد دریافت کاتالوگ» نمایش داده می‌شود. ویرایش/ارسال فنی تا تکمیل کاتالوگ معتبر بسته می‌ماند. تشخیص واقعی محصول حذف‌شده پس از دریافت موفق همچنان برقرار است.
- درخواست‌های کاتالوگ به ترتیب اجرا و نتایج فقط پس از اعتبارسنجی کامل منتشر می‌شوند؛ درخواست‌های هم‌زمان غیرضروری برای پروفایل یکسان حذف شدند. این یک کاهش ازدحام و اصلاح بازیابی است، نه اثبات علت پاسخ 409 قبلی.
- متن زمینهٔ صفحه در کامپوننت مشترک ERP از رنگ muted به secondary تغییر کرد تا خوانایی زیرعنوان حفظ شود.
- ناحیهٔ جدول مشتری عنوان دسترس‌پذیر و فوکوس صفحه‌کلید دارد؛ پیمایش افقی موبایل با کلیدهای جهت در آزمون مرورگر بررسی می‌شود.
- وضعیت‌های چرخهٔ قرارداد در خلاصهٔ عمومی فارسی شدند. متن کد مشتری اکنون پذیرش همین نسخه را توضیح می‌دهد و قطعی‌شدن را وعده نمی‌دهد.

آزمون بازگشتی مستقل ابتدا برای دو حالت خطا و بارگذاری شکست خورد و پس از اصلاح موفق شد. حالت سوم، محصول واقعاً غایب در کاتالوگ کامل، نیز موفق است. آزمون‌های رفتاری فنی و خلاصهٔ قرارداد، بررسی طراحی، foundation، adoption، مالکیت اتصال پایگاه داده و ساخت production فرانت‌اند موفق بودند. نسخهٔ اصلاح‌شده فقط در سرویس frontend محیط موجود sabalanerp-local بازسازی و اجرا شد.

برای بررسی خطای متناوب 409، خواندن کامل هفت نوع کاتالوگ برای پروفایل همان پرونده در ده دور روی پایگاه دادهٔ موجود انجام شد؛ خطا تکرار نشد. علت اصلی 409 هنوز تأیید نشده است؛ بازیابی UI اصلاح شده و خطای دریافت دیگر کاربر را به حذف محصول هدایت نمی‌کند.

### نتیجهٔ بازآزمایی اصلاحات

اجرای کامل ۴۷ آزمون: ۴۶ موفق، یک شکست `ERR_EMPTY_RESPONSE` هنگام بازشدن صفحهٔ مشتری در دسکتاپ روشن. سرویس frontend در همان زمان یک بار خودکار راه‌اندازی مجدد شد؛ علت خروج پردازش از شواهد موجود معلوم نیست. چهار حالت صفحهٔ مشتری پس از سالم‌شدن سرویس دوباره اجرا شدند و هر چهار حالت موفق بود. هیچ timeout، انتظار دسترس‌پذیری یا معیار آزمون برای عبور تغییر داده نشد. بنابراین تمام ۴۷ سناریوی متمایز نتیجهٔ موفق دارند، اما اجرای نخست این بازآزمایی کاملاً سبز نبود.

- چهار حالت پرونده، کنتراست و پنجرهٔ بازگشت: موفق.
- چهار حالت مشتری، وضعیت فارسی، متن پذیرش نسخه، پیمایش جدول موبایل با کلید جهت، تأیید/رد و نسخهٔ جایگزین‌شده: موفق.
- بازیابی پس از پاسخ کنترل‌شدهٔ 409 کاتالوگ و خالی‌ماندن قیمت محصول جدید در دو عرض: موفق.
- آزمون بازگشتی حفظ ردیف و قیمت دستی در حالت loading/error و تشخیص صحیح محصول غایب پس از دریافت کامل: ۳ موفق.
- تصاویر تازهٔ پروندهٔ دسکتاپ روشن، مشتری موبایل روشن و قیمت خالی موبایل بازبینی بصری شدند؛ برچسب‌ها و ورودی‌ها در محدودهٔ صفحه قرار دارند.

[نتیجهٔ اجرای کامل اصلاحات](/Users/ferferi/Documents/ChatGPT/sabalanerp/tmp/qa/partner-visual-2026-10-03/repaired-results.json) · [نتیجهٔ بازآزمایی چهار حالت مشتری](/Users/ferferi/Documents/ChatGPT/sabalanerp/tmp/qa/partner-visual-2026-10-03/customer-retest-results.json)

بررسی بومی Arc صفحهٔ واقعی کاتالوگ و پنجرهٔ ویرایش را نشان داد؛ ادامهٔ تعامل به خطای ابزار `noWindowsAvailable` برخورد کرد. تأیید کامل اصلاحات UI با مرورگر Playwright روی همان فرانت‌اند محلی انجام شد. در این نوبت جایگزینی استعلام واقعی جدید، تأیید مشتری واقعی، ارسال پیامک واقعی یا ثبت مالی واقعی انجام نشد؛ شواهد جایگزینی واقعی قبلی جلسه در گزارش پذیرش محلی باقی است. هیچ پوش یا استقرار تولید انجام نشد و پیش‌نمایش موقت کد مشتری حفظ شد.

### انتقال بازگشت به یادداشت به دکمهٔ ویرایش

طبق درخواست بعدی کاربر، دکمهٔ مستقل «بازگشت به یادداشت» حذف شد. برای پیش‌نویس دارای تأیید فروش، دکمهٔ واحد «ویرایش» در نوار اقدام قرارداد همان پنجرهٔ ثبت دلیل و بازگشت برای اصلاح را باز می‌کند. این مسیر همچنان تصمیم REJECT_DRAFT را با revision جاری ارسال می‌کند، تأییدها و کد قبلی را باطل می‌کند و پس از بازگشت به یادداشت، ویرایش از مسیر recovery قبلی ادامه دارد. مجوزها و رفتار اصلاح قرارداد قطعی حفظ شدند.

۶ آزمون مرورگری در دو عرض و دو تم موفق شدند؛ نبودن دکمهٔ قدیمی، وجود دقیقاً یک دکمهٔ ویرایش، بازشدن پنجره، Escape و پاک‌شدن پیش‌نمایش کد پس از ریست تأییدها بررسی شد. ۶ آزمون رفتاری toolbar، طراحی، foundation (۲۵)، adoption (۱۴) و build موفق‌اند. نسخهٔ frontend محیط محلی موجود بازسازی و اجرا شد؛ پوش انجام نشد.

[نتیجهٔ آزمون انتقال اقدام ویرایش](/Users/ferferi/Documents/ChatGPT/sabalanerp/tmp/qa/partner-visual-2026-10-03/edit-action-results.json)

### تایید، امضای فروشنده و رد به معنی لغو

کاربر تأیید کرد که امضا، امضای خود فروشنده است و شروط مشتری و استعلام حفظ می‌شوند. نوار قرارداد «تایید» را پیش از تأیید فروش نشان می‌دهد و پس از آن «امضا» را عرضه می‌کند. امضای فروشنده با هویت احرازشده، نسخه تجاری و زمان در رویداد PARTNER_SELLER_SIGNED و لاگ حسابرسی ثبت می‌شود و در سوابق دیده می‌شود. ثبت تکراری همان نسخه یک امضا باقی می‌گذارد؛ نسخه تازه امضای تازه می‌خواهد و امضای قدیمی حفظ می‌شود. امضا پذیرش مشتری، قطعیت یا اختیار ثبت مالی ایجاد نمی‌کند. پس از اولین رکورد مالی ثبت مستقیم این امضا بسته است.

«رد» از مجوز موجود CASE_CANCEL استفاده می‌کند؛ دلیل الزامی است و پرونده و قرارداد مشتری با حفظ سوابق لغو می‌شوند. پس از قطعیت، مسیر لغو مستقیم جایگزین مرز حسابداری/ابطال نمی‌شود. «ویرایش» همچنان بازگشت به یادداشت و پاک‌شدن تأییدها را انجام می‌دهد. «رد استعلام» تصمیم مستقل قیمت باقی می‌ماند. این تصمیم در اصلاحیه ADR-0113 ثبت شد.

نتایج: ۸ سناریوی مرورگری مرتبط در دسکتاپ/موبایل و تم روشن/تاریک موفق، ۳ آزمون یکپارچه تراکنشی روی پایگاه موجود موفق و ۸۵ آزمون بسته قراردادهای همکار موفق. طراحی، foundation، adoption، مالکیت Prisma و build فرانت‌اند/بک‌اند موفق‌اند. تصویر سوابق امضای فروشنده در موبایل بازبینی شد. بک‌اند و فرانت‌اند در همان sabalanerp-local بازسازی و اجرا شدند. داده‌های آزمون یکپارچه rollback شدند و آزمون مرورگر پاسخ‌های کنترل‌شده داشت؛ هیچ امضا یا لغو واقعی انجام نشد.

حد شواهد: یک آزمون قدیمی customer-complete save creates one numbered unpriced Case without operational projections پیش از بخش لغو به انتظار null برای internalRecord برخورد کرد؛ داده فعلی رکوردی با pricingState=AWAITING_INQUIRY دارد. این انتظار تغییر داده نشد و کل مجموعه یکپارچه سبز اعلام نمی‌شود. آزمون مستقل جدید لغو پس از امضای فروشنده موفق است. اجرای اولیه دو سناریوی جدید مرورگر به دلیل fixture متناقض (وضعیت انتظار همراه با مبلغ خرید آماده) رد شد؛ fixture با مرز معنایی موجود اصلاح شد و هر ۸ سناریو دوباره موفق شدند.

[نتیجه نهایی آزمون اقدام‌های فروشنده](/Users/ferferi/Documents/ChatGPT/sabalanerp/tmp/qa/partner-visual-2026-10-03/seller-sign-final-results.json)

### اصلاح نهایی: تأیید همکار بدون مرحله امضای فروشنده

این بخش تصمیم قبلی درباره مرحله امضای فروشنده را جایگزین می‌کند. طبق درخواست جدید کاربر، دکمه و فرمان امضای همکار حذف شد؛ «تایید» مستقیماً یادداشت را پیش‌نویس می‌کند. رویدادهای تاریخی امضا حذف نمی‌شوند. پذیرش مشتری مستقل از استعلام است و وضعیت «امضا شده» می‌دهد. پاسخ کامل و معتبر سبلان، طبق انتخاب کاربر، وضعیت اصلی را به «استعلام شده» تغییر می‌دهد؛ پاسخ ناقص یا منقضی چنین اثری ندارد. تأیید همکار، پذیرش مشتری و پذیرش قیمت معتبر با هم شرط «قطعی» هستند. رد فروشنده همچنان لغو با دلیل است؛ ویرایش، مسیر بازگشت برای اصلاح و شروع دوباره تأییدهاست.

فهرست فروش و فیلترها از وضعیت تجاری جاری همکار استفاده می‌کنند. تمام عنوان‌های دارای «قدیمی» از این نمایش حذف شدند، بدون بازنویسی داده تاریخی. فیلتر وضعیت در API پیش از صفحه‌بندی اعمال می‌شود؛ قراردادهای عادی و تاریخی نیز در شمارش و نتایج باقی می‌مانند. امضای همکار در فهرست، صفحه قرارداد و نوار اقدام عرضه نمی‌شود.

۸۶ آزمون بسته قراردادهای همکار، چهار آزمون یکپارچه منتخب شامل شروط واقعی قطعیت، و بررسی مالکیت Prisma و طراحی موفق شدند. ساخت production فرانت‌اند و بک‌اند موفق است. این شمارش به معنی سبزبودن کل مجموعه یکپارچه نیست؛ محدودیت آزمون قدیمی درج‌شده در بخش قبلی همچنان برقرار است. آزمون‌های یکپارچه با rollback روی پایگاه موجود اجرا شدند.

بازآزمایی نهایی مرورگر: هر ۹ سناریو موفق است؛ چهار حالت فهرست در موبایل/دسکتاپ و تم روشن/تاریک، دو حالت تایید مستقیم و لغو، دو حالت ریست کد هنگام اصلاح، و یک آزمون API واقعی فیلتر و شمارش پیش از صفحه‌بندی. تصاویر فهرست دسکتاپ روشن، موبایل تاریک و پرونده پس از تایید در موبایل بازبینی شدند. اجرای اولیه فایل آزمون به نقص نحوی fixture و سپس انتخاب هم‌زمان ردیف پنهان و قابل‌مشاهده در دو نمایش responsive برخورد کرد؛ آزمون اصلاح شد، معیار محصول تغییر نکرد و اجرای نهایی ۹/۹ موفق بود.

فرانت‌اند و بک‌اند در همان پروژه sabalanerp-local بازسازی و اجرا شدند. تأیید/لغو مرورگری با پاسخ کنترل‌شده بررسی شد؛ آزمون API واقعی فقط خواندنی بود. پوش، استقرار تولید، پیامک واقعی یا ثبت مالی واقعی انجام نشد.

[نتیجه بازآزمایی نهایی وضعیت‌ها و حذف امضای همکار](/Users/ferferi/Documents/ChatGPT/sabalanerp/tmp/qa/partner-visual-2026-10-03/list-status-final-results.json)

### نمایش کد آزمایشی در صفحه جزئیات قرارداد فروش

تصویر کاربر مسیر `/dashboard/sales/contracts/:id` را نشان می‌داد. نمایش موقت OTP در PartnerCaseRuntime وجود داشت، اما PartnerSalesContractWorkspace پاسخ ارسال را دور می‌ریخت. تنظیمات بک‌اند موجود NODE_ENV=development، SMS_IR_ENVIRONMENT=sandbox و PARTNER_LOCAL_CONFIRMATION_PREVIEW=true تأیید شدند. آزمون مسیر جزئیات پس از ارسال موفق، روی نبودن کد شکست خورد؛ اکنون پاسخ همان ارسال شامل debugOtp و publicLink در بالای همان صفحه نشان داده می‌شود. کد جدید جای قبلی را می‌گیرد و پاسخ بدون پیش‌نمایش، تغییر نسخه یا دریافت پس از انقضا پیش‌نمایش قبلی را پاک می‌کند. نمایش در حافظه صفحه است؛ بعد از رفرش نیاز به ارسال تازه دارد و کد plaintext ذخیره نمی‌شود.

دو سناریوی جدید جزئیات در عرض‌های ۱۲۸۰ و ۳۹۰، نمایش کد، بازشدن URL مرتبط، تعویض کد و حذف پیش‌نمایش در پاسخ بدون debugOtp را بررسی کردند؛ چهار سناریوی پیشین ریست تأیید، تأیید مستقیم و لغو نیز موفق‌اند. تصویر موبایل بازبینی شد. طراحی، foundation (۲۵)، adoption (۱۴) و ساخت production فرانت‌اند موفق‌اند. frontend همان sabalanerp-local بازسازی و اجرا شد؛ بک‌اند تغییر نکرد. ارسال مرورگری کنترل‌شده بود و پیامک واقعی ارسال نشد. این پیش‌نمایش طبق درخواست قبلی پیش از پوش آینده باید حذف شود.

[نتیجه آزمون کد در جزئیات قرارداد](/Users/ferferi/Documents/ChatGPT/sabalanerp/tmp/qa/partner-visual-2026-10-03/detail-code-results.json)

### یکسان‌سازی تایید، ادامه پاسخ قیمت و بازیابی وظیفه

داده واقعی قرارداد ۱۰۰۳۳۷ نشان می‌داد status=APPROVED و approvedBy ثبت شده ولی salesApprovalRevision خالی است؛ دکمه جزئیات از تصمیم قدیمی قرارداد عادی استفاده می‌کرد. جزئیات اکنون از commercial و مجوزهای Case و فرمان APPROVE_SALES استفاده می‌کند و تا دریافت مجوزهای جاری، تصمیم قدیمی عرضه نمی‌شود. تأیید فهرست هم برای گردش جدید همکار از همان فرمان و revision جاری استفاده می‌کند؛ رد فهرست برای ثبت دلیل لغو به جزئیات هدایت می‌شود.

«ادامه تکمیل قرارداد» مستقل از «ویرایش» در نوار نمایش داده می‌شود؛ پاسخ کامل، جزئی یا رد سبلان از لینک ادامه وارد مرحله استعلام می‌شود. لینک نتیجه وظیفه نیز مقصد همین مرحله را دارد. مسیر creation-context اشتباهاً contractId=null را برای بازیابی Case الزامی می‌کرد. پیش‌نویس واقعی داخل تصویر موجود بود و به قرارداد متصل شده بود؛ جست‌وجوی درخواست Case اکنون با owner، purpose=PARTNER_TECHNICAL و partnerCaseId همان پیش‌نویس را پیدا می‌کند. مرز مالکیت و بررسی وضعیت Case حفظ شده‌اند؛ فهرست عمومی پیش‌نویس‌ها گسترده نشده است.

آزمون واحد ادامه ابتدا شکست خورد و پس از اصلاح هر پنج آزمون caseDetailParity موفق شد. آزمون مسیر واقعی creation-context روی همان قرارداد ابتدا پیش‌نویس متصل را پیدا نکرد و پس از اصلاح موفق شد؛ این آزمون درون سرویس backend موجود با احراز هویت تزریق‌شده همان مالک و مجوزهای واقعی دامنه اجرا شد. پایگاه یا Compose جدید ساخته نشد. اجرای نهایی هفده سناریوی مرورگری شامل تایید صحیح، برچسب‌ها، کد مشتری و ادامه پاسخ کامل/جزئی/رد در موبایل و دسکتاپ موفق شد. وجود هم‌زمان ویرایش و ادامه تکمیل پس از پاسخ نیز بررسی شد؛ تصویر موبایل پاسخ کامل بازبینی شد. پاسخ‌های فرمان مرورگری کنترل‌شده بودند.

تأیید قبلی فقط برای قرارداد ۱۰۰۳۳۷ با کنترل امضای approve.by، approvedBy، commercialRevision=1، نبود ثبت مالی و عدم پذیرش قیمت بازیابی شد. انتقال از فرمان دامنه و مجوز حسابرسی‌شده CASE_COMMIT انجام شد؛ customerAcceptanceRevision موجود حفظ شد. وضعیت تجاری حاصل QUOTED است، چون پاسخ کامل قیمت در این فاصله ثبت شده است. این اصلاح محلی، تأیید مشتری، پذیرش قیمت یا ثبت مالی جدید ایجاد نکرد و مهاجرت عمومی قراردادهای تاریخی نبود.

بررسی مالکیت Prisma، طراحی، foundation (۲۵)، adoption (۱۴) و build موفق‌اند؛ frontend و backend در sabalanerp-local به‌روز شدند. پوش و استقرار تولید انجام نشد.

[نتایج مرورگری پاسخ قیمت و تایید](/Users/ferferi/Documents/ChatGPT/sabalanerp/tmp/qa/partner-visual-2026-10-03/response-navigation-results.json)

### اصلاح دریافت دسترسی پیش‌نویس متصل، بدون اجرای آزمون به درخواست کاربر

گزارش بعدی کاربر نشان داد ورود واقعی هنوز در recoveries/acquire پاسخ 409 می‌دهد. لاگ موجود PostgreSQL علت مشخصی داشت: خطای 23514 از partner_reject_incompatible_persona هنگام UPDATE رکورد sales_contract_edit_sessions. این guard فقط پیش‌نویس PARTNER_TECHNICAL بدون contractId را برای هویت همکار فعال مجاز می‌دانست، در حالی که رکورد شماره‌گذاری‌شده به قرارداد مشتری متصل است. شواهد قبلی بازیابی context و مقصد لینک، موفقیت دریافت lease واقعی را اثبات نمی‌کردند.

مهاجرت 20261003130000_partner_bound_technical_persona_guard همان استثنا را فقط برای recovery محافظت‌شده‌ای گسترش می‌دهد که قرارداد PARTNER_CUSTOMER، مسئول فروش همان owner و partnerCaseId دقیقاً منطبق با recovery دارد. شرط پروفایل ACTIVE و تمام مرزهای سایر مسئولیت‌ها حفظ شدند؛ guard مستقل اتصال فنی نیز برقرار است. این تغییر قرارداد، استعلام، تأیید مشتری یا تاریخچه را بازنویسی نمی‌کند.

طبق دستور صریح کاربر، هیچ آزمون خودکار، مرورگری، API یا سناریوی دریافت lease در این نوبت اجرا نشد. تشخیص از خواندن کد، داده موجود و لاگ خطای ثبت‌شده انجام شد. بررسی مالکیت اتصال و ساخت لازم برای به‌روزرسانی سرویس محلی موفق بودند؛ آزمون رفتار به کاربر واگذار شده است. مهاجرت عمومی در sabalanerp-local با پیام All migrations have been successfully applied اعمال شد و backend دوباره اجرا شد. هیچ شرطی بر شماره یا شناسه قرارداد نمونه وجود ندارد و هیچ رکورد قرارداد خاصی در این اصلاح بازنویسی نشد. پوش و استقرار تولید انجام نشد.
### Price acceptance: unclaimed CRM project and offered-price formatting

- Initial read-only diagnosis observed a null CRM join result and incorrectly treated it as an existing unclaimed CRM project. The follow-up diagnosis below corrects that interpretation; the first fix was insufficient for canonical customer projects.
- The shared draft-revision path now locks an unchanged project belonging to the customer when it is either unclaimed or linked to this same contract. A project claimed by another contract still fails. Switching away from an unclaimed project no longer attempts to unlink a nonexistent contract claim; existing claims retain their guarded update.
- No contract-specific ID or data repair is included. Price, approval, recovery revision, Case revision, and edit-lease validation remain intact.
- Sabalan offered prices use the existing exact `partnerMoneyText` formatter, including comma grouping and Persian digits, without numeric conversion or rounding.
- Architecture ownership and design-system adoption checks passed. Backend and frontend builds succeeded, and both existing `sabalanerp-local` services were recreated with the changes. No behavioral tests, browser QA, or price-acceptance commands were performed, as requested by the user. Behavioral acceptance remains for the user. No push or production deployment was performed.

### Follow-up: canonical customer project missing from the revision lock path

- The user reported the same commands-endpoint 409 after the first fix. A read-only existence query confirmed the project's active record belongs to `project_addresses` for this customer, with no corresponding `crm_potential_projects` record. Recovery and wizard technical revisions both remained 2.
- `authorizeProject` and linked-pair allocation already recognize canonical customer projects first, with retained CRM opportunities as fallback. The draft-revision lock incorrectly only recognized the fallback table and therefore always returned `ROW_STALE` for a canonical project.
- The shared draft-revision transaction now locks the active canonical customer project with the exact customer ID first, then checks the existing guarded CRM fallback if absent. Lease, technical recovery, approval binding, Case revision and ownership validation remain intact. No contract-specific patch or data mutation was performed.
- Architecture ownership and diff whitespace checks passed. Backend build succeeded and the existing local backend was recreated with the change. No behavioral tests or acceptance commands were run, following the user's instruction. The actual acceptance result remains for the user to verify.

### Accepted prices and final contract actions

- Pricing-response continuation actions are hidden once current prices are accepted, both on contract details and the Partner Case list. A received response alone no longer keeps the continuation button visible after acceptance.
- Final commercial contracts do not expose direct continuation or reset-to-draft editing. Sales-list direct editing is hidden for final Partner contracts; an authorized accounting correction retains its dedicated correction entry. The existing request action is explicitly labeled `درخواست اصلاح`, not `ویرایش`.
- The shared backend draft-revision transaction requires an approved accounting correction with an open, unexpired Sales-edit duty assigned to the actor for committed/signed contracts, even before the first financial record. The direct commercial reset endpoint also rejects signed contracts.
- Sales-list approval actions now consume the current Partner commercial `salesApproved` fact from the existing list projection. An already approved contract no longer shows the approval check mark, including when offered pricing replaces the main status label. Missing approval evidence does not expose a Partner approval button.
- Architecture, design-system adoption and diff checks passed. The final backend/frontend builds succeeded and both existing local services were recreated with all action changes. No behavioral tests or real workflow commands were run, per the user's instruction. No push or production deployment was performed.

### Restore pricing-result duty persona exception

- The user's Sabalan offer command returned 409. Existing PostgreSQL logs show error 23514 from `partner_reject_incompatible_persona` on `INSERT INTO hr_duties`, during creation of the owning Partner's pricing-result duty. The response transaction is rolled back on that failure.
- Migration `20261003130000_partner_bound_technical_persona_guard` had been based on an older function definition and unintentionally omitted the existing `20260921143000_partner_pricing_result_duty_guard` exception. Earlier statements that all existing guard branches were preserved were incorrect for this result-duty exception.
- New forward migration `20261003160000_partner_persona_exception_union` restores exactly the preexisting source-type/action/workspace and inquiry-owner/active-profile checks while retaining the bound technical recovery owner/contract/Case checks. Applied migration files and business records are not rewritten. Unrelated duties and responder assignments remain restricted.
- Architecture ownership and backend build passed. The new forward migration was applied by the existing local backend startup with `All migrations have been successfully applied`; backend is healthy. No offer, acceptance, API scenario or behavioral test was executed by the agent; diagnosis used existing logs and source only. No push or production deployment was performed.

### Pricing-decision success popup and return to the same contract

- Successful current-price acceptance shows a canonical modal only after the submission is acknowledged with `READY_TO_FINALIZE`. Rejection shows the same success surface only after the rejection/requote callback succeeds; the existing required reason and requote workflow are preserved.
- The success copy names the price decision, not contract cancellation or customer acceptance. `مشاهده قرارداد` and closing the success modal resolve the same Case through the authorized runtime query, then open its linked customer Contract detail. Runtime rows now include the optional linked customer contract ID; unnumbered/unlinked history retains its Case-detail fallback.
- Failed decision commands keep the current wizard/error surface and do not show a success popup or navigate away. A navigation failure retains the success modal and clearly states the decision was saved, avoiding a repeated business command.
- Architecture ownership, design-system adoption and diff checks passed. Backend/frontend builds succeeded and both existing local services were recreated. No behavioral tests or business commands were executed, following the user's instruction. No push or production deployment was performed.

### Accounting main list from Partner NOTE through all commercial statuses

- Authorized Partner Cases with a linked customer contract now enter the main Accounting contracts table before financial registration. The existing separate commercial-candidates disclosure is removed from this page, so search, pagination, lifecycle filters and status filters apply to the same rows.
- Canonical Partner commercial statuses (NOTE, DRAFT, CUSTOMER_SIGNED, QUOTED, FINAL, CANCELLED, EXPIRED) are retained in list/detail projections. Cancelled and expired Cases are included, with inactive/pending contracts controlled by the existing lifecycle filter. The QUOTED filter excludes unrelated ordinary contracts.
- Before FINAL, the preparation row supports view/print only. Its document is an allowlisted Sabalan-to-Partner preparation projection, not a financial record, and does not expose private retail rates/totals/payment terms. Unavailable wholesale amounts are labeled as pending pricing, rather than displayed as zero. FINAL enables the authorized existing enqueue action; subsequent financial actions keep their existing permission/dependency gates.
- Architecture ownership, design-system adoption and diff checks passed. Backend and frontend source builds passed. No behavioral tests, browser QA, price decisions or accounting commands were executed, per the user's instruction. Local image build/application status is recorded separately below. No push or production deployment was performed.
- Existing `sabalanerp-local` backend/frontend images built successfully and only these services were recreated. Backend reached healthy; frontend startup/readiness is checked without a business scenario. No financial rows were created by the agent.

### FINAL accounting actions denied to the system administrator

- Source diagnosis: `createAuditedPartnerAuthorization` refuses administrator write decisions without an audit reason. The new preparation projection's ACCOUNTING_WRITE probe omitted that reason, causing `canRegister=false` even for FINAL. The Accounting adapter's write authorization also omitted a reason, so simply enabling the button would still leave enqueue/receivable commands denied.
- Added code-owned, action-specific audit reasons to these authorization calls without relaxing the administrator audit rule, resource scope, narrow feature permissions or FINAL checks. The commercial-candidates/write preflight uses the same retained reason discipline.
- Preparation rows/details now name the first action `ثبت رکورد مالی`. The detail explicitly explains that invoice approval precedes receivable creation, while flags/corrections require the financial source to exist. No financial record is created by reading a page.
- Lifecycle buttons retain the existing numbered-Partner retention policy: permanent deletion is blocked, and lifecycle change/void uses the reviewed Partner workflow. The page copy now states that reason instead of implying FINAL itself is the deletion blocker.
- Architecture/design-system/diff checks passed. No behavioral test or accounting command was executed by the agent; source builds and local application are recorded below.
- Backend and frontend source builds succeeded; the existing backend/frontend images built and services were recreated successfully. Backend reached healthy. No push, production change, behavioral test or real financial command was performed.

### Owner-confirmed print, theme, superseded duty, and edited preparation fixes

- Owner confirmed preserving each requested print variant, showing unknown wholesale monetary values as `در انتظار استعلام`, and printing the actual commercial status. Internal Accounting HTML now uses the ordinary template without forcing workshop; its explicit monetary formatting option preserves unknown values. Physical details and saved delivery allocations are allowlisted; Customer retail prices/totals/payment terms remain excluded. PDF header space is reserved using the shared template option.
- Public Customer confirmation uses the shared `ThemeToggle` with the existing theme provider and persisted preference.
- New Case pricing packages WAIVE prior result duties, including a fully decided mixed approval/rejection response. Result creation/actionability checks the latest Case package and inquiry revision. The general forward migration `20261003190000_partner_pricing_result_duty_supersession` retains all historic rows, closes their assignments and appends audit evidence; it does not delete prices or rewrite unaffected offers.
- Product edits preserve explicit delivery quantities and payment installments. Removed identities have an explicit cleanup action; delivery/payment validation routes incompatible plans to correction before acceptance of prepared plans. No automatic quantity trimming or installment adjustment remains. Restoration clears incompatible completion; backend completed preparation requires exact product allocations and treats customer payment mismatch as INVALID_PAYLOAD instead of integrity conflict. Incomplete preparation also blocks seller/customer approval and commercial finality in the server.
- Backend/frontend compilation and architecture/design-system checks succeeded. Per owner instruction, no behavioral tests, browser QA, API scenario, real offer/acceptance/customer approval or accounting command was performed. Local runtime application and migration result are recorded separately below; no push or production deployment was performed.
- Final backend/frontend images built successfully, including the server preparation gates. Existing `sabalanerp-local` backend/frontend were recreated; both reported healthy. Backend startup confirms successful application of `20261003190000_partner_pricing_result_duty_supersession`. Scoped whitespace/diff check passed. This confirms source compilation and local application only; the owner's manual scenarios remain unverified.
