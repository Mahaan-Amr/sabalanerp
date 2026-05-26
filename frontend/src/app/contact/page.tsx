import Link from 'next/link';
import { FaChartLine, FaEnvelope, FaGlobe, FaHeadset, FaMapMarkerAlt } from 'react-icons/fa';

const contactItems = [
  {
    icon: FaEnvelope,
    label: 'ایمیل',
    value: 'admin@sabalanerp.com'
  },
  {
    icon: FaGlobe,
    label: 'وب‌سایت',
    value: 'sabalanerp.com'
  },
  {
    icon: FaMapMarkerAlt,
    label: 'نشانی',
    value: 'ایران'
  },
  {
    icon: FaHeadset,
    label: 'پشتیبانی',
    value: 'پشتیبانی از طریق ایمیل رسمی سامانه انجام می‌شود.'
  }
];

export default function ContactPage() {
  return (
    <div className="min-h-screen px-4 py-8 text-primary">
      <header className="glass-liquid-card step-content-card mx-auto max-w-6xl p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/" className="flex items-center gap-3">
            <FaChartLine className="h-8 w-8 text-silver-600" />
            <span className="text-2xl font-bold">سبلان ERP</span>
          </Link>
          <nav className="flex flex-wrap gap-3">
            <Link href="/about" className="glass-liquid-btn">درباره ما</Link>
            <Link href="/login" className="glass-liquid-btn-primary px-6 py-3">ورود</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl py-10">
        <section className="mb-8">
          <h1 className="mb-4 text-4xl font-bold">تماس با ما</h1>
          <p className="max-w-3xl text-lg leading-9 text-secondary">
            برای پیگیری حساب کاربری، تایید قرارداد یا هماهنگی‌های پشتیبانی سبلان ERP از راه‌های ارتباطی زیر استفاده کنید.
          </p>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          {contactItems.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.label} className="glass-liquid-card step-content-card p-6">
                <Icon className="mb-4 h-8 w-8 text-teal-500" />
                <h2 className="mb-2 text-lg font-semibold">{item.label}</h2>
                <p className="text-secondary">{item.value}</p>
              </article>
            );
          })}
        </section>
      </main>
    </div>
  );
}
