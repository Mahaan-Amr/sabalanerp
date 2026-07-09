'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  FaBan,
  FaCheck,
  FaEdit,
  FaEye,
  FaPlus,
  FaPrint,
  FaSearch,
  FaSync,
  FaTrash,
  FaTruck,
} from 'react-icons/fa';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpLoading,
  ErpPage,
  ErpPagination,
  ErpQuickFilters,
} from '@/components/erp';
import { logisticsAPI } from '@/lib/api';
import { StatusBadge, dateFa, loadingDriversName } from '../logistics-ui';

const canFinalize = (row: any) => row.status === 'DRAFT';
const canDelete = (row: any) => row.status === 'DRAFT';
const canCancel = (row: any) => row.status !== 'CANCELLED';
const canEdit = (row: any) => row.status === 'DRAFT';

const actionLabel = (action: 'finalize' | 'delete' | 'cancel' | 'print') => ({
  finalize: 'نهایی‌سازی',
  delete: 'حذف',
  cancel: 'لغو',
  print: 'چاپ',
}[action]);

export default function LogisticsLoadingsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [status, setStatus] = useState('ALL');
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    try {
      setIsLoading(true);
      const response = await logisticsAPI.getLoadings();
      if (response.data.success) {
        setRows(response.data.data);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'دریافت بارگیری‌ها ناموفق بود.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const counts = useMemo(() => ({
    ALL: rows.length,
    DRAFT: rows.filter((row) => row.status === 'DRAFT').length,
    FINALIZED: rows.filter((row) => row.status === 'FINALIZED').length,
    CANCELLED: rows.filter((row) => row.status === 'CANCELLED').length,
  }), [rows]);

  const filteredRows = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (status !== 'ALL' && row.status !== status) return false;
      if (!normalized) return true;
      return [
        row.loadingNumber,
        row.customerName,
        row.projectName,
        loadingDriversName(row),
        row.status,
      ].some((value) => String(value || '').toLowerCase().includes(normalized));
    });
  }, [rows, search, status]);

  const selectedRows = useMemo(() => rows.filter((row) => selectedIds.includes(row.id)), [rows, selectedIds]);
  const selectedVisibleRows = useMemo(() => filteredRows.filter((row) => selectedIds.includes(row.id)), [filteredRows, selectedIds]);
  const allVisibleSelected = filteredRows.length > 0 && selectedVisibleRows.length === filteredRows.length;

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const toggleVisible = () => {
    const visibleIds = filteredRows.map((row) => row.id);
    setSelectedIds((current) => {
      if (allVisibleSelected) return current.filter((id) => !visibleIds.includes(id));
      return Array.from(new Set([...current, ...visibleIds]));
    });
  };

  const selectByStatus = (nextStatus: string) => {
    setStatus(nextStatus);
    setSelectedIds(rows.filter((row) => row.status === nextStatus).map((row) => row.id));
  };

  const removeMissingSelections = (nextRows: any[]) => {
    const nextIds = new Set(nextRows.map((row) => row.id));
    setSelectedIds((current) => current.filter((id) => nextIds.has(id)));
  };

  const reloadAfterAction = async () => {
    const response = await logisticsAPI.getLoadings();
    if (response.data.success) {
      setRows(response.data.data);
      removeMissingSelections(response.data.data);
    }
  };

  const runSingle = async (row: any, action: 'finalize' | 'delete' | 'cancel' | 'print') => {
    setMessage('');
    setError('');

    if (action === 'print') {
      window.open(`/dashboard/logistics/loadings/${row.id}?print=1`, '_blank', 'noopener,noreferrer');
      return;
    }

    if (action === 'finalize' && !confirm(`بارگیری ${row.loadingNumber} نهایی شود؟`)) return;
    if (action === 'delete' && !confirm(`پیش‌نویس ${row.loadingNumber} حذف شود؟ این عملیات قابل بازگشت نیست.`)) return;

    let reason = '';
    if (action === 'cancel') {
      reason = prompt(`دلیل لغو بارگیری ${row.loadingNumber} را وارد کنید:`) || '';
      if (!reason.trim()) return;
    }

    try {
      setActing(true);
      if (action === 'finalize') await logisticsAPI.finalizeLoading(row.id);
      if (action === 'delete') await logisticsAPI.deleteLoading(row.id);
      if (action === 'cancel') await logisticsAPI.cancelLoading(row.id, reason.trim());
      await reloadAfterAction();
      setMessage(`${actionLabel(action)} بارگیری ${row.loadingNumber} انجام شد.`);
    } catch (err: any) {
      setError(err.response?.data?.error || `عملیات ${actionLabel(action)} ناموفق بود.`);
    } finally {
      setActing(false);
    }
  };

  const eligibleRows = (action: 'finalize' | 'delete' | 'cancel' | 'print') => {
    if (action === 'finalize') return selectedRows.filter(canFinalize);
    if (action === 'delete') return selectedRows.filter(canDelete);
    if (action === 'cancel') return selectedRows.filter(canCancel);
    return selectedRows;
  };

  const runBulk = async (action: 'finalize' | 'delete' | 'cancel' | 'print') => {
    const targets = eligibleRows(action);
    if (!targets.length) return;

    setMessage('');
    setError('');

    if (action === 'print') {
      targets.forEach((row) => window.open(`/dashboard/logistics/loadings/${row.id}?print=1`, '_blank', 'noopener,noreferrer'));
      return;
    }

    if (action === 'finalize' && !confirm(`${targets.length.toLocaleString('fa-IR')} بارگیری پیش‌نویس نهایی شود؟`)) return;
    if (action === 'delete' && !confirm(`${targets.length.toLocaleString('fa-IR')} پیش‌نویس حذف شود؟ این عملیات قابل بازگشت نیست.`)) return;

    let reason = '';
    if (action === 'cancel') {
      reason = prompt(`دلیل لغو گروهی ${targets.length.toLocaleString('fa-IR')} بارگیری را وارد کنید:`) || '';
      if (!reason.trim()) return;
    }

    const failures: string[] = [];
    try {
      setActing(true);
      for (const row of targets) {
        try {
          if (action === 'finalize') await logisticsAPI.finalizeLoading(row.id);
          if (action === 'delete') await logisticsAPI.deleteLoading(row.id);
          if (action === 'cancel') await logisticsAPI.cancelLoading(row.id, reason.trim());
        } catch (err: any) {
          failures.push(`${row.loadingNumber}: ${err.response?.data?.error || 'ناموفق'}`);
        }
      }
      await reloadAfterAction();
      if (failures.length) {
        setError(`برخی عملیات‌ها ناموفق بود: ${failures.join(' | ')}`);
      } else {
        setMessage(`${actionLabel(action)} گروهی برای ${targets.length.toLocaleString('fa-IR')} بارگیری انجام شد.`);
      }
    } finally {
      setActing(false);
    }
  };

  if (isLoading) return <ErpLoading />;

  return (
    <ErpPage
      title="بارگیری‌ها"
      description="رجیستر عملیاتی بارگیری‌ها؛ مشاهده، ویرایش، چاپ، نهایی‌سازی، لغو و عملیات گروهی بر اساس وضعیت."
      actions={[
        { label: 'بارگیری جدید', href: '/dashboard/logistics/loadings/new', icon: FaPlus },
        { label: 'به‌روزرسانی', onClick: () => { void load(); }, icon: FaSync, tone: 'neutral' },
      ]}
    >
      {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['همه', counts.ALL, 'ALL', 'neutral'],
          ['پیش‌نویس', counts.DRAFT, 'DRAFT', 'warning'],
          ['نهایی‌شده', counts.FINALIZED, 'FINALIZED', 'success'],
          ['لغوشده', counts.CANCELLED, 'CANCELLED', 'danger'],
        ].map(([label, value, key, tone]) => (
          <button
            key={String(key)}
            type="button"
            onClick={() => setStatus(String(key))}
            className={`rounded-xl border p-4 text-right transition ${
              status === key
                ? 'border-[#074747] bg-teal-50 text-[#074747] dark:border-teal-500 dark:bg-teal-950/30 dark:text-teal-100'
                : 'border-slate-200 bg-white text-slate-700 hover:border-[#074747]/40 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200'
            }`}
          >
            <p className="text-xs text-slate-500">{String(label)}</p>
            <p className="mt-1 text-2xl font-bold">{Number(value).toLocaleString('fa-IR')}</p>
            <span className="mt-2 inline-block"><ErpBadge tone={tone as any}>{String(label)}</ErpBadge></span>
          </button>
        ))}
      </div>

      <ErpCard className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative max-w-xl flex-1">
            <FaSearch className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="جستجو در شماره، مشتری، پروژه، راننده یا وضعیت"
              className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-4 pr-10 text-sm outline-none focus:border-[#074747] dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <ErpQuickFilters
            value={status}
            onChange={(value) => setStatus(value)}
            items={[
              { id: 'ALL', value: 'ALL', label: 'همه', count: counts.ALL },
              { id: 'DRAFT', value: 'DRAFT', label: 'پیش‌نویس', count: counts.DRAFT, tone: 'warning' },
              { id: 'FINALIZED', value: 'FINALIZED', label: 'نهایی‌شده', count: counts.FINALIZED, tone: 'success' },
              { id: 'CANCELLED', value: 'CANCELLED', label: 'لغوشده', count: counts.CANCELLED, tone: 'danger' },
            ]}
          />
        </div>
      </ErpCard>

      <ErpCard className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">عملیات گروهی</p>
            <p className="mt-1 text-xs text-slate-500">
              {selectedRows.length
                ? `${selectedRows.length.toLocaleString('fa-IR')} سند انتخاب شده`
                : 'برای فعال‌شدن عملیات گروهی چند سند را انتخاب کنید.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ErpButton label={allVisibleSelected ? 'لغو انتخاب صفحه' : 'انتخاب صفحه'} onClick={toggleVisible} tone="neutral" variant="soft" disabled={!filteredRows.length || acting} />
            <ErpButton label="انتخاب پیش‌نویس‌ها" onClick={() => selectByStatus('DRAFT')} tone="warning" variant="soft" disabled={acting} />
            <ErpButton label="پاک‌کردن انتخاب" onClick={() => setSelectedIds([])} tone="neutral" variant="ghost" disabled={!selectedRows.length || acting} />
            <ErpButton label="نهایی‌سازی گروهی" icon={FaCheck} onClick={() => { void runBulk('finalize'); }} tone="success" disabled={!selectedRows.some(canFinalize) || acting} />
            <ErpButton label="لغو گروهی" icon={FaBan} onClick={() => { void runBulk('cancel'); }} tone="danger" disabled={!selectedRows.some(canCancel) || acting} />
            <ErpButton label="حذف پیش‌نویس‌ها" icon={FaTrash} onClick={() => { void runBulk('delete'); }} tone="danger" variant="outline" disabled={!selectedRows.some(canDelete) || acting} />
            <ErpButton label="چاپ انتخاب‌شده‌ها" icon={FaPrint} onClick={() => { void runBulk('print'); }} tone="neutral" disabled={!selectedRows.length || acting} />
          </div>
        </div>
      </ErpCard>

      <ErpCard className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-right text-sm dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-900/70">
              <tr>
                <th className="px-3 py-3"><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} /></th>
                <th className="px-3 py-3 font-semibold text-slate-500">شماره</th>
                <th className="px-3 py-3 font-semibold text-slate-500">وضعیت</th>
                <th className="px-3 py-3 font-semibold text-slate-500">مشتری / پروژه</th>
                <th className="px-3 py-3 font-semibold text-slate-500">رانندگان</th>
                <th className="px-3 py-3 font-semibold text-slate-500">تاریخ</th>
                <th className="px-3 py-3 text-center font-semibold text-slate-500">ردیف</th>
                <th className="px-3 py-3 text-center font-semibold text-slate-500">اصلاح</th>
                <th className="px-3 py-3 font-semibold text-slate-500">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-950">
              {filteredRows.map((row) => {
                const selected = selectedIds.includes(row.id);
                return (
                  <tr key={row.id} className={selected ? 'bg-[#074747]/5 dark:bg-teal-950/20' : undefined}>
                    <td className="px-3 py-3 align-top"><input type="checkbox" checked={selected} onChange={() => toggleSelected(row.id)} /></td>
                    <td className="px-3 py-3 align-top">
                      <a className="font-semibold text-[#074747] dark:text-teal-200" href={`/dashboard/logistics/loadings/${row.id}`}>{row.loadingNumber}</a>
                    </td>
                    <td className="px-3 py-3 align-top"><StatusBadge status={row.status} /></td>
                    <td className="px-3 py-3 align-top">
                      <p className="font-medium text-slate-900 dark:text-white">{row.customerName || '—'}</p>
                      <p className="mt-1 text-xs text-slate-500">{row.projectName || '—'}</p>
                    </td>
                    <td className="px-3 py-3 align-top text-slate-700 dark:text-slate-200">{loadingDriversName(row)}</td>
                    <td className="px-3 py-3 align-top text-slate-600 dark:text-slate-300">{dateFa(row.loadingDate)}</td>
                    <td className="px-3 py-3 text-center align-top">{(row.lineCount || 0).toLocaleString('fa-IR')}</td>
                    <td className="px-3 py-3 text-center align-top">
                      {row.correctionCount ? <ErpBadge tone="warning">{row.correctionCount.toLocaleString('fa-IR')}</ErpBadge> : <span className="text-slate-400">۰</span>}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="flex flex-wrap gap-1">
                        <ErpButton label="مشاهده" icon={FaEye} href={`/dashboard/logistics/loadings/${row.id}`} variant="ghost" tone="neutral" />
                        <ErpButton label="ویرایش" icon={FaEdit} href={`/dashboard/logistics/loadings/new?draftId=${row.id}`} variant="ghost" tone="primary" disabled={!canEdit(row)} />
                        <ErpButton label="نهایی‌سازی" icon={FaCheck} onClick={() => { void runSingle(row, 'finalize'); }} variant="ghost" tone="success" disabled={!canFinalize(row) || acting} />
                        <ErpButton label="چاپ" icon={FaPrint} onClick={() => { void runSingle(row, 'print'); }} variant="ghost" tone="neutral" disabled={acting} />
                        <ErpButton label="لغو" icon={FaBan} onClick={() => { void runSingle(row, 'cancel'); }} variant="ghost" tone="danger" disabled={!canCancel(row) || acting} />
                        <ErpButton label="حذف" icon={FaTrash} onClick={() => { void runSingle(row, 'delete'); }} variant="ghost" tone="danger" disabled={!canDelete(row) || acting} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!filteredRows.length && (
          <div className="p-8">
            <ErpEmptyState
              icon={FaTruck}
              title="بارگیری‌ای برای نمایش وجود ندارد"
              action={{ label: 'بارگیری جدید', href: '/dashboard/logistics/loadings/new', icon: FaPlus }}
            />
          </div>
        )}
      </ErpCard>

      <ErpPagination
        currentPage={1}
        totalPages={1}
        onPageChange={() => undefined}
        totalItems={filteredRows.length}
        itemsPerPage={filteredRows.length || 1}
        itemLabel="بارگیری"
      />
    </ErpPage>
  );
}
