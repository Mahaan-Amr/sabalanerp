# Continue SabalanERP on the new Windows PC

این شاخه، نقطهٔ ورود برای ادامهٔ کدنویسی است. داده‌ها و بکاپ‌ها را کاربر جداگانه بازیابی می‌کند. این انتقال، اعلام آمادگی برای production نیست.

## دریافت

در PowerShell پی‌سی جدید، یک پوشهٔ تازه انتخاب کنید؛ clone موجود را بازنویسی نکنید.

```powershell
git clone --branch codex/pc-transfer-20261103/continue --recurse-submodules https://github.com/Mahaan-Amr/sabalanerp.git C:\dev\sabalanerp-continuation
Set-Location C:\dev\sabalanerp-continuation
git status --short --branch
git submodule status
```

اگر از clone موجود استفاده می‌کنید، ابتدا تغییرات محلی‌اش را حفظ کنید و سپس شاخه‌ها را با fetch دریافت کنید؛ reset یا clean لازم نیست.

## انتخاب مسیر ادامه

- آخرین کد منتشرشدهٔ PR426 هنگام ثبت این انتقال: `478607bb3a0a78a9abc2e75f42e002cdcd96e769`. این شاخهٔ ورودی بر همان مبناست و تغییرات نامرتبط را با هم ادغام نمی‌کند.
- ادامهٔ محلی تیکت #419 (native C3): `codex/pc-transfer-20261103/issue-419`.
- پیش‌نویس‌های phase1 و lease مربوط به #419: `codex/pc-transfer-20261103/issue-419-phase1`.
- نامزد بررسی‌شدهٔ مهاجرت‌های PR426 از commit محلی 1a9d940e: `codex/pc-transfer-20261103/pr426-candidate`.
- کدهای کنترل و تست اخیر که بیرون مخزن بودند: `codex/pc-transfer-20261103/pr426-control-drafts`، پوشهٔ `handoff-local-source/pr426-control`. مسیرهای میزبان قدیمی در این پیش‌نویس‌ها هنوز نیازمند بازبینی هستند.
- همهٔ snapshotهای دیگر، کدهای stashها و دو وضعیت staged در `TRANSFER-MANIFEST.json` فهرست شده‌اند. برای انتخاب شاخه، توضیح `handoff/SNAPSHOT.md` آن را بخوانید.

برای ادامهٔ #419، پس از clone تمیز:

```powershell
git switch -c codex/continue-419 --track origin/codex/pc-transfer-20261103/issue-419
git submodule update --init --recursive
```

روی snapshotها مستقیم merge یا deploy نکنید. برخی snapshotها متعلق به دوره‌های قدیمی و بعضی شامل کار نیمه‌تمام و حذف‌های محلی هستند. تغییرات لازم باید در شاخهٔ ادامه بررسی و یکپارچه شوند. تاریخچهٔ منتشرنشدهٔ آلوده به آرشیو و dump با سابقهٔ اصلی push نشده؛ کدِ وضعیت‌های انتخاب‌شده به commitهای تازه منتقل شده است. اصل کارها روی سیستم قدیمی محفوظ است.

## تیکت‌ها و وضعیت کار

- Spec اصلی: https://github.com/Mahaan-Amr/sabalanerp/issues/408
- مرحلهٔ محلی bootstrap: https://github.com/Mahaan-Amr/sabalanerp/issues/419
- استعلام بازیابی‌شده: https://github.com/Mahaan-Amr/sabalanerp/issues/411
- مراحل بعدی: #420، #421، #422، #423، #424؛ ترتیب و پیش‌نیازها را از متن و commentهای خود تیکت‌ها بخوانید.
- PR حسابداری و یکپارچه‌سازی: https://github.com/Mahaan-Amr/sabalanerp/pull/426

پیشرفت کد و تستِ محلی، تکمیل این تیکت‌ها یا مجوز production نیست. کار متوقف‌شدهٔ #419 و وضعیت‌های UNKNOWN میزبان قبلی با این انتقال بسته یا حل‌شده محسوب نمی‌شوند. اتوماسیون pr426 به درخواست کاربر حذف شده و نباید خودکار احیا شود.

در شاخهٔ نامزد PR426، مسیر CLI چهارده migration، کنترل pendingها، baseline و کنترل نگهداری/مالکیت و بستهٔ ازپیش‌ساخته‌شده آماده‌سازی شده بود. شواهد محیط قدیم منتقل نمی‌شوند و باید برای میزبان جدید دوباره تولید شوند. کد کنترل مستقل در شاخهٔ drafts، نمونهٔ fake-adapter و طراحی تست دارد؛ اجرای کامل محیط جدید و release نهایی هنوز اثبات نشده‌اند.

## محیط جدید

فایل‌های env واقعی، رمزها، کلیدهای backup/restore و اطلاعات سرور وارد GitHub نشده‌اند. فقط از templateهای خود پروژه استفاده کنید و مقادیر محلی جدید بسازید؛ اطلاعات لازم برای دسترسی سرور یا سرویس‌های بیرونی را جداگانه و امن تأمین کنید. نصب آخرین نسخهٔ ابزار، به‌تنهایی سازگاری نسخه‌های پروژه را اثبات نمی‌کند.

AGENTS.md، CONTEXT.md، ADR-0039 و docs/operations/zero-data-loss-deployment.md را مبنا قرار دهید. برای runtime فقط پروژهٔ موجود sabalanerp-local با docker-compose.local.yml؛ پیش از هر Docker action، ابتدا compose ps. پیش از شروع سرویس یا migration، هویت دیتابیس محلی بازیابی‌شده را بررسی کنید. این راهنما هیچ فرمان خودکار migration، deploy یا restore اجرا نمی‌کند.

کپی history چت‌های Codex برای دریافت کد لازم نیست. به عامل جدید بگویید همین فایل، TRANSFER-MANIFEST.json و متن و commentهای #408/#419 و PR426 را بخواند، شاخهٔ مربوط را انتخاب کند و مجوزها و runtime قدیمی را معتبر فرض نکند.
