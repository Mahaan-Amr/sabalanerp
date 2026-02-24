import Link from 'next/link'
import { FaChartLine, FaUsers, FaShoppingCart, FaCog, FaFileContract, FaWarehouse, FaIndustry } from 'react-icons/fa'
import { ThemeToggle } from '@/components/ThemeToggle'

export default function Home() {
  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="glass-liquid-card mx-4 mt-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div className="flex items-center">
              <FaChartLine className="h-8 w-8 text-silver-600" />
              <h1 className="mr-2 text-2xl font-bold text-primary">سبلان ERP</h1>
            </div>
            <div className="flex items-center space-x-4 space-x-reverse">
              <ThemeToggle />
              <nav className="flex space-x-3 space-x-reverse">
                <Link href="/login" className="glass-liquid-btn inline-block whitespace-nowrap">ورود</Link>
                <Link href="/register" className="glass-liquid-btn inline-block whitespace-nowrap">ثبت‌نام</Link>
              </nav>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center">
          <h2 className="text-4xl font-bold text-primary sm:text-5xl md:text-6xl">
            به{' '}
            <span className="text-gold-500">سبلان ERP</span>
            {' '}خوش آمدید
          </h2>
          <p className="mt-3 max-w-md mx-auto text-base text-secondary sm:text-lg md:mt-5 md:text-xl md:max-w-3xl">
            سامانه یکپارچه برنامه‌ریزی منابع سازمانی برای مدیریت دقیق فرآیندها، افزایش بهره‌وری و تصمیم‌گیری هوشمند.
          </p>
          <div className="mt-5 max-w-md mx-auto sm:flex sm:justify-center md:mt-8">
            <div className="rounded-md shadow">
              <Link href="/dashboard" className="glass-liquid-btn-primary inline-block w-full text-center px-8 py-3 text-base font-medium md:py-4 md:text-lg md:px-10">
                ورود به سامانه
              </Link>
            </div>
            <div className="mt-3 rounded-md shadow sm:mt-0 sm:mr-3">
              <Link href="/dashboard" className="glass-liquid-btn inline-block w-full text-center px-8 py-3 text-base font-medium md:py-4 md:text-lg md:px-10">
                مشاهده داشبورد
              </Link>
            </div>
          </div>
        </div>

        {/* Features Grid */}
        <div className="mt-20">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div className="glass-liquid-card text-center p-6">
              <FaUsers className="mx-auto h-12 w-12 text-silver-600" />
              <h3 className="mt-4 text-lg font-medium text-primary">مدیریت کاربران</h3>
              <p className="mt-2 text-base text-secondary">
                تعریف نقش‌ها، سطوح دسترسی و کنترل کامل کاربران در ساختار سازمانی.
              </p>
            </div>
            <div className="glass-liquid-card text-center p-6">
              <FaFileContract className="mx-auto h-12 w-12 text-gold-500" />
              <h3 className="mt-4 text-lg font-medium text-primary">مدیریت قراردادها</h3>
              <p className="mt-2 text-base text-secondary">
                ایجاد، پیگیری و آرشیو قراردادها با فرآیند تایید و کنترل مرحله‌ای.
              </p>
            </div>
            <div className="glass-liquid-card text-center p-6">
              <FaChartLine className="mx-auto h-12 w-12 text-teal-500" />
              <h3 className="mt-4 text-lg font-medium text-primary">گزارش و تحلیل</h3>
              <p className="mt-2 text-base text-secondary">
                مشاهده شاخص‌های عملکردی و گزارش‌های مدیریتی برای تصمیم‌گیری بهتر.
              </p>
            </div>
            <div className="glass-liquid-card text-center p-6">
              <FaWarehouse className="mx-auto h-12 w-12 text-silver-600" />
              <h3 className="mt-4 text-lg font-medium text-primary">مدیریت موجودی</h3>
              <p className="mt-2 text-base text-secondary">
                کنترل موجودی انبار و هماهنگی تامین کالا در چرخه عملیاتی سازمان.
              </p>
            </div>
          </div>
        </div>

        {/* Additional Features */}
        <div className="mt-16">
          <h3 className="text-2xl font-bold text-center text-primary mb-8">امکانات تکمیلی</h3>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="glass-liquid-card p-6">
              <FaIndustry className="h-8 w-8 text-gold-500 mb-4" />
              <h4 className="text-lg font-medium text-primary mb-2">اتوماسیون تولید</h4>
              <p className="text-secondary">
                برنامه‌ریزی و رهگیری فرآیندهای تولید و اتصال به خطوط CNC در صورت نیاز.
              </p>
            </div>
            <div className="glass-liquid-card p-6">
              <FaCog className="h-8 w-8 text-teal-500 mb-4" />
              <h4 className="text-lg font-medium text-primary mb-2">پیکربندی پیشرفته</h4>
              <p className="text-secondary">
                تنظیمات اختصاصی برای انطباق سامانه با ساختار، سیاست‌ها و نیازهای کسب‌وکار.
              </p>
            </div>
            <div className="glass-liquid-card p-6">
              <FaShoppingCart className="h-8 w-8 text-silver-600 mb-4" />
              <h4 className="text-lg font-medium text-primary mb-2">زنجیره تامین</h4>
              <p className="text-secondary">
                مدیریت سفارش‌ها و هماهنگی تامین‌کنندگان برای پایداری جریان عملیات.
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="glass-liquid-card mx-4 mb-4 mt-16">
        <div className="max-w-7xl mx-auto py-12 px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <p className="text-base text-secondary">
              &copy; سبلان ERP. تمامی حقوق محفوظ است.
            </p>
            <div className="mt-6 flex justify-center">
              <a
                referrerPolicy="origin"
                target="_blank"
                href="https://trustseal.enamad.ir/?id=710761&Code=Smq9kxRtFbt6sCjdJFD2B7AUKdMzIIN9"
              >
                <img
                  referrerPolicy="origin"
                  src="https://trustseal.enamad.ir/logo.aspx?id=710761&Code=Smq9kxRtFbt6sCjdJFD2B7AUKdMzIIN9"
                  alt="نماد اعتماد الکترونیکی"
                  className="cursor-pointer"
                />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

