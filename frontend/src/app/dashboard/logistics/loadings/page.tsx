'use client';
import { ErpField, ErpInput, ErpPressable, ErpSheet, ErpTextarea } from '@/components/erp';
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
  ErpInlineState,
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
  const [actionRequest, setActionRequest] = useState<null | { action: 'finalize' | 'delete' | 'cancel'; targets: any[] }>(null);
  const [actionReason, setActionReason] = useState('');

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

    setActionReason('');
    setActionRequest({ action, targets: [row] });
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

    setActionReason('');
    setActionRequest({ action, targets });
  };

  const confirmRequestedAction = async () => {
    if (!actionRequest || acting || (actionRequest.action === 'cancel' && !actionReason.trim())) return;
    const { action, targets } = actionRequest;
    const failures: string[] = [];
    try {
      setActing(true);
      for (const row of targets) {
        try {
          if (action === 'finalize') await logisticsAPI.finalizeLoading(row.id);
          if (action === 'delete') await logisticsAPI.deleteLoading(row.id);
          if (action === 'cancel') await logisticsAPI.cancelLoading(row.id, actionReason.trim());
        } catch (err: any) {
          failures.push(`${row.loadingNumber}: ${err.response?.data?.error || 'ناموفق'}`);
        }
      }
      await reloadAfterAction();
      if (failures.length) {
        setError(`برخی عملیات‌ها ناموفق بود: ${failures.join(' | ')}`);
      } else {
        setMessage(targets.length === 1 ? `${actionLabel(action)} بارگیری ${targets[0].loadingNumber} انجام شد.` : `${actionLabel(action)} گروهی برای ${targets.length.toLocaleString('fa-IR')} بارگیری انجام شد.`);
      }
    } finally {
      setActing(false);
      setActionRequest(null);
      setActionReason('');
    }
  };

  if (isLoading) return <ErpLoading />;

  return (
    <ErpPage
      title="بارگیری‌ها"
      actions={[
        { label: 'بارگیری جدید', href: '/dashboard/logistics/loadings/new', icon: FaPlus },
        { label: 'به‌روزرسانی', onClick: () => { void load(); }, icon: FaSync, tone: 'neutral' },
      ]}
    >
      {message && <ErpInlineState kind="success" title={message} />}
      {error && <ErpInlineState kind="error" title={error} />}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['همه', counts.ALL, 'ALL', 'neutral'],
          ['پیش‌نویس', counts.DRAFT, 'DRAFT', 'warning'],
          ['نهایی‌شده', counts.FINALIZED, 'FINALIZED', 'success'],
          ['لغوشده', counts.CANCELLED, 'CANCELLED', 'danger'],
        ].map(([label, value, key, tone]) => (
          <ErpPressable
            key={String(key)}
            type="button"
            onClick={() => setStatus(String(key))}
            className={`rounded-xl border p-4 text-right transition ${
              status === key
                ? 'border-[var(--sds-accent)] bg-[var(--sds-accent-surface)] text-[var(--sds-accent)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-accent-surface)] dark:text-[var(--sds-accent)]'
                : 'border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] hover:border-[var(--sds-accent)]/40 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)]'
            }`}
          >
            <p className="text-xs text-[var(--sds-text-secondary)]">{String(label)}</p>
            <p className="mt-1 text-2xl font-bold">{Number(value).toLocaleString('fa-IR')}</p>
            <span className="mt-2 inline-block"><ErpBadge tone={tone as any}>{String(label)}</ErpBadge></span>
          </ErpPressable>
        ))}
      </div>

      <ErpCard className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative max-w-xl flex-1">
            <FaSearch className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--sds-text-muted)]" />
            <ErpInput
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="جستجو در شماره، مشتری، پروژه، راننده یا وضعیت"
              className="w-full rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] py-3 pl-4 pr-10 text-sm outline-none focus:border-[var(--sds-accent)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]"
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
            <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">عملیات گروهی</p>
            <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">
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
            <thead className="bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)]">
              <tr>
                <th className="px-3 py-3"><ErpInput type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} /></th>
                <th className="px-3 py-3 font-semibold text-[var(--sds-text-secondary)]">شماره</th>
                <th className="px-3 py-3 font-semibold text-[var(--sds-text-secondary)]">وضعیت</th>
                <th className="px-3 py-3 font-semibold text-[var(--sds-text-secondary)]">مشتری / پروژه</th>
                <th className="px-3 py-3 font-semibold text-[var(--sds-text-secondary)]">رانندگان</th>
                <th className="px-3 py-3 font-semibold text-[var(--sds-text-secondary)]">تاریخ</th>
                <th className="px-3 py-3 text-center font-semibold text-[var(--sds-text-secondary)]">ردیف</th>
                <th className="px-3 py-3 text-center font-semibold text-[var(--sds-text-secondary)]">اصلاح</th>
                <th className="px-3 py-3 font-semibold text-[var(--sds-text-secondary)]">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-[var(--sds-surface-raised)] dark:divide-slate-800 dark:bg-[var(--sds-surface-raised)]">
              {filteredRows.map((row) => {
                const selected = selectedIds.includes(row.id);
                return (
                  <tr key={row.id} className={selected ? 'bg-[var(--sds-accent)]/5 dark:bg-[var(--sds-accent-surface)]' : undefined}>
                    <td className="px-3 py-3 align-top"><ErpInput type="checkbox" checked={selected} onChange={() => toggleSelected(row.id)} /></td>
                    <td className="px-3 py-3 align-top">
                      <a className="font-semibold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]" href={`/dashboard/logistics/loadings/${row.id}`}>{row.loadingNumber}</a>
                    </td>
                    <td className="px-3 py-3 align-top"><StatusBadge status={row.status} /></td>
                    <td className="px-3 py-3 align-top">
                      <p className="font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{row.customerName || '—'}</p>
                      <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{row.projectName || '—'}</p>
                    </td>
                    <td className="px-3 py-3 align-top text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{loadingDriversName(row)}</td>
                    <td className="px-3 py-3 align-top text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{dateFa(row.loadingDate)}</td>
                    <td className="px-3 py-3 text-center align-top">{(row.lineCount || 0).toLocaleString('fa-IR')}</td>
                    <td className="px-3 py-3 text-center align-top">
                      {row.correctionCount ? <ErpBadge tone="warning">{row.correctionCount.toLocaleString('fa-IR')}</ErpBadge> : <span className="text-[var(--sds-text-muted)]">۰</span>}
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
      <ErpSheet
        open={Boolean(actionRequest)}
        onClose={() => { if (!acting) { setActionRequest(null); setActionReason(''); } }}
        title={`${actionRequest ? actionLabel(actionRequest.action) : ''} ${actionRequest?.targets.length === 1 ? `بارگیری ${actionRequest.targets[0].loadingNumber}` : `${actionRequest?.targets.length.toLocaleString('fa-IR')} بارگیری`}`}
        presentation="modal"
        pending={acting}
        footer={<div className="flex justify-end gap-2"><ErpButton label="انصراف" variant="ghost" disabled={acting} onClick={() => { setActionRequest(null); setActionReason(''); }} /><ErpButton label="تأیید و اجرا" tone={actionRequest?.action === 'finalize' ? 'success' : 'danger'} variant="solid" disabled={acting || (actionRequest?.action === 'cancel' && !actionReason.trim())} onClick={() => void confirmRequestedAction()} /></div>}
      >
        <div className="space-y-4">
          <ErpInlineState kind={actionRequest?.action === 'delete' ? 'error' : 'stale'} title={actionRequest?.action === 'delete' ? 'حذف پیش‌نویس قابل بازگشت نیست.' : 'پیش از اجرا، تعداد و نوع عملیات را بازبینی کنید.'} />
          {actionRequest?.action === 'cancel' && <ErpField label="دلیل لغو" required><ErpTextarea value={actionReason} onChange={(event) => setActionReason(event.target.value)} /></ErpField>}
        </div>
      </ErpSheet>
    </ErpPage>
  );
}
