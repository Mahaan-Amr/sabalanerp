'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FaLifeRing, FaPlus, FaRedo, FaSearch } from 'react-icons/fa';
import { authAPI, supportTicketsAPI } from '@/lib/api';
import { featureLabelFa, workspaceLabelFa } from '@/lib/featureLabelsFa';
import {
  ErpBadge,
  ErpCard,
  ErpEmptyState,
  ErpInlineState,
  ErpInput,
  ErpSegmentedControl,
  ErpSelect,
  ErpSkeleton,
  ErpWorkspacePage,
} from '@/components/erp';

const statusLabels: Record<string, string> = {
  NEW: 'جدید', TRIAGED: 'بررسی اولیه', IN_PROGRESS: 'در حال رسیدگی', WAITING_REPORTER: 'منتظر گزارشگر',
  RESOLVED: 'حل‌شده', CLOSED: 'بسته‌شده', DUPLICATE: 'تکراری',
};
const priorityLabels: Record<string, string> = { LOW: 'کم', NORMAL: 'عادی', HIGH: 'بالا', URGENT: 'فوری' };
type View = 'reported' | 'handling' | 'managed';

export default function SupportHistoryPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [view, setView] = useState<View>('reported');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [role, setRole] = useState('USER');
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [meResponse, ticketsResponse] = await Promise.all([
        authAPI.getMe(),
        supportTicketsAPI.list({ view, ...(status ? { status } : {}), ...(priority ? { priority } : {}), ...(debouncedSearch ? { search: debouncedSearch } : {}) }),
      ]);
      setRole(meResponse.data.user?.role || 'USER');
      setRows(ticketsResponse.data.data || []);
      setLoadedOnce(true);
      setError('');
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'دریافت درخواست‌ها انجام نشد.');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, priority, status, view]);

  useEffect(() => { void load(); }, [load]);

  const canManage = role === 'ADMIN' || role === 'MANAGER';
  useEffect(() => { if (!canManage && view === 'managed') setView('reported'); }, [canManage, view]);
  const watcherRows = useMemo(() => view === 'handling' ? rows.filter((row) => row.viewerParticipationRole === 'WATCHER') : [], [rows, view]);
  const activeRows = useMemo(() => view === 'handling' ? rows.filter((row) => row.viewerParticipationRole !== 'WATCHER') : rows, [rows, view]);

  const renderTicket = (ticket: any, watching = false) => {
    const ticketPriority = ticket.confirmedPriority || ticket.suggestedPriority;
    return (
      <Link key={ticket.id} href={`/dashboard/support/tickets/${ticket.id}`} className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)]">
        <ErpCard interactive className="p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate font-bold sds-text-primary">{ticket.title}</h2>
                {ticket.restrictedIncident && <ErpBadge tone="neutral">حفاظت‌شده</ErpBadge>}
                {watching && <ErpBadge tone="info">فقط دنبال‌کننده</ErpBadge>}
              </div>
              <p className="mt-1 text-xs sds-text-muted">{ticket.referenceCode} · {new Date(ticket.createdAt).toLocaleString('fa-IR')}</p>
              <p className="mt-2 text-sm sds-text-secondary">{workspaceLabelFa(ticket.reportedWorkspace)}{ticket.reportedFeature ? ` / ${featureLabelFa(ticket.reportedFeature)}` : ''}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {ticket.operationalTargetState === 'NEAR_BREACH' && <ErpBadge tone="warning">نزدیک به موعد</ErpBadge>}
              {ticket.operationalTargetState === 'OVERDUE' && <ErpBadge tone="danger">گذشته از موعد</ErpBadge>}
              <ErpBadge tone={ticketPriority === 'URGENT' ? 'danger' : ticketPriority === 'HIGH' ? 'warning' : 'neutral'}>{priorityLabels[ticketPriority] || ticketPriority}</ErpBadge>
              <ErpBadge tone={ticket.status === 'CLOSED' ? 'neutral' : ticket.status === 'RESOLVED' ? 'success' : 'info'}>{statusLabels[ticket.status] || ticket.status}</ErpBadge>
            </div>
          </div>
        </ErpCard>
      </Link>
    );
  };

  return (
    <ErpWorkspacePage title="پشتیبانی" primaryAction={{ label: 'ثبت درخواست', href: '/dashboard/support/new', icon: FaPlus, tone: 'primary', variant: 'solid' }} secondaryActions={[{ label: 'به‌روزرسانی', icon: FaRedo, onClick: () => void load() }]}>
      <ErpCard className="p-3 sm:p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem_12rem]">
          <div className="relative"><FaSearch className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 sds-text-muted" /><ErpInput className="pr-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="جست‌وجوی عنوان یا شناسه" /></div>
          <ErpSelect value={status} onChange={(event) => setStatus(event.target.value)} aria-label="وضعیت"><option value="">همه وضعیت‌ها</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</ErpSelect>
          <ErpSelect value={priority} onChange={(event) => setPriority(event.target.value)} aria-label="اولویت"><option value="">همه اولویت‌ها</option>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</ErpSelect>
        </div>
        <div className="mt-3 overflow-x-auto">
          <ErpSegmentedControl value={view} onChange={(value) => setView(value as View)} options={[{ value: 'reported', label: 'درخواست‌های من' }, { value: 'handling', label: 'در حال رسیدگی' }, ...(canManage ? [{ value: 'managed', label: 'محدوده مدیریتی' }] : [])]} />
        </div>
      </ErpCard>

      {error && loadedOnce && <ErpInlineState kind="error" title={`به‌روزرسانی انجام نشد: ${error}`} action={{ label: 'تلاش دوباره', onClick: () => void load() }} />}
      {loading && !loadedOnce ? <div className="grid gap-3"><ErpSkeleton lines={2} /><ErpSkeleton lines={2} /></div> : error && !loadedOnce ? <ErpInlineState kind="error" title={`درخواست‌ها در دسترس نیستند: ${error}`} action={{ label: 'تلاش دوباره', onClick: () => void load() }} /> : rows.length === 0 ? <ErpEmptyState icon={FaLifeRing} title="درخواستی در این محدوده نیست" action={{ label: 'ثبت درخواست', href: '/dashboard/support/new' }} /> : (
        <div className="space-y-5" dir="rtl">
          {activeRows.length > 0 && <section className="grid gap-3">{activeRows.map((ticket) => renderTicket(ticket))}</section>}
          {watcherRows.length > 0 && <section><h2 className="mb-3 text-sm font-black sds-text-secondary">دنبال می‌کنم</h2><div className="grid gap-3">{watcherRows.map((ticket) => renderTicket(ticket, true))}</div></section>}
        </div>
      )}
    </ErpWorkspacePage>
  );
}
