'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FaHistory, FaSync } from 'react-icons/fa';
import { ErpEmptyState, ErpListPage, ErpPagination, type ErpColumn } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { emptyAccountingPagination, readAccountingListResponse, dateFa } from '@/features/accounting/accountingUi';
import {
  canonicalizeAuditQuery,
  patchAuditQuery,
  type AuditQueryState,
} from '@/features/accounting/accountingQueryState';

const actionOptions = [
  { label: 'همه عملیات', value: 'ALL' },
  { label: 'ایجاد پیش‌نویس', value: 'CREATE_INVOICE' },
  { label: 'تایید مالی', value: 'APPROVE_FINANCIAL_INVOICE' },
  { label: 'ایجاد دریافتنی', value: 'CREATE_RECEIVABLE' },
  { label: 'ثبت دریافت', value: 'REGISTER_RECEIPT' },
  { label: 'وضعیت چک', value: 'UPDATE_CHECK_STATUS' },
  { label: 'مالیات', value: 'TRACK_TAX_SUBMISSION' },
  { label: 'درخواست اصلاح', value: 'REQUEST_CORRECTION' },
  { label: 'بستن اصلاح', value: 'RESOLVE_CORRECTION' },
  { label: 'پرچم', value: 'FLAG_CONTRACT' },
];

export default function AccountingAuditPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canonicalQuery = useMemo(
    () => canonicalizeAuditQuery(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const query = canonicalQuery.state;
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState(emptyAccountingPagination);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState(query.search);

  const replaceQuery = useCallback((next: ReturnType<typeof canonicalizeAuditQuery>) => {
    const serialized = next.params.toString();
    router.replace(serialized ? `${pathname}?${serialized}` : pathname, { scroll: false });
  }, [pathname, router]);

  const updateQuery = useCallback((patch: Partial<AuditQueryState>) => {
    replaceQuery(patchAuditQuery(new URLSearchParams(searchParams.toString()), patch));
  }, [replaceQuery, searchParams]);

  useEffect(() => {
    if (canonicalQuery.params.toString() !== searchParams.toString()) replaceQuery(canonicalQuery);
  }, [canonicalQuery, replaceQuery, searchParams]);

  useEffect(() => setSearchInput(query.search), [query.search]);

  useEffect(() => {
    if (searchInput.trim() === query.search) return;
    const timeout = window.setTimeout(() => updateQuery({ search: searchInput }), 350);
    return () => window.clearTimeout(timeout);
  }, [query.search, searchInput, updateQuery]);

  const loadRows = useCallback(async () => {
    try {
      setLoading(true);
      const response = await accountingAPI.getAuditLogs({
        search: query.search || undefined,
        action: query.action,
        page: query.page,
        pageSize: pagination.pageSize,
      });
      if (response.data.success) {
        const data = readAccountingListResponse<any>(response.data.data);
        setRows(data.items);
        setPagination({ page: data.page, pageSize: data.pageSize, total: data.total });
      }
    } catch (error) {
      console.error('Error loading audit logs:', error);
    } finally {
      setLoading(false);
    }
  }, [pagination.pageSize, query.action, query.page, query.search]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const columns: ErpColumn<any>[] = [
    { id: 'action', header: 'عملیات', priority: 'primary', cell: (row) => <div><p className="font-semibold">{row.action}</p><p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{row.note || 'بدون یادداشت'}</p></div> },
    { id: 'actor', header: 'حسابدار', mobileLabel: 'حسابدار', priority: 'secondary', cell: (row) => row.actor?.displayName || row.actorId || '—' },
    { id: 'contract', header: 'قرارداد', mobileLabel: 'قرارداد', priority: 'secondary', cell: (row) => row.contract?.contractNumber || row.contractId || '—' },
    { id: 'entity', header: 'رکورد', mobileLabel: 'رکورد', priority: 'meta', cell: (row) => row.entityType || row.recordId || '—' },
    { id: 'date', header: 'زمان', mobileLabel: 'زمان', priority: 'secondary', cell: (row) => dateFa(row.createdAt) },
  ];

  return (
    <ErpListPage
      eyebrow="حسابداری"
      title="سوابق عملیات"
      description="ردیابی اقدام‌های حسابداری برای حسابرسی داخلی و حفظ شفافیت."
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: loadRows, tone: 'neutral' }]}
      filters={[
        { id: 'search', label: 'جستجو', type: 'search', value: searchInput, onChange: setSearchInput, placeholder: 'شماره قرارداد یا مشتری...' },
        { id: 'action', label: 'نوع عملیات', type: 'select', value: query.action, onChange: (value) => updateQuery({ action: value }), options: actionOptions },
      ]}
      rows={rows}
      rowKey={(row) => row.id}
      columns={columns}
      isLoading={loading}
      footer={<ErpPagination currentPage={pagination.page} totalPages={Math.max(Math.ceil(pagination.total / pagination.pageSize), 1)} totalItems={pagination.total} itemsPerPage={pagination.pageSize} onPageChange={(page) => updateQuery({ page })} itemLabel="سابقه" />}
      emptyState={<ErpEmptyState icon={FaHistory} title="هنوز سابقه‌ای ثبت نشده است" description="هر اقدام حسابداری در این بخش ثبت خواهد شد." />}
    />
  );
}
