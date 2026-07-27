import Link from 'next/link';
import { FaEnvelope, FaGlobe, FaHeadset, FaInfoCircle, FaLock, FaMapMarkerAlt } from 'react-icons/fa';
import { PublicFooter } from '@/components/public/PublicFooter';
import { PublicHeader } from '@/components/public/PublicHeader';
import { Reveal } from '@/components/public/PublicMotion';

const contactItems = [
  {
    icon: FaEnvelope,
    label: 'ایمیل پشتیبانی',
    value: 'support@sabalanerp.com',
  },
  {
    icon: FaGlobe,
    label: 'وب سایت',
    value: 'sabalanerp.com',
  },
  {
    icon: FaMapMarkerAlt,
    label: 'محدوده فعالیت',
    value: 'ایران',
  },
  {
    icon: FaHeadset,
    label: 'پشتیبانی سامانه',
    value: 'پشتیبانی حساب کاربری و دسترسی از مسیر رسمی سازمان انجام می شود.',
  },
];

export default function ContactPage() {
  return (
    <div className="public-site">
      <PublicHeader />

      <main className="sds-workspace">
        <section className="public-section public-grid-band">
          <div className="public-container max-w-4xl">
            <Reveal>
              <p className="public-eyebrow">تماس و پشتیبانی</p>
              <h1 className="public-heading">راه ارتباطی رسمی سبلان ERP</h1>
              <p className="public-lead mt-6">
                برای پیگیری دسترسی کاربران، هماهنگی های پشتیبانی یا سوال درباره سامانه، از اطلاعات رسمی زیر استفاده کنید.
              </p>
            </Reveal>
          </div>
        </section>

        <section className="public-section">
          <div className="public-container grid gap-5 md:grid-cols-2">
            {contactItems.map((item, index) => {
              const Icon = item.icon;
              return (
                <Reveal key={item.label} delay={index * 0.04}>
                  <article className="public-card h-full p-6">
                    <Icon className="mb-5 h-8 w-8 text-[var(--sds-accent)]" />
                    <h2 className="text-lg font-black text-[var(--sds-text-primary)]">{item.label}</h2>
                    <p className="mt-3 leading-8 text-[var(--sds-text-secondary)]">{item.value}</p>
                  </article>
                </Reveal>
              );
            })}
          </div>
        </section>

        <section className="public-section bg-[var(--sds-surface-subtle)]">
          <div className="public-container grid gap-5 lg:grid-cols-2">
            <Reveal>
              <div className="public-card h-full p-6">
                <FaLock className="mb-5 h-8 w-8 text-[var(--sds-text-primary)]" />
                <h2 className="text-2xl font-black text-[var(--sds-text-primary)]">دسترسی عمومی وجود ندارد</h2>
                <p className="mt-4 leading-9 text-[var(--sds-text-secondary)]">
                  حساب کاربری از داخل سازمان و بر اساس نقش و سطح دسترسی تعریف می شود. اگر باید به سامانه دسترسی داشته باشید، با مدیر سامانه در سنگ سبلان هماهنگ کنید.
                </p>
              </div>
            </Reveal>
            <Reveal delay={0.08}>
              <div className="public-card h-full p-6">
                <FaInfoCircle className="mb-5 h-8 w-8 text-[var(--sds-accent)]" />
                <h2 className="text-2xl font-black text-[var(--sds-text-primary)]">تایید قرارداد از طریق پیامک</h2>
                <p className="mt-4 leading-9 text-[var(--sds-text-secondary)]">
                  مشتریانی که نیاز به مشاهده یا تایید قرارداد دارند، لینک اختصاصی را از مسیر پیامک دریافت می کنند. برای امنیت بیشتر، این مسیر به عنوان دکمه عمومی در سایت نمایش داده نمی شود.
                </p>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="public-section">
          <div className="public-container">
            <Reveal>
              <div className="public-card grid gap-6 p-8 lg:grid-cols-[1fr_auto] lg:items-center">
                <div>
                  <h2 className="text-2xl font-black text-[var(--sds-text-primary)] md:text-4xl">کاربر مجاز سامانه هستید؟</h2>
                  <p className="public-lead mt-4">برای ورود به داشبورد عملیاتی از مسیر امن سامانه استفاده کنید.</p>
                </div>
                <Link href="/login" className="public-button public-button-primary">
                  ورود به سامانه
                </Link>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
