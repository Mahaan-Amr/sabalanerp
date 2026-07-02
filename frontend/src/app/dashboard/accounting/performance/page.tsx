'use client';

import { useCallback, useEffect, useState } from 'react';
import { FaChartLine, FaSync, FaUserClock } from 'react-icons/fa';
import { ErpEmptyState, ErpListPage, ErpPagination, type ErpColumn } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { emptyAccountingPagination, readAccountingListResponse } from '@/features/accounting/accountingUi';

const hours = (value?: number | null) => (value == null ? '—' : `${value.toLocaleString('fa-IR')} ساعت`);
const count = (value?: number | null) => (value || 0).toLocaleString('fa-IR');

export default function AccountingPerformancePage() {
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState(emptyAccountingPagination);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const loadRows = useCallback(async (page = 1) => {
    try {
      setLoading(true);
      const response = await accountingAPI.getPerformanceReport({ search, page, pageSize: pagination.pageSize });
      if (response.data.success) {
        const data = readAccountingListResponse<any>(response.data.data);
        setRows(data.items);
        setPagination({ page: data.page, pageSize: data.pageSize, total: data.total });
      }
    } catch (error) {
      console.error('Error loading accountant performance:', error);
    } finally {
      setLoading(false);
    }
  }, [pagination.pageSize, search]);

  useEffect(() => {
    loadRows(1);
  }, [loadRows]);

  const columns: ErpColumn<any>[] = [
    {
      id: 'accountant',
      header: 'حسابدار',
      priority: 'primary',
      cell: (row) => (
        <div>
          <p className="font-semibold text-slate-950 dark:text-white">{row.accountant?.displayName || 'کاربر حسابداری'}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{row.accountant?.username || row.accountant?.id}</p>
        </div>
      ),
    },
    { id: 'actions', header: 'اقدام‌ها', mobileLabel: 'اقدام‌ها', align: 'center', priority: 'secondary', cell: (row) => count(row.actionsLogged) },
    { id: 'records', header: 'رکورد مالی', mobileLabel: 'رکورد مالی', align: 'center', priority: 'secondary', cell: (row) => count(row.financialRecordsCreated) },
    { id: 'approvals', header: 'تایید مالی', mobileLabel: 'تایید مالی', align: 'center', priority: 'secondary', cell: (row) => count(row.invoicesApproved) },
    { id: 'receipts', header: 'دریافت', mobileLabel: 'دریافت', align: 'center', priority: 'secondary', cell: (row) => count(row.receiptsRegistered) },
    { id: 'firstRecordDelay', header: 'میانگین تا رکورد مالی', mobileLabel: 'تا رکورد مالی', priority: 'meta', cell: (row) => hours(row.averageHoursToFirstFinancialRecord) },
    { id: 'approvalDelay', header: 'میانگین تا تایید', mobileLabel: 'تا تایید', priority: 'meta', cell: (row) => hours(row.averageHoursToApproveInvoice) },
    { id: 'receiptDelay', header: 'میانگین تا دریافت', mobileLabel: 'تا دریافت', priority: 'meta', cell: (row) => hours(row.averageHoursToRegisterReceipt) },
    { id: 'correctionDelay', header: 'بستن اصلاح', mobileLabel: 'بستن اصلاح', priority: 'meta', cell: (row) => hours(row.averageHoursToResolveCorrection) },
  ];

  return (
    <ErpListPage
      eyebrow="حسابداری"
      title="عملکرد حسابداران"
      description="گزارش عملیاتی از سرعت و حجم کار حسابداران بر اساس رخدادهای ثبت شده در گردش کار قراردادهای فروش."
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: () => loadRows(pagination.page), tone: 'neutral' }]}
      filters={[
        { id: 'search', label: 'جستجو', type: 'search', value: search, onChange: setSearch, placeholder: 'نام یا نام کاربری حسابدار...' },
      ]}
      rows={rows}
      rowKey={(row) => row.accountant?.id || row.accountant?.username}
      columns={columns}
      isLoading={loading}
      footer={<ErpPagination currentPage={pagination.page} totalPages={Math.max(Math.ceil(pagination.total / pagination.pageSize), 1)} totalItems={pagination.total} itemsPerPage={pagination.pageSize} onPageChange={loadRows} itemLabel="حسابدار" />}
      emptyState={<ErpEmptyState icon={FaUserClock} title="داده عملکردی وجود ندارد" description="پس از ثبت اقدام‌های حسابداری، عملکرد حسابداران در این صفحه نمایش داده می‌شود." />}
    >
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
        این گزارش زمان حضور کاربر در مرورگر را اندازه نمی‌گیرد؛ معیارها از رکوردهای حسابداری و سوابق عملیات محاسبه می‌شوند.
      </div>
    </ErpListPage>
  );
}
