'use client';
import { LogisticsPage } from '@/features/logistics/LogisticsWorkspace';
import { useEffect, useState } from 'react';
import { FaBan, FaCheck, FaClipboardList, FaPlus, FaPrint, FaSync, FaTrash, FaTruck, FaUsers } from 'react-icons/fa';
import { ErpActionMenu, ErpBadge, ErpButton, ErpEmptyState, ErpInlineState, ErpNeumorphicMetricGrid, ErpLoading, ErpSection, type ErpNeumorphicMetric } from '@/components/erp';
import { dashboardAPI, logisticsAPI } from '@/lib/api';
import { hrDutyApi, type DestinationDuty } from '@/features/hr-duties/hrDutyApi';
import { destinationDutyHref } from '@/features/cross-workspace-duties/dutyDestination';
import { userFacingError } from '@/features/dispatch/userFacingError';
import { dispatchCaseReference } from '@/features/dispatch-case/dispatchCasePresentation';
import { StatusBadge, dateFa } from './logistics-ui';

export default function LogisticsDashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [availability, setAvailability] = useState<any>({});
  const [duties, setDuties] = useState<DestinationDuty[]>([]);
  const [dutyError, setDutyError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    setDutyError('');
    const results = await Promise.allSettled([
      logisticsAPI.getDashboard(), dashboardAPI.getActionAvailability('logistics'), hrDutyApi.list('logistics', 'assigned'),
    ]);
    if (results[0].status === 'fulfilled' && results[0].value.data.success) setData(results[0].value.data.data);
    else setError(userFacingError(results[0].status === 'rejected' ? results[0].reason : null, 'دریافت داشبورد لجستیک ناموفق بود.'));
    if (results[1].status === 'fulfilled') setAvailability(results[1].value.data.data || {});
    else setAvailability({});
    if (results[2].status === 'fulfilled') setDuties(results[2].value.data.data);
    else setDutyError('دریافت وظایف ناموفق بود. از صفحه وظایف دوباره تلاش کنید.');
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);
  if (loading) return <ErpLoading />;
  const metrics: ErpNeumorphicMetric[] = [
    { id: 'drafts', label: 'پیش‌نویس‌ها', value: (data?.metrics?.drafts || 0).toLocaleString('fa-IR'), icon: FaClipboardList, tone: 'warning', href: '/dashboard/logistics/loadings?status=DRAFT', hint: 'مشاهده ←' },
    { id: 'finalized', label: 'نهایی‌شده', value: (data?.metrics?.finalized || 0).toLocaleString('fa-IR'), icon: FaTruck, tone: 'success', href: '/dashboard/logistics/loadings?status=FINALIZED', hint: 'مشاهده ←' },
    { id: 'cancelled', label: 'لغوشده', value: (data?.metrics?.cancelled || 0).toLocaleString('fa-IR'), icon: FaBan, tone: 'danger', href: '/dashboard/logistics/loadings?status=CANCELLED', hint: 'مشاهده ←' },
    { id: 'drivers', label: 'راننده فعال', value: (data?.metrics?.drivers || 0).toLocaleString('fa-IR'), icon: FaUsers, tone: 'info', href: '/dashboard/security/vehicles?operation=queue', hint: 'مشاهده ←' },
  ];
  const recent = data?.recent || [];
  const pendingDuties = duties.filter(duty => duty.status === 'OPEN').slice(0, 4);
  return <LogisticsPage title="لجستیک" actions={[
    { label: 'بارگیری جدید', icon: FaPlus, href: '/dashboard/logistics/loadings/new', tone: 'primary', variant: 'solid' },
    { label: 'بارگیری‌ها', icon: FaClipboardList, href: '/dashboard/logistics/loadings' },
    { label: 'به‌روزرسانی', icon: FaSync, onClick: load },
  ]}>
    {error && <ErpInlineState kind="error" title={error} action={{ label: 'تلاش دوباره', onClick: load }} />}
    {data && <ErpNeumorphicMetricGrid items={metrics} />}
    {data && <ErpSection title="آخرین بارگیری‌ها" actions={[{ label: 'مشاهده همه', href: '/dashboard/logistics/loadings', variant: 'ghost' }]}>
      <div className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-sm">
            <thead className="hidden bg-[var(--sds-surface-subtle)] text-xs sds-text-secondary sm:table-header-group"><tr>
              <th className="px-4 py-3">بارگیری / مشتری</th><th className="px-4 py-3">وضعیت</th><th className="px-4 py-3">تاریخ / اقلام</th><th className="px-4 py-3">عملیات</th>
            </tr></thead>
            <tbody className="divide-y divide-[var(--sds-border-subtle)]">
              {recent.map((row: any) => {
                const href = `/dashboard/logistics/loadings/${row.id}`;
                const canEdit = row.status === 'DRAFT' && availability.EDIT_LOADING?.enabled === true;
                return <tr key={row.id} className="flex flex-wrap items-center gap-y-2 p-3 sm:table-row sm:p-0">
                  <td className="w-full min-w-0 sm:w-auto sm:px-4 sm:py-4">
                    <ErpButton label={dispatchCaseReference(row.loadingNumber)} href={href} variant="ghost" className="max-w-full whitespace-normal text-right" />
                    <p className="mt-1 text-base font-bold sds-text-primary">{row.customerName || 'مشتری ثبت نشده'}</p>
                    <p className="mt-1 text-sm sds-text-secondary">پروژه: {row.projectName || 'ثبت نشده'}</p>
                  </td>
                  <td className="sm:px-4 sm:py-4"><StatusBadge status={row.status} /></td>
                  <td className="mr-auto text-xs sds-text-secondary sm:mr-0 sm:px-4 sm:py-4">{dateFa(row.loadingDate)}<span className="block">{(row.lineCount || 0).toLocaleString('fa-IR')} ردیف</span></td>
                  <td className="w-full sm:w-auto sm:min-w-48 sm:px-4 sm:py-4">
                    <div className="flex w-full items-center justify-between gap-3">
                      <ErpButton label={canEdit ? 'ادامه' : 'مشاهده'} href={canEdit ? `/dashboard/logistics/loadings/new?draftId=${row.id}` : href} variant="soft" />
                      <ErpActionMenu portal label={`اقدامات ${dispatchCaseReference(row.loadingNumber)}`} actions={[
                        ...(row.status === 'DRAFT' && availability.FINALIZE_LOADING?.enabled === true ? [{ label: 'نهایی‌سازی', icon: FaCheck, tone: 'success' as const, href: `${href}?action=finalize` }] : []),
                        { label: 'چاپ', icon: FaPrint, href: `${href}?print=1` },
                        ...(row.status !== 'CANCELLED' && availability.CANCEL_LOADING?.enabled === true ? [{ label: 'لغو بارگیری', icon: FaBan, tone: 'danger' as const, href: `${href}?action=cancel` }] : []),
                        ...(canEdit ? [{ label: 'حذف پیش‌نویس', icon: FaTrash, tone: 'danger' as const, href: `${href}?action=delete` }] : []),
                      ]} />
                    </div>
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        {!recent.length && <ErpEmptyState title="هنوز بارگیری ثبت نشده است" icon={FaTruck} />}
      </div>
    </ErpSection>}
    <ErpSection title="وظایف نیازمند اقدام" actions={[{ label: 'همه وظایف', href: '/dashboard/logistics/duties', variant: 'ghost' }]}>
      {dutyError ? <ErpInlineState kind="error" title={dutyError} /> : <div className="divide-y divide-[var(--sds-border-subtle)]">
        {pendingDuties.map(duty => <div key={duty.id} className="flex flex-wrap items-center gap-3 py-4">
          <div className="min-w-0 flex-1"><p className="font-semibold">{duty.fields.title || 'وظیفه سازمانی'}</p><p className="text-xs sds-text-secondary">مهلت: {duty.dueAtDisplay}</p></div>
          <ErpBadge tone={duty.overdue ? 'danger' : 'info'}>{duty.overdue ? 'گذشته از موعد' : 'باز'}</ErpBadge>
          {duty.detailAvailable && <ErpButton label="انجام وظیفه" href={destinationDutyHref('logistics', duty)} variant="soft" />}
        </div>)}
        {!pendingDuties.length && <ErpEmptyState title="وظیفه بازی برای شما وجود ندارد" />}
      </div>}
    </ErpSection>
  </LogisticsPage>;
}
