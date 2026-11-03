'use client';
import Link from 'next/link';
import { FaLock } from 'react-icons/fa';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function RegisterPage() {
  return <main className="sds-workspace flex min-h-screen items-center justify-center bg-[var(--sds-surface-raised)] p-4" dir="rtl">
    <div className="absolute left-5 top-5"><ThemeToggle /></div>
    <section className="w-full max-w-md rounded-2xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-8 text-center text-[var(--sds-text-primary)] shadow-2xl backdrop-blur">
      <FaLock className="mx-auto mb-5 h-10 w-10 text-[var(--sds-accent)]" />
      <h1 className="text-2xl font-bold">ثبت‌نام عمومی غیرفعال است</h1>
      <p className="mt-3 leading-7 text-[var(--sds-text-muted)]">حساب‌های سبلان ERP فقط توسط مدیر سیستم یا مدیر مجاز ساخته می‌شوند.</p>
      <Link href="/login" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-[var(--sds-accent)] px-5 font-semibold text-[var(--sds-text-inverse)] hover:bg-[var(--sds-accent-surface)]">بازگشت به ورود</Link>
    </section>
  </main>;
}
