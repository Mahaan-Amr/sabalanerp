'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
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
} from 'react-icons/fa';
import {
  ErpActionGrid,
  ErpButton,
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
  contractStatusLabels,
  dateFa,
  money,
  taxStatusLabels,
  type AccountingContractRow,
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
        columns={3}
        items={[
          {
            title: 'قراردادهای قابل بررسی',
            description: 'نمایش همه قراردادها در هر وضعیت با اقدام‌های حسابداری مجاز.',
            href: '/dashboard/accounting/contracts',
            icon: FaClipboardCheck,
            tone: 'primary',
            meta: 'ورود به رجیستر قراردادها',
          },
          {
            title: 'پیش‌نویس صورتحساب‌ها',
            description: 'مرور پیش‌نویس‌های ایجاد شده از قراردادها و آمادگی صدور.',
            href: '/dashboard/accounting/invoice-candidates',
            icon: FaFileInvoice,
            tone: 'info',
            badge: <StatusBadge label={(workspace?.commandCenter?.invoiceCandidates?.count || 0).toLocaleString('fa-IR')} tone="info" />,
          },
          {
            title: 'دریافت‌ها و چک‌ها',
            description: 'پیگیری وصول، واگذاری، برگشت، جایگزینی و مغایرت دریافت‌ها.',
            href: '/dashboard/accounting/payments',
            icon: FaMoneyCheckAlt,
            tone: 'warning',
          },
          {
            title: 'دریافتنی‌ها',
            description: 'سررسید، مانده، وصول بخشی و تسویه دریافتنی‌های قرارداد.',
            href: '/dashboard/accounting/receivables',
            icon: FaReceipt,
            tone: 'success',
          },
          {
            title: 'مالیات و سامانه مودیان',
            description: 'آمادگی اطلاعات، ثبت دستی وضعیت ارسال و پیگیری رد یا پذیرش.',
            href: '/dashboard/accounting/tax',
            icon: FaBalanceScale,
            tone: 'purple',
          },
          {
            title: 'سوابق عملیات',
            description: 'ردیابی همه اقدام‌های حسابداری برای حسابرسی داخلی.',
            href: '/dashboard/accounting/audit',
            icon: FaHistory,
            tone: 'neutral',
          },
          {
            title: 'عملکرد حسابداران',
            description: 'میانگین زمان اقدام، تایید مالی، ثبت دریافت و بستن اصلاحیه برای هر حسابدار.',
            href: '/dashboard/accounting/performance',
            icon: FaUserClock,
            tone: 'primary',
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <QueueList
          title="قراردادهای نیازمند توجه حسابداری"
          items={(queues.contracts || []) as AccountingContractRow[]}
          emptyText="فعلا قراردادی در صف اقدام حسابداری نیست."
          renderItem={(contract) => (
            <CompactQueueItem
              key={contract.contractId}
              icon={FaClipboardCheck}
              title={<Link href={`/dashboard/accounting/contracts/${contract.contractId}`}>{contract.contractNumber}</Link>}
              meta={`${contract.customer.displayName} · ${contractStatusLabels[contract.status] || contract.status}`}
              amount={money(contract.accounting.remainingAmount)}
              status={<StatusBadge status={contract.accounting.sourceStatus} />}
              footer={
                <div className="flex flex-wrap gap-2">
                  <ErpButton label="جزئیات" href={`/dashboard/accounting/contracts/${contract.contractId}`} tone="primary" variant="soft" />
                  <ErpButton label="رجیستر" href="/dashboard/accounting/contracts" tone="neutral" variant="soft" />
                </div>
              }
            />
          )}
        />

        <QueueList
          title="پیش‌نویس صورتحساب‌ها"
          items={queues.invoiceCandidates || []}
          emptyText="هنوز پیش‌نویس صورتحسابی ایجاد نشده است."
          renderItem={(record: any) => (
            <CompactQueueItem
              key={record.id}
              icon={accountingIcons.invoice}
              title="پیش‌نویس صورتحساب"
              meta={`ایجاد: ${dateFa(record.createdAt)}`}
              amount={money(record.amount, record.currency)}
              status={<StatusBadge status={record.status} />}
            />
          )}
        />

        <QueueList
          title="دریافتنی‌های نزدیک سررسید"
          items={queues.receivables || []}
          emptyText="دریافتنی بازی برای نمایش وجود ندارد."
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
