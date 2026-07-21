'use client';

import { useEffect, useState } from 'react';
import {
  FaBalanceScale,
  FaClipboardCheck,
  FaExclamationTriangle,
  FaFileInvoice,
  FaHistory,
  FaMoneyCheckAlt,
  FaReceipt,
  FaSync,
  FaUserClock,
  FaUserPlus,
} from 'react-icons/fa';
import {
  ErpActionGrid,
  ErpLoading,
  ErpPage,
  ErpSection,
} from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import {
  CompactQueueItem,
  QueueList,
  StatusBadge,
  accountingIcons,
  dateFa,
  money,
  taxStatusLabels,
} from '@/features/accounting/accountingUi';

export default function AccountingDashboardPage() {
  const [workspace, setWorkspace] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadWorkspace = async () => {
    try {
      setLoading(true);
      const response = await accountingAPI.getWorkspace();
      if (response.data.success) {
        setWorkspace(response.data.data);
      }
    } catch (error) {
      console.error('Error loading accounting workspace:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorkspace();
  }, []);

  if (loading) {
    return <ErpLoading />;
  }

  const queues = workspace?.queues || {};
  const commandCenter = workspace?.commandCenter || {};

  return (
    <ErpPage
      eyebrow="حسابداری"
      title="داشبورد حسابداری"
      description="مرکز کنترل مالی قراردادها، دریافتنی‌ها، چک‌ها، پیش‌نویس صورتحساب و وضعیت سامانه مودیان."
      actions={[
        { label: 'به‌روزرسانی', icon: FaSync, onClick: loadWorkspace, tone: 'neutral' },
      ]}
    >
      <ErpActionGrid
        columns={4}
        items={[
          {
            title: 'قراردادهای قابل بررسی',
            description: 'نمایش همه قراردادها در هر وضعیت با اقدام‌های حسابداری مجاز.',
            href: '/dashboard/accounting/contracts',
            icon: FaClipboardCheck,
            tone: 'primary',
            meta: 'ورود به رجیستر قراردادها',
            badge: <StatusBadge label={(queues.contracts?.length || 0).toLocaleString('fa-IR')} tone="primary" />,
          },
          {
            title: 'پیش‌نویس صورتحساب‌ها',
            description: 'مرور پیش‌نویس‌های ایجاد شده از قراردادها و آمادگی صدور.',
            href: '/dashboard/accounting/invoice-candidates',
            icon: FaFileInvoice,
            tone: 'info',
            badge: <StatusBadge label={(commandCenter.invoiceCandidates?.count || 0).toLocaleString('fa-IR')} tone="info" />,
          },
          {
            title: 'دریافت‌ها و چک‌ها',
            description: 'پیگیری وصول، واگذاری، برگشت، جایگزینی و مغایرت دریافت‌ها.',
            href: '/dashboard/accounting/payments',
            icon: FaMoneyCheckAlt,
            tone: 'warning',
            badge: <StatusBadge label={(commandCenter.checksDue?.count || 0).toLocaleString('fa-IR')} tone="warning" />,
          },
          {
            title: 'دریافتنی‌ها',
            description: 'سررسید، مانده، وصول بخشی و تسویه دریافتنی‌های قرارداد.',
            href: '/dashboard/accounting/receivables',
            icon: FaReceipt,
            tone: 'success',
            badge: <StatusBadge label={(commandCenter.openReceivables?.count || 0).toLocaleString('fa-IR')} tone="success" />,
          },
          {
            title: 'استخدام: وثیقه و قرارداد',
            description: 'ثبت و تأیید وثیقه، تعهدات، جبران خدمات و قرارداد متقاضیان منتخب.',
            href: '/dashboard/hr/hiring',
            icon: FaUserPlus,
            tone: 'info',
          },
          {
            title: 'قالب وثیقه استخدام',
            description: 'ساخت نسخه‌های چک‌لیست وثیقه و تعهدات توسط مدیر مالی.',
            href: '/dashboard/hr/hiring/collateral-templates',
            icon: FaClipboardCheck,
            tone: 'neutral',
          },
          {
            title: 'مالیات و سامانه مودیان',
            description: 'آمادگی اطلاعات، ثبت دستی وضعیت ارسال و پیگیری رد یا پذیرش.',
            href: '/dashboard/accounting/tax',
            icon: FaBalanceScale,
            tone: 'purple',
            badge: <StatusBadge label={(commandCenter.taxNotReady?.count || 0).toLocaleString('fa-IR')} tone="purple" />,
          },
          {
            title: 'بررسی اصلاحات',
            description: 'بررسی مدیریتی درخواست‌های اصلاح و پیگیری اصلاح‌های برگشته از فروش.',
            href: '/dashboard/accounting/correction-requests',
            icon: FaExclamationTriangle,
            tone: 'warning',
            badge: <StatusBadge label={(commandCenter.correctionRequests?.count || 0).toLocaleString('fa-IR')} tone="warning" />,
          },
          {
            title: 'سوابق عملیات',
            description: 'ردیابی همه اقدام‌های حسابداری برای حسابرسی داخلی.',
            href: '/dashboard/accounting/audit',
            icon: FaHistory,
            tone: 'neutral',
            meta: 'آخرین رویدادها',
          },
          {
            title: 'عملکرد حسابداران',
            description: 'میانگین زمان اقدام، تایید مالی، ثبت دریافت و بستن اصلاحیه برای هر حسابدار.',
            href: '/dashboard/accounting/performance',
            icon: FaUserClock,
            tone: 'primary',
            meta: 'گزارش عملکرد',
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <QueueList
          title="دریافتنی‌های نزدیک سررسید"
          items={queues.receivables || []}
          emptyText="دریافتنی بازی برای نمایش وجود ندارد."
          actions={[{ label: 'مشاهده همه', href: '/dashboard/accounting/receivables', icon: FaReceipt, tone: 'success' }]}
          renderItem={(item: any) => (
            <CompactQueueItem
              key={item.id}
              icon={accountingIcons.receivable}
              title="دریافتنی قرارداد"
              meta={`سررسید: ${dateFa(item.dueDate)}`}
              amount={money(item.remainingAmount, item.currency)}
              status={<StatusBadge status={item.status} />}
            />
          )}
        />

        <QueueList
          title="مالیات و سامانه مودیان"
          items={queues.tax || []}
          emptyText="پرونده مالیاتی فعالی در صف نیست."
          actions={[{ label: 'مشاهده همه', href: '/dashboard/accounting/tax', icon: FaBalanceScale, tone: 'purple' }]}
          renderItem={(item: any) => (
            <CompactQueueItem
              key={item.id}
              icon={FaBalanceScale}
              title={taxStatusLabels[item.submissionStatus] || item.submissionStatus}
              meta={item.trackingCode ? `کد پیگیری: ${item.trackingCode}` : `آخرین تغییر: ${dateFa(item.updatedAt)}`}
              amount={money(item.taxableAmount)}
              status={<StatusBadge status={item.submissionStatus} />}
            />
          )}
        />
      </div>

      <ErpSection
        title="بررسی اصلاحات"
        description="درخواست‌هایی که حسابداری برای تکمیل اطلاعات فروش، مشتری، پرداخت، تحویل یا مالیات ثبت کرده است."
        actions={[{ label: 'مشاهده همه', href: '/dashboard/accounting/correction-requests', icon: FaExclamationTriangle, tone: 'warning' }]}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(queues.corrections || []).slice(0, 6).map((item: any) => (
            <CompactQueueItem
              key={item.id}
              icon={FaExclamationTriangle}
              title={item.accountantNote}
              meta={`اولویت: ${item.priority} · ${dateFa(item.createdAt)}`}
              status={<StatusBadge status={item.status} />}
            />
          ))}
          {(!queues.corrections || queues.corrections.length === 0) && (
            <p className="text-sm text-slate-500 dark:text-slate-400">درخواست اصلاح بازی وجود ندارد.</p>
          )}
        </div>
      </ErpSection>
    </ErpPage>
  );
}
