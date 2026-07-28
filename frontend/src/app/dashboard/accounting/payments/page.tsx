'use client';
import { useCallback, useEffect, useState } from 'react';
import { FaMoneyCheckAlt, FaSync } from 'react-icons/fa';
import { ErpEmptyState, ErpListPage, ErpPagination, type ErpAction, type ErpColumn } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { emptyAccountingPagination, readAccountingListResponse, StatusBadge, dateFa, money } from '@/features/accounting/accountingUi';
import AccountingActionModal from '@/features/accounting/AccountingActionModal';
import PersianCalendar from '@/lib/persian-calendar';

const checkStatusOptions = [
  { label: 'همه چک‌ها', value: 'ALL' },
  { label: 'دریافت شده', value: 'RECEIVED' },
  { label: 'واگذار شده', value: 'DEPOSITED' },
  { label: 'وصول شده', value: 'CLEARED' },
  { label: 'برگشت خورده', value: 'BOUNCED' },
];

export default function AccountingPaymentsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState(emptyAccountingPagination);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [checkStatus, setCheckStatus] = useState('ALL');
  const [checkTarget, setCheckTarget] = useState<{ row: any; status: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadRows = useCallback(async (page = 1) => {
    try {
      setLoading(true);
      const response = await accountingAPI.getPayments({ search, checkStatus, page, pageSize: pagination.pageSize });
      if (response.data.success) {
        const data = readAccountingListResponse<any>(response.data.data);
        setRows(data.items);
        setPagination({ page: data.page, pageSize: data.pageSize, total: data.total });
      }
    } catch (error) {
      console.error('Error loading payments:', error);
    } finally {
      setLoading(false);
    }
  }, [checkStatus, pagination.pageSize, search]);

  useEffect(() => {
    loadRows(1);
  }, [loadRows]);

  const updateCheck = async (values: Record<string, string | number>) => {
    if (!checkTarget) return;
    try {
      setActionError(null);
      setActionLoading(`${checkTarget.row.id}:${checkTarget.status}`);
      await accountingAPI.executeAction({
        kind: 'UPDATE_CHECK_STATUS',
        paymentEventId: checkTarget.row.id,
        status: checkTarget.status,
        occurredAt: PersianCalendar.toGregorian(String(values.occurredAt)).toISOString(),
        note: String(values.note || ''),
      });
      setCheckTarget(null);
      await loadRows(pagination.page);
    } catch (error) {
      console.error('Error updating check:', error);
      setActionError((error as any)?.response?.data?.error || 'به‌روزرسانی وضعیت چک انجام نشد');
    } finally {
      setActionLoading(null);
    }
  };

  const columns: ErpColumn<any>[] = [
    { id: 'payment', header: 'دریافت / چک', priority: 'primary', cell: (row) => <div><p className="font-semibold">{row.method === 'CHECK' ? `چک ${row.checkNumber || ''}` : 'دریافت'}</p><p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{row.contract?.contractNumber || row.contractId || '—'} · {row.contract?.customer?.displayName || 'مشتری ثبت نشده'}</p></div> },
    { id: 'amount', header: 'مبلغ', mobileLabel: 'مبلغ', priority: 'secondary', align: 'end', cell: (row) => money(row.amount, row.currency) },
    { id: 'due', header: 'سررسید چک', mobileLabel: 'سررسید چک', priority: 'meta', cell: (row) => dateFa(row.checkDueDate) },
    { id: 'status', header: 'وضعیت', mobileLabel: 'وضعیت', priority: 'secondary', cell: (row) => <StatusBadge status={row.checkStatus || row.status} /> },
  ];

  const rowActions = (row: any): ErpAction[] => row.method === 'CHECK'
    ? [
        { label: 'واگذار شد', icon: FaMoneyCheckAlt, tone: 'info', disabled: actionLoading === `${row.id}:DEPOSITED`, onClick: () => setCheckTarget({ row, status: 'DEPOSITED' }) },
        { label: 'وصول شد', icon: FaMoneyCheckAlt, tone: 'success', disabled: actionLoading === `${row.id}:CLEARED`, onClick: () => setCheckTarget({ row, status: 'CLEARED' }) },
        { label: 'برگشت خورد', icon: FaMoneyCheckAlt, tone: 'danger', disabled: actionLoading === `${row.id}:BOUNCED`, onClick: () => setCheckTarget({ row, status: 'BOUNCED' }) },
      ]
    : [];

  return (
    <ErpListPage
      eyebrow="حسابداری"
      title="دریافت‌ها و چک‌ها"
      description="پیگیری وضعیت دریافت نقدی، کارت، حواله و چک بدون تغییر دادن برنامه پرداخت ثبت شده در فروش."
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: () => loadRows(pagination.page), tone: 'neutral' }]}
      filters={[
        { id: 'search', label: 'جستجو', type: 'search', value: search, onChange: setSearch, placeholder: 'شماره قرارداد یا مشتری...' },
        { id: 'checkStatus', label: 'وضعیت چک', type: 'select', value: checkStatus, onChange: setCheckStatus, options: checkStatusOptions },
      ]}
      rows={rows}
      rowKey={(row) => row.id}
      columns={columns}
      rowActions={rowActions}
      isLoading={loading}
      footer={<ErpPagination currentPage={pagination.page} totalPages={Math.max(Math.ceil(pagination.total / pagination.pageSize), 1)} totalItems={pagination.total} itemsPerPage={pagination.pageSize} onPageChange={loadRows} itemLabel="دریافت" />}
      emptyState={<ErpEmptyState icon={FaMoneyCheckAlt} title="دریافت یا چکی ثبت نشده است" description="دریافت‌ها از پرونده حسابداری قرارداد ثبت و پیگیری می‌شوند." />}
    >
      <AccountingActionModal
        open={Boolean(checkTarget)}
        title="به‌روزرسانی وضعیت چک"
        description={checkTarget ? `چک ${checkTarget.row.checkNumber || ''} - ${checkTarget.row.contract?.contractNumber || ''}` : undefined}
        fields={[
          { id: 'occurredAt', label: 'تاریخ رخداد', type: 'date', required: true },
          { id: 'note', label: 'یادداشت', type: 'textarea' },
        ]}
        submitLabel="ثبت وضعیت"
        busy={Boolean(actionLoading)}
        error={actionError}
        onClose={() => setCheckTarget(null)}
        onSubmit={updateCheck}
      />
    </ErpListPage>
  );
}
