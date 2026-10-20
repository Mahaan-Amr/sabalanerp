# نتیجه اجرای محلی اتصال حضور و غیاب — ۲۰۲۶/۱۰/۱۵

تغییرات روی پروژه موجود `sabalanerp-local` اجرا شده‌اند؛ backend و frontend سالم‌اند. دو مهاجرت جدید فقط به PostgreSQL همین پروژه اعمال شده‌اند. هیچ تغییر یا استقراری روی سرور ابری، تماس/تغییری روی دستگاه واقعی، نصب روی ویندوز نگهبانی، commit یا push انجام نشده است.

## قابلیت‌های قابل بررسی

- صفحه حضور و غیاب گارد: `/dashboard/security/attendance`، همراه هشدار بررسی، شواهد نام‌دار، ترددهای مبهم، تأیید نسخه‌دار، صفحه‌بندی و تحویل مسئول پیگیری.
- مدیریت اتصال: `/dashboard/hr/attendance-devices`، برای چهار گروه مجاز؛ اتصال تاریخ‌دار، وضعیت اولیه، عضویت صریح فهرست گارد، حالت مقایسه‌ای و توقف/ازسرگیری.
- ثبت دستی پرسنل حفظ شده است؛ ثبت حضور خود نگهبان‌ها و شروع مسئولیت شیفت همچنان دستی‌اند. دستگاه حضور آنان را خودکار ثبت نمی‌کند.
- خروج واقعاً نامعلوم با دلیل و بدون ساعت حدسی قابل ثبت است؛ ورود بعدی ممکن و مدت قبلی نامعلوم باقی می‌ماند. تأییدنشدن یا نامعلوم‌بودن در نمایش و گزارش مشخص می‌شود.
- دریافت‌کننده ویندوز در `apps/attendance-connector-windows` آماده بررسی است؛ اعتبار مستقل دستگاه، فقط خواندن لاگ، صف اتمی و ارسال مجدد دارد. اجرای آن روی ویندوز/SDK واقعی در این کار انجام نشده است.

## شواهد آزمون

| بررسی | نتیجه |
| --- | --- |
| `npm run test:attendance-device:local` | ۱ آزمون سطح مجاز SDK + ۱۷ آزمون پایگاه‌داده/HTTP موفق |
| رگرسیون گزارش کارکرد، خلاصه حضور و گزارش روزانه | ۳ فایل آزمون موفق؛ شامل وضعیت مدت نامعلوم و تردد تأییدنشده |
| آزمون مرورگر جدید روی Docker محلی | موفق: نمایش خودکار رویداد HTTP شبیه‌سازی‌شده زیر ۵ ثانیه از زمان مصنوعی اسکن، تأیید نگهبان، عدم تکرار، کنارگذاشتن کد، موبایل، دسترس‌پذیری و بزرگ‌نمایی ۲۰۰٪ |
| رگرسیون مرورگر گارد و گزارش‌ها | ۳ آزمون مرجع موفق، در کنار آزمون جدید مجموعاً ۴ آزمون |
| `npm run test:design-system-foundation` | ۲۵ آزمون موفق |
| `npm run test:design-system-adoption` | ۱۴ آزمون موفق |
| `npm run design-system:check` | بدون تخلف جدید |
| `npm run architecture:check` | موفق؛ PrismaClient مشترک حفظ شده است |
| ساخت frontend و backend | موفق؛ آخرین backend در تصویر Docker محلی ساخته و اجرا شده است |
| `npm run docker:verify` | در انتظار سلامت ClamAV متوقف شد؛ ClamAV پیش از این کار نیز unhealthy بود. backend/frontend/PostgreSQL/Redis سالم‌اند؛ تعمیر آنتی‌ویروس خارج از دامنه انجام نشد. |

فرمان مرورگر برای مسیرهای مرتبط:

```sh
npm run test:design-system:e2e -- attendance-device.spec.ts reference-surfaces.spec.ts --grep 'local machine delivery|Guard renders|Guard attendance and vehicle|Guard personnel worktime'
```

لاگ‌های این اجرا در `.codex-tmp/attendance/` و تصاویر/traceهای مرورگر در `test-results/design-system/` نگهداری شده‌اند و وارد تغییرات منبع نمی‌شوند. fixture آزمون از داده واقعی جداست و پس از آزمون پاک‌سازی یا rollback می‌شود؛ آزمون مرورگر با انتخاب دستگاه اختصاصی خود، وجود دستگاه‌های دیگر را مجاز می‌داند.

## محدودیت و مرحله بعد

ثبت خودکار ۲۲ نفر واقعی فعال نشده است؛ نگاشت به شناسه ثابت واقعی پرونده‌ها و وضعیت اولیه باید در راه‌اندازی تأیید شود. تست زیر پنج ثانیه، آزمون HTTP و مرورگر محلی است و زمان واقعی خواندن SDK و شبکه شرکت را اثبات نمی‌کند. آزمون مقایسه‌ای مجاز روی ویندوز/دستگاه واقعی، صحت منطقه زمانی، شروع مجدد میزبان، قطع/وصل و تأخیر واقعی همچنان پیش‌شرط فعال‌سازی عملیاتی‌اند. داده قدیمی دستگاه خودکار به حضور عملیاتی وارد نمی‌شود.

## Confirmed local redesign — 2026-10-17

- One personnel-card list is the daily Guard surface, including roster members without device mappings. Device management and mapping disconnection remain in HR device management.
- Reviewed setup state is labeled as an initial state, separate from an actual movement. The initial-state action disappears once known; changing setup later remains a management operation.
- Per-person review, selected ordinary interval confirmation, pending filtering and reason/assignee handover are retained. Device evidence retains personnel name and raw time. Manual correction opens a centered modal and requires an audit reason.
- Unknown manual entry uses nullable `enteredAt` with `observedInsideAt` as observation evidence only. No duration is calculated from observation time. A subsequent actual manual exit is supported. Known intervals contribute their minutes; unknown intervals mark the report incomplete.
- Existing personnel worktime report, PDF styles/fonts/A4 sizing/pagination/generation options and ADMIN/MANAGER + Guard ADMIN report authorization remain unchanged.
- A device event may retain a corrected time and clock evidence only when the sample is within two minutes of receipt and corrected occurrence, with uncertainty at most ±15 seconds and offset bounded to five minutes. Raw event identity/time is immutable; replay never recalculates prior evidence. Stale/missing/invalid clock data requires review in future ACTIVE mode. This is distinct from the under-five-second display target.
- Local migration: `20261017100000_attendance_review_and_clock`. It preserves the attendance advisory lock and overlap guard while allowing genuinely unknown entry times.
- The real terminal remains SHADOW with no activation timestamp. No device/cloud changes or Git push are authorized by this implementation.

### Redesign acceptance evidence

- Local-only device suite: 25 DB/HTTP cases plus the Windows read-only SDK surface check passed. Cases include immutable clock correction (device ahead/behind), ±15-second limit, stale/invalid samples, corrected-time duplicate confirmation blocking, unknown entry/manual checkout/correction, report authority and rollback/cleanup.
- Report/summary regressions: 3 suites passed; mixed known/unknown intervals preserve the 120-minute known subtotal and mark the result incomplete.
- Clock display tests include expiry, absent/invalid samples and the exact 15,000/15,001 ms boundary.
- Design System foundation 25 and adoption 14 checks passed; architecture ownership and adoption checks passed. Frontend production build and backend Docker build passed. Existing unrelated React-hook warnings remain.
- Browser acceptance: 3 dedicated redesign scenarios passed with normal tracing; 4 related Guard/report reference scenarios passed with tracing disabled. The combined trace-retaining run passed its assertions but stalled during trace teardown and was interrupted; that attempt and its artifacts are retained under `.codex-tmp/attendance/redesign`. This did not alter production code or suppress behavioral assertions.
- PDF verification: unchanged style/font/layout/pagination/generation source sections; ordinary 28-day example produced three pixel-identical pages before/after. Mixed unknown-entry example rendered with the existing overflow guard, 120 known minutes on its incomplete day and provisional labeling.
- Existing operational baseline at implementation start: 813 attendance records (`ddec21c1b3d410d42811f4b78d3a6237`) and 829 intervals (`242f2f7cf3c5406f3bcaa0eff5699add`, excluding the new null observation column). Rechecked unchanged after isolated tests. Real terminal remains SHADOW, never activated, 17 INSIDE setup mappings and excluded code 12 unchanged; real comparison/unmatched evidence has no operational interval link.
- No fresh physical scan, remote deployment, device configuration change, Windows reader replacement or Git push was performed. The under-five-second browser case uses a simulated local machine event and is not a new physical-device timing measurement.
