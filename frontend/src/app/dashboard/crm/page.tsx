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
import { CrmGuide } from '@/components/crm/CrmGuide';
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

const guideSteps = [
  {
    targetId: 'crm-work-queue',
    title: 'صف پیگیری‌های امروز',
    body: 'این بخش کارهای عملیاتی فروشنده را نشان می‌دهد. موارد سررسیدشده و امروز باید قبل از پیگیری‌های آینده بررسی شوند.',
    fields: ['سررسید اقدام بعدی', 'مخاطب یا پروژه مرتبط', 'نوع ارتباط بعدی'],
    mistakes: ['اتکا به حافظه شخصی به‌جای ثبت اقدام بعدی', 'بستن پیگیری فعال بدون تاریخ بعدی'],
  },
  {
    targetId: 'crm-pipeline-summary',
    title: 'خلاصه پروژه‌های احتمالی',
    body: 'اینجا وضعیت فرصت‌های قبل از قرارداد دیده می‌شود. مدیر CRM نمای تیمی می‌بیند و فروشنده نمای کارهای خودش را.',
    fields: ['وضعیت پروژه', 'فروشنده مسئول', 'ارزش برآوردی اختیاری'],
  },
  {
    targetId: 'crm-quick-actions',
    title: 'اقدام‌های سریع',
    body: 'برای ثبت مخاطب، پروژه احتمالی یا گزارش پیگیری از این میانبرها استفاده کنید. همه فرم‌ها موبایل‌پسند طراحی شده‌اند.',
    mistakes: ['ساخت مشتری تکراری به‌جای افزودن پروژه احتمالی به مخاطب موجود'],
  },
];

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
    <Link key={action.id} href={action.potentialProject?.id ? `/dashboard/crm/potential-projects/${action.potentialProject.id}` : `/dashboard/crm/customers/${action.customer.id}`} className="block rounded-lg border border-slate-200 bg-slate-50 p-3 transition hover:border-[#074747]/40 hover:bg-white dark:border-slate-800 dark:bg-slate-800/50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{action.title}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{action.potentialProject?.title || crmPersonName(action.customer)}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{PersianCalendar.formatForDisplay(action.dueAt)}</p>
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
      description="مخاطبین، پروژه‌های احتمالی، گزارش‌های پیگیری و اقدام‌های بعدی فروشندگان."
      metrics={metrics}
      actions={[{ label: 'مشتری جدید', href: '/dashboard/crm/customers/create', icon: FaUserPlus, tone: 'primary', variant: 'solid' }]}
    >
      <div className="flex justify-end">
        <CrmGuide steps={guideSteps} />
      </div>

      <div data-crm-guide="crm-quick-actions">
        <ErpActionGrid
          columns={4}
          items={[
            { title: 'ثبت پروژه احتمالی', description: 'فرصت یا پروژه قبل از قرارداد', href: '/dashboard/crm/potential-projects/create', icon: FaProjectDiagram, tone: 'primary' },
            { title: 'ثبت گزارش پیگیری', description: 'تماس، جلسه، بازدید و اقدام بعدی', href: '/dashboard/crm/follow-ups/create', icon: FaTasks, tone: 'success' },
            { title: 'فهرست پروژه‌ها', description: 'وضعیت، مسئول و ارزش برآوردی', href: '/dashboard/crm/potential-projects', icon: FaChartLine, tone: 'info' },
            { title: 'مشتریان', description: 'مخاطبین و سوابق CRM', href: '/dashboard/crm/customers', icon: FaUsers, tone: 'neutral' },
          ]}
        />
      </div>

      <ErpTwoColumn
        main={
          <>
            <div data-crm-guide="crm-work-queue">
              <ErpSection title={data.permissions.canManage ? 'صف پیگیری تیم' : 'صف پیگیری من'} description="اقدام‌های سررسیدشده و امروز باید اولویت کار روزانه باشند.">
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  <div>
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-red-700 dark:text-red-200"><FaExclamationTriangle /> سررسیدشده</h3>
                    <div className="space-y-2">
                      {data.nextActions.overdue.length ? data.nextActions.overdue.slice(0, 6).map(actionRow) : <ErpFieldView label="وضعیت" value="مورد عقب‌افتاده ندارید" tone="success" />}
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-[#074747] dark:text-teal-200"><FaCalendarDay /> امروز</h3>
                    <div className="space-y-2">
                      {data.nextActions.today.length ? data.nextActions.today.slice(0, 6).map(actionRow) : <ErpFieldView label="وضعیت" value="برای امروز اقدامی ثبت نشده" tone="neutral" />}
                    </div>
                  </div>
                </div>
              </ErpSection>
            </div>

            <div data-crm-guide="crm-pipeline-summary">
              <ErpSection title="پروژه‌های احتمالی اخیر" actions={[{ label: 'مشاهده همه', href: '/dashboard/crm/potential-projects', tone: 'neutral', variant: 'outline' }]}>
                <div className="space-y-3">
                  {data.recentProjects.map((project) => (
                    <Link key={project.id} href={`/dashboard/crm/potential-projects/${project.id}`} className="block rounded-lg border border-slate-200 bg-slate-50 p-4 transition hover:border-[#074747]/40 hover:bg-white dark:border-slate-800 dark:bg-slate-800/50">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">{project.title}</p>
                          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{crmPersonName(project.customer)} · {crmUserName(project.responsibleSeller)}</p>
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
                  <div key={event.id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
                    <p className="font-semibold text-slate-900 dark:text-white"><FaHistory className="ml-2 inline h-3 w-3" />{event.title}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{event.potentialProject?.title || crmPersonName(event.customer)} · {crmUserName(event.actor)}</p>
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
