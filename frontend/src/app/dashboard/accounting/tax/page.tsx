'use client';

import { useCallback, useEffect, useState } from 'react';
import { FaBalanceScale, FaCheck, FaSync, FaTimes } from 'react-icons/fa';
import { ErpEmptyState, ErpListPage, ErpPagination, type ErpAction, type ErpColumn } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { emptyAccountingPagination, readAccountingListResponse, StatusBadge, dateFa, money, taxStatusLabels } from '@/features/accounting/accountingUi';
import AccountingActionModal from '@/features/accounting/AccountingActionModal';
import PersianCalendar from '@/lib/persian-calendar';

const submissionStatusOptions = [
  { label: 'همه وضعیت‌ها', value: 'ALL' },
  { label: 'آماده نیست', value: 'NOT_READY' },
  { label: 'آماده', value: 'READY' },
  { label: 'ثبت دستی', value: 'SUBMITTED_MANUALLY' },
  { label: 'پذیرفته شده', value: 'ACCEPTED' },
  { label: 'رد شده', value: 'REJECTED' },
  { label: 'نیازمند اصلاح', value: 'NEEDS_CORRECTION' },
];

export default function AccountingTaxPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState(emptyAccountingPagination);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [submissionStatus, setSubmissionStatus] = useState('ALL');
  const [trackTarget, setTrackTarget] = useState<{ row: any; status: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadRows = useCallback(async (page = 1) => {
    try {
      setLoading(true);
      const response = await accountingAPI.getTaxRecords({ search, submissionStatus, page, pageSize: pagination.pageSize });
      if (response.data.success) {
        const data = readAccountingListResponse<any>(response.data.data);
        setRows(data.items);
        setPagination({ page: data.page, pageSize: data.pageSize, total: data.total });
      }
    } catch (error) {
      console.error('Error loading tax records:', error);
    } finally {
      setLoading(false);
    }
  }, [pagination.pageSize, search, submissionStatus]);

  useEffect(() => {
    loadRows(1);
  }, [loadRows]);

  const track = async (values: Record<string, string | number>) => {
    if (!trackTarget) return;
    try {
      setActionError(null);
      setActionLoading(`${trackTarget.row.id}:${trackTarget.status}`);
      await accountingAPI.executeAction({
        kind: 'TRACK_TAX_SUBMISSION',
        invoiceId: trackTarget.row.invoiceRecordId,
        status: trackTarget.status,
        trackingCode: String(values.trackingCode || ''),
        rejectionReason: String(values.rejectionReason || ''),
        note: String(values.note || ''),
        submittedAt: values.submittedAt ? PersianCalendar.toGregorian(String(values.submittedAt)).toISOString() : new Date().toISOString(),
      });
      setTrackTarget(null);
      await loadRows(pagination.page);
    } catch (error) {
      console.error('Error tracking tax:', error);
      setActionError((error as any)?.response?.data?.error || 'به‌روزرسانی مالیات انجام نشد');
    } finally {
      setActionLoading(null);
    }
  };

  const columns: ErpColumn<any>[] = [
    { id: 'tax', header: 'پرونده مالیاتی', priority: 'primary', cell: (row) => <div><p className="font-semibold">{taxStatusLabels[row.submissionStatus] || row.submissionStatus}</p><p className="mt-1 text-xs text-slate-500">{row.contract?.contractNumber || row.contractId || '—'} · {row.contract?.customer?.displayName || 'مشتری ثبت نشده'}</p></div> },
    { id: 'taxable', header: 'مشمول مالیات', mobileLabel: 'مشمول مالیات', priority: 'secondary', align: 'end', cell: (row) => money(row.taxableAmount) },
    { id: 'vat', header: 'ارزش افزوده', mobileLabel: 'ارزش افزوده', priority: 'secondary', align: 'end', cell: (row) => money(row.vatAmount) },
    { id: 'missing', header: 'کسری اطلاعات', mobileLabel: 'کسری اطلاعات', priority: 'meta', cell: (row) => row.missingFields?.length ? row.missingFields.join('، ') : '—' },
    { id: 'status', header: 'وضعیت', mobileLabel: 'وضعیت', priority: 'secondary', cell: (row) => <StatusBadge status={row.submissionStatus} /> },
    { id: 'date', header: 'آخرین تغییر', mobileLabel: 'آخرین تغییر', priority: 'meta', cell: (row) => dateFa(row.updatedAt) },
  ];

  const rowActions = (row: any): ErpAction[] => [
    { label: 'ثبت دستی', icon: FaBalanceScale, tone: 'info', disabled: actionLoading === `${row.id}:SUBMITTED_MANUALLY`, onClick: () => setTrackTarget({ row, status: 'SUBMITTED_MANUALLY' }) },
    { label: 'پذیرفته شد', icon: FaCheck, tone: 'success', disabled: actionLoading === `${row.id}:ACCEPTED`, onClick: () => setTrackTarget({ row, status: 'ACCEPTED' }) },
    { label: 'رد شد', icon: FaTimes, tone: 'danger', disabled: actionLoading === `${row.id}:REJECTED`, onClick: () => setTrackTarget({ row, status: 'REJECTED' }) },
  ];

  return (
    <ErpListPage
      eyebrow="حسابداری"
      title="مالیات و سامانه مودیان"
      description="آمادگی اطلاعات مالیاتی و پیگیری دستی وضعیت ارسال، پذیرش یا رد صورتحساب در سامانه مودیان."
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: () => loadRows(pagination.page), tone: 'neutral' }]}
      filters={[
        { id: 'search', label: 'جستجو', type: 'search', value: search, onChange: setSearch, placeholder: 'شماره قرارداد یا مشتری...' },
        { id: 'submissionStatus', label: 'وضعیت مالیات', type: 'select', value: submissionStatus, onChange: setSubmissionStatus, options: submissionStatusOptions },
      ]}
      rows={rows}
      rowKey={(row) => row.id}
      columns={columns}
      rowActions={rowActions}
      isLoading={loading}
      footer={<ErpPagination currentPage={pagination.page} totalPages={Math.max(Math.ceil(pagination.total / pagination.pageSize), 1)} totalItems={pagination.total} itemsPerPage={pagination.pageSize} onPageChange={loadRows} itemLabel="پرونده" />}
      emptyState={<ErpEmptyState icon={FaBalanceScale} title="پرونده مالیاتی ثبت نشده است" description="با ایجاد پیش‌نویس صورتحساب، پرونده مالیاتی و آمادگی سامانه مودیان ایجاد می‌شود." />}
    >
      <AccountingActionModal
        open={Boolean(trackTarget)}
        title="پیگیری وضعیت سامانه مودیان"
        description={trackTarget ? `${trackTarget.row.contract?.contractNumber || 'قرارداد'} - ${taxStatusLabels[trackTarget.status] || trackTarget.status}` : undefined}
        fields={[
          { id: 'trackingCode', label: 'کد پیگیری یا شماره مرجع', type: 'text', required: trackTarget?.status === 'SUBMITTED_MANUALLY', defaultValue: trackTarget?.row?.trackingCode || '' },
          { id: 'submittedAt', label: 'تاریخ ارسال', type: 'date', required: trackTarget?.status === 'SUBMITTED_MANUALLY' },
          { id: 'rejectionReason', label: 'علت رد', type: 'textarea', required: trackTarget?.status === 'REJECTED' },
          { id: 'note', label: 'یادداشت', type: 'textarea' },
        ]}
        submitLabel="ثبت پیگیری"
        busy={Boolean(actionLoading)}
        error={actionError}
        onClose={() => setTrackTarget(null)}
        onSubmit={track}
      />
    </ErpListPage>
  );
}
