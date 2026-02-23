# Text Repair Review Sheet

## Scope of this pass
- `frontend/src/app/dashboard/page.tsx`
- `backend/src/services/contractConfirmationService.ts`
- `backend/src/routes/products.ts`
- `backend/prisma/schema.prisma`

## Repaired examples (for product validation)

### Dashboard UI
- `خوش آمدید به داشبورد سبلان ERP`
- `پیش نویس`
- `هنوز داده‌ای برای نمایش وجود ندارد`
- `تنظیم مجوزها و دسترسی‌های کاربران`
- `افزودن مشتری جدید`

### Confirmation flow API messages
- `قرارداد یافت نشد`
- `لینک تایید معتبر نیست`
- `این لینک دیگر قابل استفاده نیست`
- `مهلت لینک تایید به پایان رسیده است`
- `کد تایید اشتباه است`
- `تعداد تلاش‌های مجاز به پایان رسیده است`

### Products Excel import/export messages
- `کد محصول`
- `نوع برش`
- `توضیحات`
- `وارد کردن محصولات تکمیل شد`
- `خطا در تولید قالب Excel`
- `خطا در وارد کردن فایل Excel`

### Prisma defaults/comments
- Currency defaults normalized to:
  - `تومان`
  - `ریال`
- Country defaults normalized to:
  - `ایران`

## Remaining work
- Run a full contextual pass on remaining `???` placeholders from:
  - `reports/text-corruption-inventory.json`
  - `reports/text-corruption-inventory.csv`
- Validate domain wording consistency across CRM/Security/Inventory pages.
