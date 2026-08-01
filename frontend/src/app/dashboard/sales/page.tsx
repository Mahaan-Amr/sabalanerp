'use client';
import Link from 'next/link';
import {
  FaBox,
  FaChartLine,
  FaFileContract,
  FaPlus,
  FaUsers,
} from 'react-icons/fa';
import { ErpBadge, ErpCard, ErpPage, type ErpTone } from '@/components/erp';

const salesActions: Array<{
  title: string;
  href: string;
  icon: typeof FaFileContract;
  tone: ErpTone;
  badge: string;
}> = [
  {
    title: 'مشاهده قراردادها',
    href: '/dashboard/sales/contracts',
    icon: FaFileContract,
    tone: 'primary',
    badge: 'عملیات روزانه',
  },
  {
    title: 'ایجاد قرارداد جدید',
    href: '/dashboard/sales/contracts/create',
    icon: FaPlus,
    tone: 'success',
    badge: 'پرکاربرد',
  },
  {
    title: 'ایجاد مشتری',
    href: '/dashboard/crm/customers/create',
    icon: FaUsers,
    tone: 'info',
    badge: 'CRM',
  },
  {
    title: 'ایجاد محصول',
    href: '/dashboard/sales/products/create',
    icon: FaBox,
    tone: 'purple',
    badge: 'کاتالوگ',
  },
  {
    title: 'گزارش فروش',
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
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {salesActions.map((action) => {
          const Icon = action.icon;
          return (
            <Link key={action.href} href={action.href} className="group block">
              <ErpCard interactive tone={action.tone} className="h-full p-4">
                <div className="flex h-full flex-col gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--sds-surface-raised)] text-[var(--sds-accent)] shadow-sm ring-1 ring-[var(--sds-focus-ring)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-accent)] dark:ring-[var(--sds-focus-ring)]">
                      <Icon className="h-5 w-5" />
                    </span>
                    <ErpBadge tone={action.tone}>{action.badge}</ErpBadge>
                  </div>
                  <div className="mt-auto">
                    <h2 className="text-base font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{action.title}</h2>
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
