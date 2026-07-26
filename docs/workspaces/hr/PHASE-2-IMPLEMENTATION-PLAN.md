# برنامه پیاده‌سازی افزایشی فاز ۲ منابع انسانی

## اصل اجرا

هر بسته باید با migration قابل rehearsal، API و قوانین دامنه تست‌شده، کنترل دسترسی سمت سرور، UI فارسی/RTL، گزارش تطبیق و معیار پذیرش مستقل تحویل شود. هیچ بسته‌ای نباید با نوشتن مستقیم در چند منبع حقیقت یا با بازنویسی تاریخچه عملیاتی کامل شود.

## ۲.۱ — تثبیت مرجع HR

### ۲.۱.۱ فهرست وابستگی و قرارداد سازگاری

- همه مصرف‌کنندگان `Personnel`، `Department`، `PersonnelWorkSchedule` و `/api/personnel` فهرست شوند.
- برای هر مصرف‌کننده، مالک داده، مسیر خواندن فعلی، مسیر هدف و تاریخ مهاجرت ثبت شود.
- قرارداد خواندن سازگار برای گارد، User management و Personal Affairs تعریف شود.
- ایجاد یا ویرایش جدید در مسیر قدیمی پس از انتقال هر قابلیت مسدود شود.

**دروازه پذیرش:** هیچ مصرف‌کننده ناشناخته و هیچ نویسنده دوگانه بدون برنامه انتقال باقی نماند.

### ۲.۱.۲ غنی‌سازی رابطه استخدامی

- کاتالوگ‌های تاریخ‌پذیر Employment Type و Contract Type افزوده شوند.
- Employment Contract، اصلاحیه و وضعیت انقضا بدون پایان خودکار استخدام مدل شوند.
- Payroll Participation با بازه، دلیل، actor و عدم هم‌پوشانی افزوده شود.
- API ایجاد/اصلاح رابطه استخدامی در تراکنش و با کنترل هم‌پوشانی تکمیل شود.

**دروازه پذیرش:** جمعیت حقوق برای هر روز فقط از رابطه استخدامی و Payroll Participation قابل استخراج باشد.

### ۲.۱.۳ قرارداد جبران خدمات

- Compensation Agreement تاریخ‌دار و غیرهم‌پوشان افزوده شود.
- مؤلفه‌های تکرارشونده شخصی و مؤلفه‌های وابسته به Assignment جدا شوند.
- همه مبالغ با Decimal مناسب و واحد صریح ریال ذخیره شوند.
- تغییر نسخه، سابقه قبلی را حفظ کند.

**دروازه پذیرش:** برای هر فرد و تاریخ، قرارداد حاکم و مؤلفه‌های Assignment به‌صورت قطعی قابل حل باشند.

### ۲.۱.۴ یکپارچه‌سازی برنامه کاری

- برنامه مستقیم قدیمی Personnel به مدل HR و precedence مورد توافق نگاشت شود.
- Base Assignment، Schedule-Contributing Assignment و Override کنترل شوند.
- نسخه و Anchor الگوهای چرخشی حفظ شود.
- گارد فقط برنامه قابل‌اعمال را بخواند و Snapshot حضور نهایی را نگه دارد.

**دروازه پذیرش:** برنامه متعارض یا تعریف‌نشده آشکار باشد و تاریخچه حضور با تغییر آینده بازنویسی نشود.

### ۲.۱.۵ مرخصی، مأموریت و اضافه‌کار

- Leave Request از User به Personnel/Employment Relationship منتقل شود.
- Balance Ledger، reservation، usage، reversal و revision تکمیل شود.
- Approver از Responsible Supervisor تاریخ‌دار حل و Snapshot شود.
- Overtime Candidate، Supervisor approval و HR correction افزوده شود.
- Payroll فقط Approved Overtime و Leave نهایی را مصرف کند.

**دروازه پذیرش:** داده خام گارد هرگز به‌تنهایی حق پرداخت یا کسر ایجاد نکند.

### ۲.۱.۶ محرمانگی و حسابرسی

- Feature/Data scopes برای Payroll Processor، Approver، Policy Owner، Accounting و Employee تعریف شود.
- نمایش، دانلود، خروجی و تغییر داده حساس audit event بسازد.
- مجوزهای self، supervisor scope و company scope در API اعمال شوند.
- جداسازی وظایف حتی برای ADMIN در عملیات عادی enforce شود.

**دروازه پذیرش:** تست منفی دسترسی ثابت کند هیچ UI پنهان‌شده‌ای جای کنترل API را نگرفته است.

## ۲.۲ — حقوق و دستمزد

### ۲.۲.۱ سیاست و کاتالوگ مؤلفه‌ها

- Payroll Policy Version با source، effective date، draft/approved state و reviewer ساخته شود.
- کاتالوگ earnings، deductions، employer contributions و informational components ساخته شود.
- عملگرهای کنترل‌شده fixed، rate×quantity، percent، threshold، cap و bracket پیاده شوند.
- dependency graph فرمول‌ها چرخه و ورودی تعریف‌نشده را رد کند.

### ۲.۲.۲ دوره، جمعیت و Cutoff

- Payroll Period شمسی و Run عادی/تکمیلی/برگشت ساخته شود.
- جمعیت از Payroll Participation در بازه محاسبه شود.
- Cutoff و Snapshot ورودی‌ها با provenance ثبت شود.
- استثناهای فردی و دروازه کامل‌بودن Run پیاده شوند.

### ۲.۲.۳ موتور محاسبه

- محاسبه به‌ازای هر فرد و مؤلفه، با input، rule version، intermediate value، rounding و result ذخیره شود.
- تناسب eligibility و کسورات attendance مستقل باشند.
- محاسبه دوباره Draft نتیجه قطعی و قابل مقایسه تولید کند.
- تأیید Snapshot را قفل کند.

### ۲.۲.۴ بازبینی و کنترل

- صف اختلاف، missing evidence، تغییر نسبت به دوره قبل و override ساخته شود.
- maker-checker و ممنوعیت self-approval اعمال شود.
- تعدیل دستی reason، evidence، before/after و سطح approval داشته باشد.
- deferral به Supplemental Run با actor و reason انجام شود.

### ۲.۲.۵ وام و مساعده

- obligation، schedule، installment، deduction، pause، adjustment و settlement ساخته شود.
- مبلغ کسرشده به calculation line و obligation مرتبط باشد.
- مانده از ledger محاسبه شود و مستقیم ویرایش نشود.

### ۲.۲.۶ فیش، بانک و حسابداری

- فیش نسخه‌دار از Approved Run تولید و جداگانه release شود.
- self-service فقط فیش خود فرد را برگرداند.
- bank export adapter با validation و audit ساخته شود.
- Accounting handoff با idempotency key، cost-center split و voucher proposal ساخته شود.
- Accounting correction request به Supplemental/Reversal flow متصل شود.

**دروازه پذیرش ۲.۲:** یک Run آزمایشی کامل از جمعیت تا فیش و سند پیشنهادی، قابل بازتولید و بدون ویرایش داده تأییدشده باشد.

## ۲.۳ — عملکرد

### ۲.۳.۱ کاتالوگ و Template

- مقیاس رفتاری پنج‌سطحی و anchors تعریف شود.
- Job Evaluation Template و نسخه‌های آن ساخته شوند.
- Position Evaluation Addendum و نسخه‌های آن ساخته شوند.
- validation مجموع وزن ۱۰۰٪ و سازگاری معیارها اعمال شود.

### ۲.۳.۲ دوره و Snapshot

- Review Cycle، population و deadlineها ساخته شوند.
- ترکیب Job و Position در آغاز دوره Snapshot شود.
- Responsible Supervisor و مسیر delegation/escalation Snapshot شوند.

### ۲.۳.۳ شواهد

- قرارداد provider برای production، quality، attendance، safety و scheduling تعریف شود.
- evidence شامل source، definition، period، extractedAt، version و quality state باشد.
- شواهد در صفحه ارزیابی read-only باشند و اصلاح به سامانه مالک هدایت شود.
- comparisonهای فرد/تیم/خط/شیفت فقط با داده قابل‌مقایسه و permission-safe نشان داده شوند.

### ۲.۳.۴ ارزیابی و بازخورد

- self-assessment از formal review جدا باشد.
- criterion rating، evidence selection، context explanation و overall calculation ذخیره شوند.
- HR moderation فقط با مسیر استثنایی صریح انجام شود.
- نتیجه ارزیابی هیچ پیامد استخدامی یا حقوقی خودکار ایجاد نکند.

### ۲.۳.۵ تأیید دریافت و اعتراض

- acknowledgement، employee response و formal objection وضعیت‌های جدا باشند.
- objection deadline سیاستی باشد.
- تصمیم اعتراض نسخه بازنگری‌شده مرتبط بسازد و اصل را حفظ کند.

**دروازه پذیرش ۲.۳:** یک ارزیابی تاریخی پس از تغییر Job، Position، Supervisor، Template و داده عملیاتی دقیقاً با Snapshot اولیه قابل مشاهده باشد.

## ۲.۴ — مهاجرت و Cutover

- طرح تفصیلی در [PHASE-2-MIGRATION-CUTOVER.md](./PHASE-2-MIGRATION-CUTOVER.md) اجرا شود.
- ماتریس QA در [PHASE-2-QA.md](./PHASE-2-QA.md) برای هر دروازه امضا شود.
- دو دوره موازی کامل و یک دوره زنده تطبیق‌شده الزامی است.
- پنجره بازگشت و Break-glass پیش از Cutover rehearsal شود.

## ترتیب وابستگی

1. مرجع Personnel و Employment Relationship
2. Schedule/Leave/Overtime و permission boundary
3. Payroll Participation و Compensation Agreement
4. Payroll policy، periods و calculation
5. Payslip، bank و Accounting handoff
6. Parallel runs و Cutover

Performance پس از تثبیت بندهای ۱ و ۲ می‌تواند هم‌زمان با مراحل ۴ تا ۶ توسعه یابد.

## الزام تست و مستندسازی هر تغییر

- migration test و rollback rehearsal
- unit test برای قواعد خالص و تاریخ/تقویم
- integration test با PostgreSQL برای constraint و transaction
- authorization matrix test برای همه endpointها
- snapshot/recalculation regression test
- browser QA در RTL، mobile و desktop
- audit-log assertion برای عملیات حساس
- reconciliation report برای هر import و Payroll Run
- به‌روزرسانی CONTEXT.md و ADR فقط هنگام تصمیم دامنه یا معماری جدید
