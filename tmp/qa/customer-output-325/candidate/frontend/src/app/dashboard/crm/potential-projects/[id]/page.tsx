'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FaCheck, FaFileContract, FaPlus, FaTasks } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpEmptyState, ErpFieldView, ErpLoading, ErpPage, ErpSection, ErpSummaryGrid, ErpTwoColumn } from '@/components/erp';
import { crmAPI } from '@/lib/api';
import { crmPersonName, crmUserName, formatToman, isActionOverdue, potentialProjectStatusTone } from '@/lib/crmPipeline';
import PersianCalendar from '@/lib/persian-calendar';

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

      <ErpTwoColumn
        main={
          <>
            <div>
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
                {project.description && <p className="mt-4 text-sm leading-7 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{project.description}</p>}
              </ErpSection>
            </div>

            <div>
              <ErpSection title="اقدام‌های بعدی" actions={[{ label: 'ثبت پیگیری جدید', href: `/dashboard/crm/follow-ups/create?projectId=${project.id}&customerId=${project.customerId}`, icon: FaPlus, tone: 'primary' }]}>
                <div className="space-y-3">
                  {nextActions.length ? nextActions.map((action: any) => (
                    <div key={action.id} className="rounded-lg border border-[var(--sds-border-default)] p-4 dark:border-[var(--sds-border-strong)]">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{action.title}</p>
                          <p className="mt-1 text-sm leading-6 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{action.instructions}</p>
                          <p className="mt-2 text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{PersianCalendar.formatForDisplay(action.dueAt)} · {action.communicationType}</p>
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

            <div>
              <ErpSection title="گزارش‌های پیگیری">
                <div className="space-y-3">
                  {followUps.length ? followUps.map((report: any) => (
                    <div key={report.id} className="rounded-lg border border-[var(--sds-border-default)] p-4 dark:border-[var(--sds-border-strong)]">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{report.communicationType} · {report.workType}</p>
                          <p className="mt-1 text-sm leading-7 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{report.summary}</p>
                          <p className="mt-2 text-sm font-medium text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">{report.outcome}</p>
                        </div>
                        <p className="text-xs text-[var(--sds-text-secondary)]">{PersianCalendar.formatForDisplay(report.happenedAt)}</p>
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
              <Link href={`/dashboard/crm/customers/${project.customer.id}`} className="text-sm font-semibold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">
                {crmPersonName(project.customer)}
              </Link>
            </ErpSection>
            <ErpSection title="تاریخچه">
              <div className="space-y-3">
                {timeline.map((event: any) => (
                  <div key={event.id} className="rounded-lg border border-[var(--sds-border-default)] p-3 dark:border-[var(--sds-border-strong)]">
                    <p className="text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{event.title}</p>
                    {event.description && <p className="mt-1 text-xs leading-5 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{event.description}</p>}
                    <p className="mt-2 text-xs text-[var(--sds-text-muted)]">{PersianCalendar.formatForDisplay(event.createdAt)} · {crmUserName(event.actor)}</p>
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
