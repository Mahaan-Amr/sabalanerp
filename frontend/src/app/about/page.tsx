import Link from 'next/link';
import { FaChartLine, FaFileContract, FaShieldAlt, FaUsers } from 'react-icons/fa';

export default function AboutPage() {
  return (
    <div className="min-h-screen px-4 py-8 text-primary">
      <header className="glass-liquid-card step-content-card mx-auto max-w-6xl p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="flex items-center gap-3">
            <FaChartLine className="h-8 w-8 text-silver-600" />
            <span className="text-2xl font-bold">سبلان ERP</span>
          </Link>
          <nav className="flex flex-wrap gap-3">
            <Link href="/contact" className="glass-liquid-btn">تماس با ما</Link>
            <Link href="/login" className="glass-liquid-btn-primary px-6 py-3">ورود</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl py-10">
        <section className="mb-8">
          <h1 className="mb-4 text-4xl font-bold">درباره سبلان ERP</h1>
          <p className="max-w-3xl text-lg leading-9 text-secondary">
            سبلان ERP سامانه‌ای برای مدیریت فرآیندهای سازمانی، فروش، قراردادها، موجودی، منابع انسانی و گزارش‌های مدیریتی است.
            این سامانه برای ثبت دقیق عملیات، کنترل دسترسی کاربران و ایجاد مسیر قابل پیگیری برای تایید قراردادها طراحی شده است.
          </p>
        </section>

        <section className="grid gap-6 md:grid-cols-3">
          <article className="glass-liquid-card step-content-card p-6">
            <FaFileContract className="mb-4 h-8 w-8 text-gold-500" />
            <h2 className="mb-2 text-xl font-semibold">مدیریت قراردادها</h2>
            <p className="text-secondary">ایجاد، نگهداری، پیگیری و تایید دیجیتال قراردادها با ثبت رویدادهای قابل بررسی.</p>
          </article>
          <article className="glass-liquid-card step-content-card p-6">
            <FaUsers className="mb-4 h-8 w-8 text-teal-500" />
            <h2 className="mb-2 text-xl font-semibold">کنترل دسترسی</h2>
            <p className="text-secondary">تعریف کاربران، نقش‌ها، فضای کاری و سطح دسترسی متناسب با ساختار سازمان.</p>
          </article>
          <article className="glass-liquid-card step-content-card p-6">
            <FaShieldAlt className="mb-4 h-8 w-8 text-silver-600" />
            <h2 className="mb-2 text-xl font-semibold">ردیابی و امنیت</h2>
            <p className="text-secondary">ثبت وضعیت‌ها و لاگ‌های عملیاتی برای افزایش شفافیت و قابلیت پیگیری فرآیندها.</p>
          </article>
        </section>
      </main>
    </div>
  );
}
