# فهرست نویسندگان و مصرف‌کنندگان Personnel در ۲.۱

این فهرست مرز سازگاری نخستین بسته ۲.۱ را ثبت می‌کند. قاعده حاکم این است که `User` هویت دسترسی و `Personnel` هویت نیروی انسانی است؛ ساخت حساب نباید به‌طور ضمنی پرونده نیروی انسانی بسازد یا آن را تغییر دهد.

## نویسندگان

| مسیر | وضعیت پیشین | وضعیت این بسته | مسیر هدف |
|---|---|---|---|
| `/api/hr/personnel` | ایجاد و ویرایش Personnel در HR | نویسنده متعارف و یگانه | بدون تغییر |
| `/api/hr/personnel/:id/work-schedule` | وجود نداشت | مشاهده و ثبت مستقیم نسخه جدید با مجوز صریح مدیریت برنامه کار پرسنل؛ بدون گردش تأیید | مرجع برنامه کاری تا تکمیل مدل Assignment/Schedule در ۲.۱.۴ |
| `/api/personnel` | ایجاد، ویرایش و حذف مستقل | نوشتن با `410 LEGACY_PERSONNEL_WRITE_DISABLED` مسدود؛ خواندن موقتاً برقرار | حذف پس از مهاجرت آخرین مصرف‌کننده |
| `/api/users` | ساخت/ویرایش ضمنی Personnel و برنامه کاری | فقط اتصال صریح به Personnel موجود؛ `none` یعنی بدون اتصال | اتصال حساب از جریان کنترل‌شده HR در بسته بعدی |
| `/api/auth/register` | ساخت خودکار Personnel همراه User | فقط User می‌سازد | HR بعداً پرونده را می‌سازد یا متصل می‌کند |

حالت قدیمی `personnelMode=auto` صریحاً رد می‌شود تا کلاینت قدیمی تصور نکند Personnel ساخته شده است. ارسال `workSchedule` به User API نیز با خطای مالکیت HR رد می‌شود.

## مصرف‌کنندگان

| مصرف‌کننده | خواندن فعلی | تصمیم انتقال | وضعیت |
|---|---|---|---|
| صفحه HR Personnel | `/api/hr/personnel` | مرجع اصلی UI و API | منتقل‌شده |
| صفحه قدیمی Personnel | `/dashboard/personnel` | redirect به HR | منتقل‌شده؛ مسیر سازگار باقی است |
| User management | خواندن `/api/personnel` برای اتصال حساب موجود | در بسته بعدی endpoint محدود جست‌وجوی linkable Personnel در HR افزوده شود | سازگاری موقت |
| Security attendance | حل برنامه از `PersonnelWorkSchedule` در backend | در ۲.۱.۴ به resolver برنامه قابل‌اعمال HR منتقل و Snapshot حضور حفظ شود | در انتظار ۲.۱.۴ |
| User detail/list | include رابطه Personnel برای نمایش | فقط read model؛ هیچ نوشتنی مجاز نیست | سازگاری موقت |
| داده قدیمی Department | `Personnel.departmentId` و `User.departmentId` | نگاشت به Organizational Unit/Assignment و گزارش تطبیق | در انتظار migration کنترل‌شده |

## کنترل‌های خروج از سازگاری

- جست‌وجوی کد باید نشان دهد تمام `personnel.create/update/delete`های عملیاتی فقط در router منابع انسانی هستند.
- کلاینت frontend برای `/api/personnel` فقط متدهای خواندن دارد.
- تغییر برنامه کاری فقط از صفحه HR و endpoint دارای مجوز صریح «مدیریت برنامه کار پرسنل» برای HR Processor، HR Manager، Company Manager یا ADMIN انجام می‌شود و به تأیید شخص دیگری نیاز ندارد.
- قبل از حذف GET قدیمی، User management باید به endpoint محدود و permission-safe منتقل شود.
- قبل از تغییر resolver گارد، اختلاف برنامه جاری و برنامه هدف برای داده واقعی گزارش و رفع شود.

## موارد عمداً باقی‌مانده

این بسته هنوز مدل کامل effective-dated Schedule وابسته به Assignment، Payroll Participation، Compensation Agreement یا کاتالوگ‌های Employment/Contract Type را نمی‌سازد. افزودن سریع این مدل‌ها در یک migration بزرگ، امکان تطبیق و rollback مرحله‌ای را از بین می‌برد؛ آن‌ها طبق ترتیب ۲.۱.۲ تا ۲.۱.۴ تحویل می‌شوند.
