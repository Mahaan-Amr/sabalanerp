'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  FaBell,
  FaCalendarDay,
  FaChartLine,
  FaCheckCircle,
  FaClock,
  FaExclamationTriangle,
  FaFileContract,
  FaHistory,
  FaPlus,
  FaProjectDiagram,
  FaTasks,
  FaUserPlus,
  FaUsers,
} from 'react-icons/fa';
import { ErpActionGrid, ErpBadge, ErpEmptyState, ErpFieldView, ErpLoading, ErpPage, ErpSection, ErpTwoColumn, type ErpMetric } from '@/components/erp';
import { crmAPI } from '@/lib/api';
import { crmPersonName, crmUserName, formatToman, isActionOverdue, potentialProjectStatusTone } from '@/lib/crmPipeline';
import PersianCalendar from '@/lib/persian-calendar';

type DashboardData = {
  permissions: { canManage: boolean };
  customers: { total: number; active: number };
  projects: {
    total: number;
    byStatus: Array<{ status: string; count: number }>;
    bySeller: Array<{ sellerId: string; sellerName: string; count: number }>;
    won: number;
    lost: number;
    dormant: number;
    estimatedPipelineValue: number | string;
  };
  nextActions: {
    overdue: any[];
    today: any[];
    upcoming: any[];
  };
  recentCustomers: any[];
  recentProjects: any[];
  recentTimeline: any[];
};

export default function CrmWorkspacePage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDashboard();
  }, []);

  const fetchDashboard = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await crmAPI.getCrmStats();
      if (response.data.success) {
        setData(response.data.data);
      } else {
        setError('بارگذاری داشبورد CRM ناموفق بود.');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'بارگذاری داشبورد CRM ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <ErpLoading />;
  if (error) return <ErpEmptyState icon={FaExclamationTriangle} title="خطا در داشبورد CRM" description={error} action={{ label: 'تلاش دوباره', onClick: fetchDashboard, tone: 'primary', variant: 'solid' }} />;
  if (!data) return <ErpEmptyState icon={FaUsers} title="داده‌ای برای نمایش وجود ندارد" />;

  const metrics: ErpMetric[] = [
    { label: 'مخاطبین CRM', value: data.customers.total.toLocaleString('fa-IR'), hint: `${data.customers.active.toLocaleString('fa-IR')} فعال`, icon: FaUsers, tone: 'info' },
    { label: 'پروژه‌های احتمالی', value: data.projects.total.toLocaleString('fa-IR'), hint: data.permissions.canManage ? 'نمای تیمی' : 'نمای فروشنده', icon: FaProjectDiagram, tone: 'primary' },
    { label: 'سررسیدشده', value: data.nextActions.overdue.length.toLocaleString('fa-IR'), hint: 'اقدام‌های عقب‌افتاده', icon: FaBell, tone: data.nextActions.overdue.length ? 'danger' : 'success' },
    { label: 'ارزش برآوردی', value: formatToman(data.projects.estimatedPipelineValue), hint: 'فقط پروژه‌های فعال', icon: FaChartLine, tone: 'warning' },
  ];

  const actionRow = (action: any) => (
    <Link key={action.id} href={action.potentialProject?.id ? `/dashboard/crm/potential-projects/${action.potentialProject.id}` : `/dashboard/crm/customers/${action.customer.id}`} className="block rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] p-3 transition hover:border-[var(--sds-accent)]/40 hover:bg-[var(--sds-surface-raised)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{action.title}</p>
          <p className="mt-1 text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{action.potentialProject?.title || crmPersonName(action.customer)}</p>
          <p className="mt-1 text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{PersianCalendar.formatForDisplay(action.dueAt)}</p>
        </div>
        <ErpBadge tone={isActionOverdue(action.dueAt, action.status) ? 'danger' : 'info'}>
          {action.communicationType}
        </ErpBadge>
      </div>
    </Link>
  );

  return (
    <ErpPage
      eyebrow="CRM"
      title="مدیریت ارتباط و پیگیری مشتری"
      metrics={metrics}
      actions={[{ label: 'مشتری جدید', href: '/dashboard/crm/customers/create', icon: FaUserPlus, tone: 'primary', variant: 'solid' }]}
    >


      <div>
        <ErpActionGrid
          columns={4}
          items={[
            { title: 'ثبت پروژه احتمالی', href: '/dashboard/crm/potential-projects/create', icon: FaProjectDiagram, tone: 'primary' },
            { title: 'ثبت گزارش پیگیری', href: '/dashboard/crm/follow-ups/create', icon: FaTasks, tone: 'success' },
            { title: 'فهرست پروژه‌ها', href: '/dashboard/crm/potential-projects', icon: FaChartLine, tone: 'info' },
            { title: 'مشتریان', href: '/dashboard/crm/customers', icon: FaUsers, tone: 'neutral' },
          ]}
        />
      </div>

      <ErpTwoColumn
        main={
          <>
            <div>
              <ErpSection title={data.permissions.canManage ? 'صف پیگیری تیم' : 'صف پیگیری من'} description="اقدام‌های سررسیدشده و امروز باید اولویت کار روزانه باشند.">
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  <div>
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-[var(--sds-danger)] dark:text-[var(--sds-danger)]"><FaExclamationTriangle /> سررسیدشده</h3>
                    <div className="space-y-2">
                      {data.nextActions.overdue.length ? data.nextActions.overdue.slice(0, 6).map(actionRow) : <ErpFieldView label="وضعیت" value="مورد عقب‌افتاده ندارید" tone="success" />}
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]"><FaCalendarDay /> امروز</h3>
                    <div className="space-y-2">
                      {data.nextActions.today.length ? data.nextActions.today.slice(0, 6).map(actionRow) : <ErpFieldView label="وضعیت" value="برای امروز اقدامی ثبت نشده" tone="neutral" />}
                    </div>
                  </div>
                </div>
              </ErpSection>
            </div>

            <div>
              <ErpSection title="پروژه‌های احتمالی اخیر" actions={[{ label: 'مشاهده همه', href: '/dashboard/crm/potential-projects', tone: 'neutral', variant: 'outline' }]}>
                <div className="space-y-3">
                  {data.recentProjects.map((project) => (
                    <Link key={project.id} href={`/dashboard/crm/potential-projects/${project.id}`} className="block rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] p-4 transition hover:border-[var(--sds-accent)]/40 hover:bg-[var(--sds-surface-raised)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{project.title}</p>
                          <p className="mt-1 text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{crmPersonName(project.customer)} · {crmUserName(project.responsibleSeller)}</p>
                        </div>
                        <ErpBadge tone={potentialProjectStatusTone(project.status)}>{project.status}</ErpBadge>
                      </div>
                    </Link>
                  ))}
                </div>
              </ErpSection>
            </div>
          </>
        }
        aside={
          <>
            <ErpSection title="وضعیت پروژه‌ها">
              <div className="space-y-2">
                {data.projects.byStatus.map((row) => (
                  <ErpFieldView key={row.status} label={row.status} value={row.count.toLocaleString('fa-IR')} tone={potentialProjectStatusTone(row.status)} />
                ))}
              </div>
            </ErpSection>

            {data.permissions.canManage && (
              <ErpSection title="نمای فروشنده‌ها">
                <div className="space-y-2">
                  {data.projects.bySeller.slice(0, 8).map((row) => (
                    <ErpFieldView key={row.sellerId} label={row.sellerName} value={`${row.count.toLocaleString('fa-IR')} پروژه فعال`} />
                  ))}
                </div>
              </ErpSection>
            )}

            <ErpSection title="آخرین رخدادها">
              <div className="space-y-3">
                {data.recentTimeline.map((event) => (
                  <div key={event.id} className="rounded-lg border border-[var(--sds-border-default)] p-3 text-sm dark:border-[var(--sds-border-strong)]">
                    <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]"><FaHistory className="ml-2 inline h-3 w-3" />{event.title}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{event.potentialProject?.title || crmPersonName(event.customer)} · {crmUserName(event.actor)}</p>
                  </div>
                ))}
              </div>
            </ErpSection>
          </>
        }
      />
    </ErpPage>
  );
}
