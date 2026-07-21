'use client';

import Link from 'next/link';
import { FaLock } from 'react-icons/fa';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function RegisterPage() {
  return <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4" dir="rtl">
    <div className="absolute left-5 top-5"><ThemeToggle /></div>
    <section className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-white shadow-2xl backdrop-blur">
      <FaLock className="mx-auto mb-5 h-10 w-10 text-teal-300" />
      <h1 className="text-2xl font-bold">ثبت‌نام عمومی غیرفعال است</h1>
      <p className="mt-3 leading-7 text-slate-300">حساب‌های سبلان ERP فقط توسط مدیر سیستم یا مدیر مجاز ساخته می‌شوند.</p>
      <Link href="/login" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-teal-500 px-5 font-semibold text-slate-950 hover:bg-teal-400">بازگشت به ورود</Link>
    </section>
  </main>;
}
