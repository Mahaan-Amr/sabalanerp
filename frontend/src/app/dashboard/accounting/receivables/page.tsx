'use client';
import { useCallback, useEffect, useState } from 'react';
import { FaReceipt, FaSync } from 'react-icons/fa';
import { ErpEmptyState, ErpListPage, ErpPagination, type ErpAction, type ErpColumn } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { emptyAccountingPagination, readAccountingListResponse, StatusBadge, dateFa, money } from '@/features/accounting/accountingUi';
import AccountingActionModal from '@/features/accounting/AccountingActionModal';
import PersianCalendar from '@/lib/persian-calendar';

const statusOptions = [
  { label: 'همه وضعیت‌ها', value: 'ALL' },
  { label: 'باز', value: 'OPEN' },
  { label: 'پرداخت بخشی', value: 'PARTIALLY_PAID' },
  { label: 'تسویه شده', value: 'SETTLED' },
  { label: 'سررسید گذشته', value: 'OVERDUE' },
  { label: 'باطل شده', value: 'VOIDED' },
];

export default function AccountingReceivablesPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState(emptyAccountingPagination);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [receiptTarget, setReceiptTarget] = useState<any | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadRows = useCallback(async (page = 1) => {
    try {
      setLoading(true);
      const response = await accountingAPI.getReceivables({ search, status, page, pageSize: pagination.pageSize });
      if (response.data.success) {
        const data = readAccountingListResponse<any>(response.data.data);
        setRows(data.items);
        setPagination({ page: data.page, pageSize: data.pageSize, total: data.total });
      }
    } catch (error) {
      console.error('Error loading receivables:', error);
    } finally {
      setLoading(false);
    }
  }, [pagination.pageSize, search, status]);

  useEffect(() => {
    loadRows(1);
  }, [loadRows]);

  const columns: ErpColumn<any>[] = [
    { id: 'receivable', header: 'دریافتنی', priority: 'primary', cell: (row) => <div><p className="font-semibold">{row.contract?.contractNumber || 'دریافتنی قرارداد'}</p><p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{row.contract?.customer?.displayName || row.contractId || '—'}</p></div> },
    { id: 'original', header: 'اصل مبلغ', mobileLabel: 'اصل مبلغ', priority: 'secondary', align: 'end', cell: (row) => money(row.originalAmount, row.currency) },
    { id: 'paid', header: 'پرداخت شده', mobileLabel: 'پرداخت شده', priority: 'secondary', align: 'end', cell: (row) => money(row.paidAmount, row.currency) },
    { id: 'remaining', header: 'مانده', mobileLabel: 'مانده', priority: 'secondary', align: 'end', cell: (row) => <span className="font-semibold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">{money(row.remainingAmount, row.currency)}</span> },
    { id: 'due', header: 'سررسید', mobileLabel: 'سررسید', priority: 'meta', cell: (row) => dateFa(row.dueDate) },
    { id: 'status', header: 'وضعیت', mobileLabel: 'وضعیت', priority: 'meta', cell: (row) => <StatusBadge status={row.status} /> },
  ];

  const registerReceipt = async (values: Record<string, string | number>) => {
    if (!receiptTarget) return;
    setActionError(null);
    setActionLoading(receiptTarget.id);
    try {
      await accountingAPI.executeAction({
        kind: 'REGISTER_RECEIPT',
        contractId: receiptTarget.contractId,
        receivableId: receiptTarget.id,
        method: values.method,
        amount: values.amount,
        receivedAt: PersianCalendar.toGregorian(String(values.receivedAt)).toISOString(),
        note: String(values.note || ''),
      });
      setReceiptTarget(null);
      await loadRows(pagination.page);
    } catch (error) {
      console.error('Register receipt failed:', error);
      setActionError((error as any)?.response?.data?.error || 'ثبت دریافت انجام نشد');
    } finally {
      setActionLoading(null);
    }
  };

  const rowActions = (row: any): ErpAction[] => [
    {
      label: 'ثبت دریافت',
      icon: FaReceipt,
      tone: 'success',
      disabled: row.status === 'SETTLED' || row.status === 'VOIDED',
      onClick: () => setReceiptTarget(row),
    },
  ];

  return (
    <ErpListPage
      eyebrow="حسابداری"
      title="دریافتنی‌ها"
      description="مانده، سررسید، وصول بخشی و تسویه دریافتنی‌های ایجاد شده از قراردادها."
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: () => loadRows(pagination.page), tone: 'neutral' }]}
      filters={[
        { id: 'search', label: 'جستجو', type: 'search', value: search, onChange: setSearch, placeholder: 'شماره قرارداد یا مشتری...' },
        { id: 'status', label: 'وضعیت', type: 'select', value: status, onChange: setStatus, options: statusOptions },
      ]}
      rows={rows}
      rowKey={(row) => row.id}
      columns={columns}
      rowActions={rowActions}
      isLoading={loading}
      footer={<ErpPagination currentPage={pagination.page} totalPages={Math.max(Math.ceil(pagination.total / pagination.pageSize), 1)} totalItems={pagination.total} itemsPerPage={pagination.pageSize} onPageChange={loadRows} itemLabel="دریافتنی" />}
      emptyState={<ErpEmptyState icon={FaReceipt} title="دریافتنی ثبت نشده است" description="برای قراردادهای مجاز، دریافتنی برنامه‌ریزی شده ایجاد کنید." />}
    >
      <AccountingActionModal
        open={Boolean(receiptTarget)}
        title="ثبت دریافت"
        description={receiptTarget ? `${receiptTarget.contract?.contractNumber || 'قرارداد'} - مانده ${money(receiptTarget.remainingAmount, receiptTarget.currency)}` : undefined}
        fields={[
          { id: 'amount', label: 'مبلغ دریافت', type: 'number', required: true, defaultValue: receiptTarget?.remainingAmount || 0 },
          { id: 'method', label: 'روش دریافت', type: 'select', defaultValue: 'CASH', options: [
            { label: 'نقدی', value: 'CASH' },
            { label: 'حواله بانکی', value: 'BANK_TRANSFER' },
            { label: 'کارت', value: 'CARD' },
          ] },
          { id: 'receivedAt', label: 'تاریخ دریافت', type: 'date', required: true },
          { id: 'note', label: 'یادداشت', type: 'textarea' },
        ]}
        submitLabel="ثبت دریافت"
        busy={Boolean(actionLoading)}
        error={actionError}
        onClose={() => setReceiptTarget(null)}
        onSubmit={registerReceipt}
      />
    </ErpListPage>
  );
}
