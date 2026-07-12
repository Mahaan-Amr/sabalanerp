'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FaCheck, FaFileContract, FaPlus, FaTasks } from 'react-icons/fa';
import { CrmGuide } from '@/components/crm/CrmGuide';
import { ErpBadge, ErpButton, ErpEmptyState, ErpFieldView, ErpLoading, ErpPage, ErpSection, ErpSummaryGrid, ErpTwoColumn } from '@/components/erp';
import { crmAPI } from '@/lib/api';
import { crmPersonName, crmUserName, formatToman, isActionOverdue, potentialProjectStatusTone } from '@/lib/crmPipeline';
import PersianCalendar from '@/lib/persian-calendar';

const guideSteps = [
  {
    targetId: 'project-summary',
    title: 'خلاصه پروژه احتمالی',
    body: 'وضعیت، مسئول، نوع کار و برآورد پروژه اینجا دیده می‌شود. پروژه فقط در حالت آماده قرارداد باید وارد قرارداد فروش شود.',
  },
  {
    targetId: 'project-next-actions',
    title: 'اقدام‌های بعدی',
    body: 'این بخش کارهای آینده را نشان می‌دهد. اقدام سررسیدشده باید با ثبت پیگیری جدید یا تکمیل اقدام پیگیری شود.',
    mistakes: ['رها کردن پروژه فعال بدون اقدام بعدی'],
  },
  {
    targetId: 'project-followups',
    title: 'گزارش‌های پیگیری',
    body: 'همه تماس‌ها، جلسات و بازدیدهای ثبت‌شده روی همین پروژه باقی می‌مانند، حتی اگر فروشنده مسئول تغییر کند.',
  },
];

export default function PotentialProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState<string | null>(null);

  useEffect(() => {
    fetchProject();
  }, [id]);

  const fetchProject = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await crmAPI.getPotentialProject(id);
      if (response.data.success) setData(response.data.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'دریافت جزئیات پروژه ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  const completeAction = async (actionId: string) => {
    setCompleting(actionId);
    try {
      await crmAPI.completeNextAction(actionId);
      await fetchProject();
    } finally {
      setCompleting(null);
    }
  };

  if (loading) return <ErpLoading />;
  if (error) return <ErpEmptyState title="خطا در دریافت پروژه" description={error} action={{ label: 'بازگشت', onClick: () => router.push('/dashboard/crm/potential-projects'), tone: 'primary' }} />;
  if (!data?.project) return <ErpEmptyState title="پروژه پیدا نشد" />;

  const { project, followUps, nextActions, timeline } = data;

  return (
    <ErpPage
      title={project.title}
      eyebrow="پروژه احتمالی CRM"
      description={`${crmPersonName(project.customer)} · ${crmUserName(project.responsibleSeller)}`}
      backHref="/dashboard/crm/potential-projects"
      actions={[
        { label: 'ثبت پیگیری', href: `/dashboard/crm/follow-ups/create?projectId=${project.id}&customerId=${project.customerId}`, icon: FaTasks, tone: 'primary', variant: 'solid' },
        { label: 'شروع قرارداد', href: `/dashboard/sales/contracts/create?customerId=${project.customerId}&potentialProjectId=${project.id}`, icon: FaFileContract, tone: 'success', variant: 'outline', disabled: project.status !== 'آماده قرارداد' },
      ]}
    >
      <div className="flex justify-end"><CrmGuide steps={guideSteps} /></div>
      <ErpTwoColumn
        main={
          <>
            <div data-crm-guide="project-summary">
              <ErpSection title="خلاصه پروژه">
                <ErpSummaryGrid
                  columns={3}
                  items={[
                    { label: 'وضعیت', value: <ErpBadge tone={potentialProjectStatusTone(project.status)}>{project.status}</ErpBadge> },
                    { label: 'نوع کار/معامله', value: project.workType },
                    { label: 'فروشنده مسئول', value: crmUserName(project.responsibleSeller) },
                    { label: 'ارزش برآوردی', value: formatToman(project.estimatedValue), tone: 'warning' },
                    { label: 'احتمال تبدیل', value: project.probability != null ? `${Number(project.probability).toLocaleString('fa-IR')}٪` : 'ثبت نشده' },
                    { label: 'تاریخ احتمالی بستن', value: project.expectedCloseDate ? PersianCalendar.formatForDisplay(project.expectedCloseDate) : 'ثبت نشده' },
                  ]}
                />
                {project.description && <p className="mt-4 text-sm leading-7 text-slate-600 dark:text-slate-300">{project.description}</p>}
              </ErpSection>
            </div>

            <div data-crm-guide="project-next-actions">
              <ErpSection title="اقدام‌های بعدی" actions={[{ label: 'ثبت پیگیری جدید', href: `/dashboard/crm/follow-ups/create?projectId=${project.id}&customerId=${project.customerId}`, icon: FaPlus, tone: 'primary' }]}>
                <div className="space-y-3">
                  {nextActions.length ? nextActions.map((action: any) => (
                    <div key={action.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-white">{action.title}</p>
                          <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{action.instructions}</p>
                          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{PersianCalendar.formatForDisplay(action.dueAt)} · {action.communicationType}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <ErpBadge tone={action.status === 'انجام شده' ? 'success' : isActionOverdue(action.dueAt, action.status) ? 'danger' : 'info'}>{action.status}</ErpBadge>
                          {action.status !== 'انجام شده' && (
                            <ErpButton label="تکمیل" icon={FaCheck} tone="success" variant="outline" disabled={completing === action.id} onClick={() => completeAction(action.id)} />
                          )}
                        </div>
                      </div>
                    </div>
                  )) : <ErpFieldView label="اقدام بعدی" value="اقدامی ثبت نشده است" />}
                </div>
              </ErpSection>
            </div>

            <div data-crm-guide="project-followups">
              <ErpSection title="گزارش‌های پیگیری">
                <div className="space-y-3">
                  {followUps.length ? followUps.map((report: any) => (
                    <div key={report.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-white">{report.communicationType} · {report.workType}</p>
                          <p className="mt-1 text-sm leading-7 text-slate-600 dark:text-slate-300">{report.summary}</p>
                          <p className="mt-2 text-sm font-medium text-[#074747] dark:text-teal-200">{report.outcome}</p>
                        </div>
                        <p className="text-xs text-slate-500">{PersianCalendar.formatForDisplay(report.happenedAt)}</p>
                      </div>
                    </div>
                  )) : <ErpFieldView label="گزارش" value="هنوز گزارشی برای این پروژه ثبت نشده است" />}
                </div>
              </ErpSection>
            </div>
          </>
        }
        aside={
          <>
            <ErpSection title="مخاطب">
              <Link href={`/dashboard/crm/customers/${project.customer.id}`} className="text-sm font-semibold text-[#074747] dark:text-teal-200">
                {crmPersonName(project.customer)}
              </Link>
            </ErpSection>
            <ErpSection title="تاریخچه">
              <div className="space-y-3">
                {timeline.map((event: any) => (
                  <div key={event.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{event.title}</p>
                    {event.description && <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{event.description}</p>}
                    <p className="mt-2 text-xs text-slate-400">{PersianCalendar.formatForDisplay(event.createdAt)} · {crmUserName(event.actor)}</p>
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
