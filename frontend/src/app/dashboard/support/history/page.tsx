'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FaLifeRing, FaPlus } from 'react-icons/fa';
import { supportTicketsAPI } from '@/lib/api';
import { featureLabelFa, workspaceLabelFa } from '@/lib/featureLabelsFa';
import { ErpBadge, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSelect } from '@/components/erp';

const statusLabels: Record<string, string> = {
  NEW: 'جدید',
  TRIAGED: 'بررسی اولیه',
  IN_PROGRESS: 'در حال رسیدگی',
  WAITING_REPORTER: 'منتظر گزارشگر',
  RESOLVED: 'حل‌شده',
  CLOSED: 'بسته‌شده',
  DUPLICATE: 'تکراری',
};
const priorityLabels: Record<string, string> = { LOW: 'کم', NORMAL: 'عادی', HIGH: 'بالا', URGENT: 'فوری' };

export default function SupportHistoryPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    supportTicketsAPI.list(status ? { status } : undefined)
      .then((response) => setRows(response.data.data))
      .catch((requestError) => setError(requestError.response?.data?.error || 'دریافت تیکت‌ها ممکن نشد.'))
      .finally(() => setLoading(false));
  }, [status]);

  return (
    <ErpPage
      eyebrow="پشتیبانی"
      title="تاریخچه و صف تیکت‌ها"
      description="تیکت‌هایی که گزارش کرده‌اید یا در رسیدگی آن‌ها مشارکت دارید اینجا نمایش داده می‌شوند."
      actions={[{ label: 'ثبت تیکت جدید', href: '/dashboard/support/new', icon: FaPlus, tone: 'primary', variant: 'solid' }]}
      metrics={[
        { label: 'کل قابل مشاهده', value: rows.length.toLocaleString('fa-IR'), icon: FaLifeRing },
        { label: 'باز', value: rows.filter((row) => !['RESOLVED', 'CLOSED'].includes(row.status)).length.toLocaleString('fa-IR'), tone: 'warning' },
      ]}
    >
      <div className="mb-4 max-w-xs" dir="rtl">
        <label className="mb-2 block text-sm font-bold">وضعیت</label>
        <ErpSelect value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">همه وضعیت‌ها</option>
          {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </ErpSelect>
      </div>
      {error && <ErpCard tone="danger"><p role="alert">{error}</p></ErpCard>}
      {loading ? <ErpLoading /> : rows.length === 0 ? (
        <ErpEmptyState icon={FaLifeRing} title="تیکتی در این محدوده نیست" action={{ label: 'ثبت اولین تیکت', href: '/dashboard/support/new' }} />
      ) : (
        <div className="grid gap-3" dir="rtl">
          {rows.map((ticket) => {
            const priority = ticket.confirmedPriority || ticket.suggestedPriority;
            return (
              <Link key={ticket.id} href={`/dashboard/support/tickets/${ticket.id}`} className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)]">
                <ErpCard interactive>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-bold text-[var(--sds-text-primary)]">{ticket.title}</h2>
                        {ticket.restrictedIncident && <ErpBadge tone="danger">محرمانه</ErpBadge>}
                      </div>
                      <p className="mt-1 text-xs text-[var(--sds-text-muted)]">{ticket.referenceCode} · {new Date(ticket.createdAt).toLocaleString('fa-IR')}</p>
                      <p className="mt-2 text-sm text-[var(--sds-text-secondary)]">
                        {workspaceLabelFa(ticket.reportedWorkspace)}
                        {ticket.reportedFeature ? ` / ${featureLabelFa(ticket.reportedFeature)}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {ticket.operationalTargetState === 'NEAR_BREACH' && <ErpBadge tone="warning">در آستانه تأخیر</ErpBadge>}
                      {ticket.operationalTargetState === 'OVERDUE' && <ErpBadge tone="danger">تأخیر</ErpBadge>}
                      <ErpBadge tone={priority === 'URGENT' ? 'danger' : priority === 'HIGH' ? 'warning' : 'neutral'}>{priorityLabels[priority] || priority}</ErpBadge>
                      <ErpBadge tone={ticket.status === 'CLOSED' ? 'neutral' : ticket.status === 'RESOLVED' ? 'success' : 'info'}>{statusLabels[ticket.status] || ticket.status}</ErpBadge>
                    </div>
                  </div>
                </ErpCard>
              </Link>
            );
          })}
        </div>
      )}
    </ErpPage>
  );
}
