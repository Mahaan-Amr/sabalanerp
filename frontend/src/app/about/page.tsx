import Link from 'next/link';
import { FaCheckCircle, FaFileContract, FaGem, FaShieldAlt } from 'react-icons/fa';
import { PublicFooter } from '@/components/public/PublicFooter';
import { PublicHeader } from '@/components/public/PublicHeader';
import { Reveal } from '@/components/public/PublicMotion';

const principles = [
  'ثبت دقیق داده به جای تکیه بر حافظه و کاغذ',
  'اتصال مشتری، پروژه، محصول و قرارداد در یک مسیر',
  'دسترسی کنترل شده برای نقش ها و واحدهای سازمانی',
  'آمادگی برای توسعه مرحله ای در عملیات، انبار، منابع انسانی و حسابداری',
];

export default function AboutPage() {
  return (
    <div className="public-site">
      <PublicHeader />

      <main className="sds-workspace">
        <section className="public-section public-grid-band">
          <div className="public-container grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <Reveal>
              <p className="public-eyebrow">درباره سامانه</p>
              <h1 className="public-heading">پلتفرم رسمی عملیات دیجیتال سنگ سبلان</h1>
            </Reveal>
            <Reveal delay={0.1}>
              <p className="public-lead">
                سبلان ERP برای نیازهای واقعی یک مجموعه فعال در صنعت سنگ ساخته شده است؛ جایی که هر قرارداد به مشتری، پروژه، مشخصات سنگ، برش، پرداخت و زمان تحویل وابسته است. هدف سامانه، تبدیل این جریان پیچیده به یک مسیر شفاف و قابل پیگیری است.
              </p>
            </Reveal>
          </div>
        </section>

        <section className="public-section">
          <div className="public-container grid gap-5 md:grid-cols-3">
            {[
              { icon: FaFileContract, title: 'قرارداد محور', text: 'هسته سامانه بر مدیریت قرارداد فروش و فرآیندهای وابسته به آن بنا شده است.' },
              { icon: FaGem, title: 'مخصوص صنعت سنگ', text: 'کاتالوگ محصول، ابعاد، نوع برش، پرداخت و مشخصات سنگ بخشی از مدل عملیاتی سامانه است.' },
              { icon: FaShieldAlt, title: 'کنترل شده و سازمانی', text: 'ورود و عملیات در سامانه بر اساس نقش، فضای کاری و سطح دسترسی انجام می شود.' },
            ].map((item, index) => {
              const Icon = item.icon;
              return (
                <Reveal key={item.title} delay={index * 0.05}>
                  <article className="public-card h-full p-6">
                    <Icon className="mb-5 h-8 w-8 text-[var(--sds-accent)]" />
                    <h2 className="text-xl font-black text-[var(--sds-text-primary)]">{item.title}</h2>
                    <p className="mt-3 leading-8 text-[var(--sds-text-secondary)]">{item.text}</p>
                  </article>
                </Reveal>
              );
            })}
          </div>
        </section>

        <section className="public-section bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)]">
          <div className="public-container grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
            <Reveal>
              <p className="mb-3 text-sm font-black text-[var(--sds-accent)]">اصول طراحی</p>
              <h2 className="text-3xl font-black leading-snug md:text-5xl">سامانه باید به اندازه عملیات واقعی قابل اعتماد باشد</h2>
              <p className="mt-5 leading-9 text-[var(--sds-text-muted)]">
                تمرکز طراحی روی زیبایی صرف نیست. هر بخش باید به تصمیم گیری، کاهش خطا و پیگیری دقیق کمک کند.
              </p>
            </Reveal>
            <div className="space-y-3">
              {principles.map((item, index) => (
                <Reveal key={item} delay={index * 0.04}>
                  <div className="flex items-start gap-3 rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)]/[0.04] p-4">
                    <FaCheckCircle className="mt-1 h-5 w-5 flex-none text-[var(--sds-accent)]" />
                    <p className="leading-8 text-[var(--sds-text-primary)]">{item}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="public-section">
          <div className="public-container">
            <Reveal>
              <div className="public-card grid gap-6 p-8 lg:grid-cols-[1fr_auto] lg:items-center">
                <div>
                  <h2 className="text-2xl font-black text-[var(--sds-text-primary)] md:text-4xl">برای استفاده عملیاتی وارد سامانه شوید</h2>
                  <p className="public-lead mt-4">
                    دسترسی به داشبوردها و داده های سازمانی فقط برای کاربران مجاز سنگ سبلان فعال است.
                  </p>
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
