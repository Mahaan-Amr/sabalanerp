'use client';

import { useCallback, useEffect, useState } from 'react';
import { FaAddressBook, FaSync } from 'react-icons/fa';
import { ErpEmptyState, ErpInlineState, ErpListPage, type ErpColumn } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { accountingFailureMessage, dateFa, money } from '@/features/accounting/accountingUi';

export default function CustomerAccountsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await accountingAPI.getCustomerAccounts({ search: search.trim() || undefined, asOf: new Date().toISOString() });
      setRows(response.data.data || []);
    } catch (reason) {
      setRows([]); setError(accountingFailureMessage(reason, 'حساب‌های مالی مشتریان بارگیری نشد.'));
    } finally { setLoading(false); }
  }, [search]);
  useEffect(() => { const timer = window.setTimeout(load, 250); return () => window.clearTimeout(timer); }, [load]);
  const columns: ErpColumn<any>[] = [
    { id: 'customer', header: 'مشتری', priority: 'primary', cell: (row) => <div><strong>{row.displayName}</strong><span className="mt-1 block text-xs text-[var(--sds-text-muted)]">شناسه پایدار: {row.partySourceId}</span></div> },
    { id: 'receivable', header: 'مانده دریافتنی', mobileLabel: 'مانده دریافتنی', priority: 'secondary', align: 'end', cell: (row) => money(row.receivableRials, 'IRR') },
    { id: 'credit', header: 'وجه تخصیص‌نیافته', mobileLabel: 'وجه تخصیص‌نیافته', priority: 'secondary', align: 'end', cell: (row) => money(row.unallocatedCreditRials, 'IRR') },
    { id: 'openItems', header: 'اقلام باز', mobileLabel: 'اقلام باز', priority: 'meta', cell: (row) => Number(row.openItemCount).toLocaleString('fa-IR') },
    { id: 'oldest', header: 'قدیمی‌ترین سررسید', mobileLabel: 'قدیمی‌ترین سررسید', priority: 'meta', cell: (row) => row.oldestDueAt ? dateFa(row.oldestDueAt) : 'بدون قلم باز' },
  ];
  return <ErpListPage eyebrow="حسابداری مشتریان" title="حساب‌های مالی مشتریان"
    description="مانده و سررسید فقط از اسناد قطعی و تخصیص‌های تغییرناپذیر محاسبه می‌شود؛ ایجاد حساب به‌تنهایی هیچ مانده‌ای نمی‌سازد."
    actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: load }]}
    filters={[{ id: 'search', label: 'جستجوی مشتری', type: 'search', value: search, onChange: setSearch, placeholder: 'نام یا شناسه مشتری...' }]}
    rows={rows} rowKey={(row) => row.id} columns={columns} isLoading={loading}
    rowActions={(row) => [{ label: 'صورتحساب و ریزگردش', href: `/dashboard/accounting/customer-accounts/${row.id}` }]}
    emptyState={<ErpEmptyState icon={FaAddressBook} title="حساب مالی مشتری ثبت نشده است" description="با تأیید نخستین رابطه فروش فعال، حساب بدون مانده به‌صورت خودکار ایجاد می‌شود." />}>
    {error && <ErpInlineState kind="error" title={error} action={{ label: 'تلاش دوباره', onClick: load }} />}
  </ErpListPage>;
}
