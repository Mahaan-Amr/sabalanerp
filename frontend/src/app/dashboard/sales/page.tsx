'use client';

import Link from 'next/link';
import {
  FaBox,
  FaChartLine,
  FaFileContract,
  FaHandshake,
  FaPlus,
  FaUsers,
} from 'react-icons/fa';
import { ErpBadge, ErpCard, ErpPage, type ErpTone } from '@/components/erp';

const salesActions: Array<{
  title: string;
  description: string;
  href: string;
  icon: typeof FaFileContract;
  tone: ErpTone;
  badge: string;
}> = [
  {
    title: 'مشاهده قراردادها',
    description: 'لیست قراردادها، وضعیت امضا، چاپ و تایید',
    href: '/dashboard/sales/contracts',
    icon: FaFileContract,
    tone: 'primary',
    badge: 'عملیات روزانه',
  },
  {
    title: 'ایجاد قرارداد جدید',
    description: 'شروع ثبت قرارداد با جریان موبایل‌فرست',
    href: '/dashboard/sales/contracts/create',
    icon: FaPlus,
    tone: 'success',
    badge: 'پرکاربرد',
  },
  {
    title: 'ایجاد مشتری',
    description: 'ثبت مشتری جدید و تکمیل اطلاعات CRM',
    href: '/dashboard/crm/customers/create',
    icon: FaUsers,
    tone: 'info',
    badge: 'CRM',
  },
  {
    title: 'ایجاد محصول',
    description: 'افزودن سنگ، ابعاد و قیمت پایه فروش',
    href: '/dashboard/sales/products/create',
    icon: FaBox,
    tone: 'purple',
    badge: 'کاتالوگ',
  },
  {
    title: 'گزارش فروش',
    description: 'مرور عملکرد و وضعیت قراردادهای فروش',
    href: '/dashboard/sales/reports',
    icon: FaChartLine,
    tone: 'warning',
    badge: 'تحلیل',
  },
];

export default function SalesWorkspacePage() {
  return (
    <ErpPage
      eyebrow="فضای کاری"
      title="فروش"
      description="مسیرهای اصلی فروش در یک صفحه فشرده و آماده برای کار روزانه تیم."
      metrics={[
        { label: 'تمرکز اصلی', value: 'قراردادها', hint: 'ثبت، پیگیری و امضا', icon: FaHandshake, tone: 'primary' },
        { label: 'ورودی سریع', value: 'مشتری و محصول', hint: 'بدون خروج از جریان فروش', icon: FaPlus, tone: 'success' },
        { label: 'نمای عملیاتی', value: 'موبایل‌فرست', hint: 'همسو با قراردادسازی جدید', icon: FaFileContract, tone: 'info' },
      ]}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {salesActions.map((action) => {
          const Icon = action.icon;
          return (
            <Link key={action.href} href={action.href} className="group block">
              <ErpCard interactive tone={action.tone} className="h-full p-4">
                <div className="flex h-full flex-col gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-white text-[#074747] shadow-sm ring-1 ring-slate-200 dark:bg-slate-950 dark:text-teal-100 dark:ring-slate-700">
                      <Icon className="h-5 w-5" />
                    </span>
                    <ErpBadge tone={action.tone}>{action.badge}</ErpBadge>
                  </div>
                  <div className="mt-auto">
                    <h2 className="text-base font-semibold text-slate-950 dark:text-white">{action.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{action.description}</p>
                  </div>
                </div>
              </ErpCard>
            </Link>
          );
        })}
      </div>
    </ErpPage>
  );
}
