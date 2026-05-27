import Link from 'next/link';
import { FaChartLine, FaFileContract, FaFingerprint, FaGem, FaLock, FaRoute, FaTruck, FaUsers } from 'react-icons/fa';
import { PublicFooter } from '@/components/public/PublicFooter';
import { PublicHeader } from '@/components/public/PublicHeader';
import { PublicHeroVisual } from '@/components/public/PublicHeroVisual';
import { MotionDiv, Reveal } from '@/components/public/PublicMotion';

const features = [
  {
    icon: FaFileContract,
    title: 'قراردادهای فروش',
    text: 'ثبت، بررسی، تایید و پیگیری قراردادها در یک جریان مشخص، با شماره گذاری، وضعیت ها و خروجی قابل چاپ.',
  },
  {
    icon: FaUsers,
    title: 'CRM و مشتریان پروژه ای',
    text: 'پرونده مشتری، شماره ها، آدرس پروژه، مدیر پروژه و سابقه ارتباط در کنار جریان فروش نگهداری می شود.',
  },
  {
    icon: FaGem,
    title: 'کاتالوگ تخصصی سنگ',
    text: 'مشخصات سنگ، نوع برش، ضخامت، عرض، معدن، رنگ، پرداخت و قیمت در کاتالوگ عملیاتی قابل استفاده است.',
  },
  {
    icon: FaTruck,
    title: 'تحویل و پرداخت',
    text: 'برنامه ریزی چند مرحله ای تحویل، کنترل مقدار هر محصول و ثبت روش های پرداخت نقدی، رسیدی یا چکی.',
  },
  {
    icon: FaLock,
    title: 'دسترسی نقش محور',
    text: 'هر بخش فقط به داده ها و عملیات مجاز خود دسترسی دارد و ساختار سامانه برای کنترل سازمانی طراحی شده است.',
  },
  {
    icon: FaFingerprint,
    title: 'تایید و ردگیری',
    text: 'رویدادهای مهم عملیاتی قابل پیگیری هستند و تایید قرارداد برای مشتری از طریق لینک اختصاصی پیامک انجام می شود.',
  },
];

const stats = [
  { value: '۲۰۰۸', label: 'شروع فعالیت سنگ سبلان' },
  { value: '۶+', label: 'فضای کاری طراحی شده' },
  { value: '۳۸۶+', label: 'رکورد محصول وارد شده' },
  { value: 'RTL', label: 'طراحی فارسی و راست به چپ' },
];

const roadmap = [
  'گزارش های مدیریتی یکپارچه',
  'عملیات کامل تر انبار و گردش کالا',
  'زیرساخت منابع انسانی',
  'پایه های حسابداری و تطبیق پرداخت',
];

export default function Home() {
  return (
    <div className="public-site">
      <PublicHeader />

      <main>
        <section className="public-grid-band overflow-hidden">
          <div className="public-container grid min-h-[calc(100vh-84px)] items-center gap-12 py-14 lg:grid-cols-[0.95fr_1.05fr]">
            <div>
              <MotionDiv>
                <p className="public-eyebrow">پلتفرم رسمی عملیات دیجیتال سنگ سبلان</p>
                <h1 className="public-heading">
                  فروش، قرارداد و عملیات سنگ در یک جریان دقیق و قابل پیگیری
                </h1>
                <p className="public-lead mt-6 max-w-2xl">
                  سبلان ERP برای نظم دادن به فرآیندهای واقعی سنگ سبلان ساخته شده است: از شناخت مشتری و انتخاب محصول تا قرارداد، تحویل، پرداخت و کنترل دسترسی.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Link href="/login" className="public-button public-button-primary">
                    ورود به سامانه
                  </Link>
                  <Link href="/about" className="public-button public-button-secondary">
                    آشنایی با سامانه
                  </Link>
                </div>
              </MotionDiv>
            </div>

            <PublicHeroVisual />
          </div>
        </section>

        <section className="public-section">
          <div className="public-container">
            <Reveal className="grid gap-6 md:grid-cols-4">
              {stats.map((item) => (
                <div key={item.label} className="public-card p-6">
                  <p className="text-3xl font-black text-stone-950">{item.value}</p>
                  <p className="mt-2 text-sm leading-7 text-stone-500">{item.label}</p>
                </div>
              ))}
            </Reveal>
          </div>
        </section>

        <section id="features" className="public-section bg-stone-950 text-white">
          <div className="public-container">
            <Reveal className="max-w-3xl">
              <p className="mb-3 text-sm font-black text-teal-300">امکانات اصلی</p>
              <h2 className="text-3xl font-black leading-snug text-white md:text-5xl">
                ابزارهایی که مستقیما از نیاز عملیاتی صنعت سنگ آمده اند
              </h2>
              <p className="mt-5 text-lg leading-9 text-stone-300">
                سامانه برای نمایش تبلیغاتی ساخته نشده؛ برای کاهش خطا، سرعت دادن به تصمیم گیری و ثبت دقیق مسیر فروش و تحویل طراحی شده است.
              </p>
            </Reveal>

            <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {features.map((feature, index) => {
                const Icon = feature.icon;
                return (
                  <Reveal key={feature.title} delay={index * 0.04}>
                    <article className="h-full rounded-lg border border-white/10 bg-white/[0.04] p-6">
                      <Icon className="mb-5 h-7 w-7 text-teal-300" />
                      <h3 className="text-xl font-extrabold text-white">{feature.title}</h3>
                      <p className="mt-3 leading-8 text-stone-300">{feature.text}</p>
                    </article>
                  </Reveal>
                );
              })}
            </div>
          </div>
        </section>

        <section className="public-section">
          <div className="public-container grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <Reveal>
              <p className="public-eyebrow">چرا این سامانه ساخته شد؟</p>
              <h2 className="public-section-title">برای تبدیل کارهای پراکنده به یک مسیر روشن</h2>
              <p className="public-lead mt-5">
                در فروش سنگ، جزئیات محصول، ابعاد، برش، پرداخت، پروژه، تحویل و پرداخت به هم وابسته اند. سبلان ERP این وابستگی ها را در یک ساختار واحد نگه می دارد تا تیم ها با داده مشترک و وضعیت شفاف کار کنند.
              </p>
            </Reveal>

            <Reveal delay={0.1}>
              <div className="public-card p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  {['مشتری', 'پروژه', 'محصول', 'قرارداد', 'تحویل', 'پرداخت'].map((item, index) => (
                    <div key={item} className="rounded-lg border border-stone-200 bg-stone-50 p-4">
                      <span className="text-xs font-black text-teal-700">۰{index + 1}</span>
                      <p className="mt-2 text-lg font-extrabold text-stone-950">{item}</p>
                      <div className="mt-4 h-1.5 rounded-full bg-stone-200">
                        <div className="h-full rounded-full bg-teal-700" style={{ width: `${48 + index * 8}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section id="roadmap" className="public-section bg-stone-100">
          <div className="public-container grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
            <Reveal>
              <p className="public-eyebrow">مسیر توسعه سامانه</p>
              <h2 className="public-section-title">هسته عملیاتی امروز، پایه گسترش فردا</h2>
            </Reveal>
            <div className="grid gap-4 sm:grid-cols-2">
              {roadmap.map((item, index) => (
                <Reveal key={item} delay={index * 0.05}>
                  <div className="public-card flex h-full items-start gap-4 p-5">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-stone-950 text-sm font-black text-white">
                      {index + 1}
                    </span>
                    <div>
                      <p className="font-extrabold text-stone-950">{item}</p>
                      <p className="mt-2 text-sm leading-7 text-stone-500">در حال توسعه و تکمیل بر اساس نیازهای عملیاتی.</p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="public-section">
          <div className="public-container">
            <Reveal>
              <div className="public-card grid gap-8 p-8 lg:grid-cols-[1fr_auto] lg:items-center">
                <div>
                  <FaRoute className="mb-4 h-8 w-8 text-teal-700" />
                  <h2 className="text-2xl font-black text-stone-950 md:text-4xl">دسترسی به سامانه برای کاربران مجاز</h2>
                  <p className="public-lead mt-4 max-w-3xl">
                    ورود به بخش های عملیاتی فقط برای کاربران تعریف شده در سازمان امکان پذیر است. برای دسترسی یا پشتیبانی، با مدیر سامانه در سنگ سبلان هماهنگ کنید.
                  </p>
                </div>
                <Link href="/login" className="public-button public-button-primary">
                  ورود کاربران
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
