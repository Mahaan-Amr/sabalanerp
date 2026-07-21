# ماتریس QA و پذیرش فاز ۲ منابع انسانی

## روش استفاده

هر مورد باید دارای نتیجه، محیط، build/commit، شواهد و نام تأییدکننده باشد. موارد بحرانی پیش از عبور از دروازه فاز باید موفق باشند. تست UI هرگز جایگزین تست مجوز API نیست.

## ۱. مرجع واحد پرسنلی — بحرانی

- [ ] ایجاد و ویرایش عادی Personnel فقط از HR انجام می‌شود.
- [ ] مسیر قدیمی پس از انتقال قابلیت، write جدید را رد می‌کند.
- [ ] تغییر نام، User link، Assignment و Schedule در همه مصرف‌کنندگان یک حقیقت را نشان می‌دهد.
- [ ] Personnel بدون User و User بدون Personnel مطابق سیاست پشتیبانی می‌شوند.
- [ ] duplicate ملی/پرسنلی و identity-incomplete به‌درستی تفکیک می‌شوند.
- [ ] migration دوباره‌اجراشدنی است و source provenance حفظ می‌شود.

## ۲. Employment و Payroll Participation — بحرانی

- [ ] روابط استخدامی هم‌پوشان برای یک Personnel رد می‌شوند.
- [ ] Payroll Participation خارج از رابطه استخدامی رد می‌شود.
- [ ] Participation هم‌پوشان در یک رابطه رد می‌شود.
- [ ] شروع/پایان میان‌دوره جمعیت و روزهای eligibility درست می‌سازد.
- [ ] Personnel.isActive، User، roster و attendance جمعیت حقوق را تغییر نمی‌دهند.
- [ ] rehire از رابطه و Participation جدید استفاده می‌کند.
- [ ] suspension مطابق نسخه سیاست عمل می‌کند و نتیجه قابل توضیح است.

## ۳. Compensation — بحرانی

- [ ] Compensation Agreementهای حاکم هم‌پوشان رد می‌شوند.
- [ ] همه مبالغ authoritative با واحد ریال نمایش و ذخیره می‌شوند.
- [ ] نمایش کمکی تومان هیچ payload محاسباتی تولید نمی‌کند.
- [ ] Assignment ثانویه base salary دوم ایجاد نمی‌کند.
- [ ] allowance وابسته به Assignment فقط در بازه معتبر اعمال می‌شود.
- [ ] نسخه جدید سابقه قبلی را تغییر نمی‌دهد.

## ۴. Schedule، Leave و Overtime — بحرانی

- [ ] Applicable/Combined Expected Schedule برای هر تاریخ قطعی است.
- [ ] تعارض برنامه با جزئیات و راه اصلاح مشخص، ذخیره را رد می‌کند.
- [ ] حضور نهایی Snapshot برنامه حاکم را حفظ می‌کند.
- [ ] Leave تأییدنشده وارد حقوق نمی‌شود.
- [ ] Leave مصرف‌شده از ledger و expected schedule محاسبه می‌شود.
- [ ] Overtime خام یا Candidate در انتظار وارد حقوق نمی‌شود.
- [ ] رد یا اصلاح Overtime شواهد ورود/خروج را حذف نمی‌کند.
- [ ] missing exit و attendance exception استثنای مسدودکننده می‌سازند.

## ۵. Policy و Rule Engine — بحرانی

- [ ] نسخه Draft پیش از تأیید قابل استفاده در Payroll Run نیست.
- [ ] Payroll Policy Owner نمی‌تواند بدون reviewer مستقل نسخه را فعال کند.
- [ ] source و effective date برای parameter قانونی الزامی است.
- [ ] dependency cycle و input تعریف‌نشده رد می‌شود.
- [ ] fixed، rate×quantity، percent، threshold، cap و bracket تست مرزی دارند.
- [ ] rounding و ترتیب عملیات برای هر نسخه deterministic است.
- [ ] اجرای دوباره با Snapshot یکسان نتیجه کاملاً یکسان می‌دهد.

## ۶. Payroll Run — بحرانی

- [ ] دوره شمسی و مرز روزها مستقل از timezone ثابت می‌مانند.
- [ ] جمعیت از Participation استخراج و Snapshot می‌شود.
- [ ] proration و attendance deductions یک زمان را دوبار کم نمی‌کنند.
- [ ] فرد مسدود، پیشرفت review سایر افراد را متوقف نمی‌کند.
- [ ] Run تا resolve یا deferral صریح همه افراد تأیید نمی‌شود.
- [ ] deferral actor، reason و Supplemental link دارد.
- [ ] سازنده/ویرایشگر مادی نمی‌تواند تأییدکننده نهایی باشد.
- [ ] Approved Run در API و database غیرقابل‌ویرایش است.
- [ ] correction فقط Supplemental یا Reversal مرتبط می‌سازد.
- [ ] transition تکراری به Accounting اثر مالی مضاعف ایجاد نمی‌کند.

## ۷. Adjustment، Loan و Advance

- [ ] adjustment دستی reason، evidence و before/after دارد.
- [ ] adjustment پراثر reviewer مستقل می‌خواهد.
- [ ] deduction وام به obligation و installment متصل است.
- [ ] مانده از ledger به‌دست می‌آید و مستقیم ویرایش نمی‌شود.
- [ ] pause، adjustment و settlement تاریخچه را حفظ می‌کنند.
- [ ] reversal کسر، اصل transaction را حذف نمی‌کند.

## ۸. Payslip، Bank و Accounting — بحرانی

- [ ] فیش پیش از release برای Employee قابل مشاهده نیست.
- [ ] Employee فقط فیش خودش را می‌بیند.
- [ ] کاربر Payroll مجاز می‌تواند فیش فرد بدون User را تولید کند.
- [ ] Supplemental/Reversal فیش مرتبط جدید می‌سازد.
- [ ] bank export واحد، جمع، قالب و checksumهای موردنیاز را کنترل می‌کند.
- [ ] export و download audit event می‌سازند.
- [ ] Accounting فقط summary و voucher proposal را می‌بیند.
- [ ] Accounting نمی‌تواند calculation line را ویرایش کند.
- [ ] cost-center totals با assignment snapshots تطبیق دارند.
- [ ] posted/paid/reconciled state با Accounting و bank evidence سازگار است.

## ۹. محرمانگی و دسترسی — بحرانی

- [ ] HR view عمومی salary، bank، payslip یا loan را نمی‌بیند.
- [ ] Supervisor بدون scope جدا compensation را نمی‌بیند.
- [ ] Payroll Processor و Approver دسترسی‌های متمایز دارند.
- [ ] Policy Owner و reviewer نمی‌توانند self-approve کنند.
- [ ] Accounting به employee calculation detail غیرضروری دسترسی ندارد.
- [ ] ADMIN عادی separation of duties را دور نمی‌زند.
- [ ] view، download، export و change حساس audit می‌شوند.
- [ ] audit log actor، time، purpose، entity و before/after لازم را دارد.

## ۱۰. Performance Template و Cycle — بحرانی

- [ ] Job template بدون نسخه قابل فعال‌سازی نیست.
- [ ] Position addendum فقط معیارهای مجاز را اضافه می‌کند.
- [ ] وزن Snapshot دقیقاً ۱۰۰٪ است.
- [ ] تغییر بعدی Job/Position/Template ارزیابی فعال یا تاریخی را تغییر نمی‌دهد.
- [ ] Responsible Supervisor بر اساس assignment مؤثر دوره حل و Snapshot می‌شود.
- [ ] delegation/escalation actor و reason دارد.
- [ ] self-assessment از formal review قابل تشخیص است.

## ۱۱. Performance Evidence و Scoring — بحرانی

- [ ] evidence فقط از provider مالک دریافت می‌شود.
- [ ] evidence در evaluation UI قابل ویرایش نیست.
- [ ] source، period، definition، extraction time و version ذخیره می‌شود.
- [ ] missing/stale/disputed/corrected data برچسب آشکار دارد.
- [ ] operational number به‌صورت خودکار rating نمی‌سازد.
- [ ] Supervisor می‌تواند context خارج از کنترل فرد را توضیح دهد.
- [ ] comparison فرد/تیم/خط/شیفت فقط برای داده comparable و مجاز نمایش داده می‌شود.
- [ ] overall score با criterion، weight، evidence و explanation قابل بازسازی است.
- [ ] rating هیچ پیامد payroll/employment خودکار ایجاد نمی‌کند.

## ۱۲. Acknowledgement و Objection — بحرانی

- [ ] acknowledgement به معنی agreement ذخیره نمی‌شود.
- [ ] employee response از formal objection جدا است.
- [ ] objection deadline سیاستی enforce می‌شود.
- [ ] اعتراض اصل review را حذف یا ویرایش نمی‌کند.
- [ ] نتیجه اعتراض revised version مرتبط با actor و reason می‌سازد.
- [ ] employee و نقش‌های مجاز تاریخچه کامل را مطابق scope می‌بینند.

## ۱۳. Migration و Parallel Run — بحرانی

- [ ] Dry Run هیچ write ندارد.
- [ ] Apply تکراری duplicate ایجاد نمی‌کند.
- [ ] تاریخ ناشناخته جعل نمی‌شود.
- [ ] مبلغ مبهم ریال/تومان رد می‌شود.
- [ ] opening balances منبع و approval دارند.
- [ ] فایل تاریخی فقط‌خواندنی باقی می‌ماند.
- [ ] دو دوره موازی کامل اجرا و در سطح component/person/accounting تطبیق شده‌اند.
- [ ] اختلاف بحرانی باز وجود ندارد.
- [ ] اختلاف مادی پذیرفته‌شده owner، reason و sign-off دارد.

## ۱۴. Cutover و Break-glass — بحرانی

- [ ] سامانه جدید در Cutover تنها نویسنده عادی است.
- [ ] Legacy write برای کاربران عادی در UI و API مسدود است.
- [ ] planned break-glass دو approver مستقل می‌خواهد.
- [ ] emergency access فقط technical administrator نام‌گذاری‌شده دارد.
- [ ] emergency access کمینه و چهار ساعت بعد خودکار منقضی می‌شود.
- [ ] همه فعالیت‌ها کامل audit می‌شوند.
- [ ] بازبینی هر دو approver تا پایان روز کاری بعد انجام می‌شود.
- [ ] تا reconciliation کامل تغییرات Legacy، normal operation باز نمی‌گردد.
- [ ] پنجره ۳۰روزه فقط پس از approve/post/pay/reconcile اولین Run زنده آغاز می‌شود.
- [ ] حذف فنی Legacy با امضای HR Payroll، Accounting و System Owner انجام می‌شود.

## ۱۵. کیفیت فنی و تجربه کاربری

- [ ] Prisma validation، migration deploy rehearsal و restore موفق است.
- [ ] backend build/lint و frontend build/lint موفق‌اند.
- [ ] unit/integration/authorization/regression suites موفق‌اند.
- [ ] هیچ endpoint مالی از `any role` یا hidden UI به‌عنوان authorization استفاده نمی‌کند.
- [ ] تاریخ‌های شمسی در frontend، API، database و export یک روز را نشان می‌دهند.
- [ ] رابط RTL در عرض‌های ۳۶۰، ۷۶۸، ۱۲۸۰ و ۱۹۲۰ پیکسل قابل استفاده است.
- [ ] loading، empty، error، conflict، locked و success states روشن‌اند.
- [ ] محاسبه و گزارش Run با حجم واقعی در SLA مصوب اجرا می‌شود.

## امضاهای پذیرش

| دروازه | HR | Payroll | Accounting | Security/Operations | System Owner |
|---|---|---|---|---|---|
| پایان ۲.۱ | لازم | لازم | اطلاع | لازم | لازم |
| پایان ۲.۲ و شروع Parallel | اطلاع | لازم | لازم | لازم | لازم |
| پایان ۲.۳ | لازم | اطلاع | اطلاع | حسب شواهد | لازم |
| Cutover | لازم | لازم | لازم | لازم | لازم |
| پایان پنجره بازگشت | لازم | لازم | لازم | اطلاع | لازم |
