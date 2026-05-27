import Link from 'next/link';

export function PublicFooter() {
  return (
    <footer className="border-t border-stone-200 bg-white">
      <div className="public-container py-10">
        <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <div className="mb-4 flex items-center gap-3">
              <span className="public-brand-mark">س</span>
              <div>
                <p className="font-extrabold text-stone-950">سبلان ERP</p>
                <p className="text-sm text-stone-500">پلتفرم رسمی عملیات دیجیتال سنگ سبلان</p>
              </div>
            </div>
            <p className="max-w-xl leading-8 text-stone-600">
              سامانه ای برای ثبت دقیق قراردادها، مدیریت مشتریان پروژه ای، برنامه ریزی تحویل و کنترل دسترسی در جریان عملیاتی سنگ سبلان.
            </p>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-bold text-stone-950">دسترسی سریع</h2>
            <div className="flex flex-col gap-2 text-sm text-stone-600">
              <Link href="/about" className="hover:text-teal-700">درباره سامانه</Link>
              <Link href="/contact" className="hover:text-teal-700">تماس و پشتیبانی</Link>
              <Link href="/login" className="hover:text-teal-700">ورود کاربران</Link>
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-bold text-stone-950">اعتماد و دسترسی</h2>
            <p className="text-sm leading-7 text-stone-600">
              دسترسی به بخش های عملیاتی فقط برای کاربران مجاز سازمانی فعال است. تایید قرارداد از طریق لینک اختصاصی پیامک انجام می شود.
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-4 border-t border-stone-200 pt-6 text-sm text-stone-500 sm:flex-row sm:items-center sm:justify-between">
          <p>تمامی حقوق برای سبلان ERP محفوظ است.</p>
          <a
            referrerPolicy="origin"
            target="_blank"
            rel="noreferrer"
            href="https://trustseal.enamad.ir/?id=710761&Code=Smq9kxRtFbt6sCjdJFD2B7AUKdMzIIN9"
            className="inline-flex w-fit"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              referrerPolicy="origin"
              src="https://trustseal.enamad.ir/logo.aspx?id=710761&Code=Smq9kxRtFbt6sCjdJFD2B7AUKdMzIIN9"
              alt="نماد اعتماد الکترونیکی"
              className="h-16 w-auto"
            />
          </a>
        </div>
      </div>
    </footer>
  );
}
