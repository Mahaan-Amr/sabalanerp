'use client';

import { useEffect, useState } from 'react';
import { FaAddressBook, FaEye, FaSync } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpEmptyState, ErpInlineState, ErpListPage, type ErpColumn } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { accountingFailureMessage } from '@/features/accounting/accountingUi';
import { accountBalanceLabel, accountMoney, type CustomerAccountRow } from '@/features/accounting/customerAccountModel';

export default function CustomerAccountsPage() {
  const [rows, setRows] = useState<CustomerAccountRow[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(async () => {
      setLoading(true); setError(null);
      try {
        const response = await accountingAPI.getCustomerWorkspaceAccounts({ search: search.trim() || undefined, page });
        if (current) { setRows(response.data.data.items); setTotal(response.data.data.total); }
      } catch (reason) { if (current) { setRows([]); setError(accountingFailureMessage(reason, 'پرونده‌های مالی بارگیری نشد.')); } }
      finally { if (current) setLoading(false); }
    }, 250);
    return () => { current = false; window.clearTimeout(timer); };
  }, [search, page, refresh]);
  const columns: ErpColumn<CustomerAccountRow>[] = [
    { id: 'customer', header: 'مشتری', priority: 'primary', cell: row => <div><strong>{row.displayName}</strong><div className="mt-2 flex flex-wrap gap-2">
      <ErpBadge tone={row.trustCategory === 'SPECIAL' ? 'purple' : 'neutral'}>{row.trustCategory === 'SPECIAL' ? 'مشتری خاص' : 'مشتری عادی'}</ErpBadge>
      {row.historical && <ErpBadge tone="neutral">پرونده تاریخی</ErpBadge>}{!row.hasActivity && <span className="text-xs sds-text-muted">بدون گردش قطعی</span>}
    </div></div> },
    { id: 'net', header: 'وضعیت مالی', priority: 'secondary', align: 'end', cell: row => <div><strong>{accountMoney(row.netBalanceRials)}</strong><div className="mt-1"><ErpBadge tone={BigInt(row.netBalanceRials) > BigInt(0) ? 'warning' : BigInt(row.netBalanceRials) < BigInt(0) ? 'success' : 'neutral'}>{accountBalanceLabel(row.netBalanceRials)}</ErpBadge></div></div> },
    { id: 'debt', header: 'مانده دریافتنی', priority: 'secondary', align: 'end', cell: row => accountMoney(row.receivableRials) },
    { id: 'credit', header: 'وجه تخصیص‌نیافته', priority: 'meta', align: 'end', cell: row => accountMoney(row.unallocatedCreditRials) },
    { id: 'open', header: 'اقلام باز', priority: 'meta', cell: row => row.openItemCount.toLocaleString('fa-IR') },
  ];
  return <ErpListPage eyebrow="حسابداری" title="حساب‌های مالی مشتریان"
    actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: () => setRefresh(value => value + 1) }]}
    filters={[{ id: 'search', label: 'جستجوی مشتری', type: 'search', value: search, onChange: value => { setSearch(value); setPage(1); }, placeholder: 'نام، شرکت یا کد ملی...' }]}
    rows={rows} rowKey={row => row.id} columns={columns} isLoading={loading}
    rowActions={row => [{ label: 'مشاهده حساب مشتری', icon: FaEye, href: `/dashboard/accounting/customer-accounts/${encodeURIComponent(row.id)}` }]}
    emptyState={<ErpEmptyState icon={FaAddressBook} title={search ? 'مشتری مطابق جستجو پیدا نشد' : 'مشتری مستقیمی ثبت نشده است'} />}
    footer={<div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm sds-text-secondary">{total.toLocaleString('fa-IR')} مشتری · صفحه {page.toLocaleString('fa-IR')}</span>
      <div className="flex gap-2"><ErpButton label="قبلی" tone="neutral" disabled={loading || page === 1} onClick={() => setPage(value => value - 1)} />
        <ErpButton label="بعدی" tone="neutral" disabled={loading || page * 25 >= total} onClick={() => setPage(value => value + 1)} /></div></div>}>
    {error && <ErpInlineState kind="error" title={error} action={{ label: 'تلاش دوباره', onClick: () => setRefresh(value => value + 1) }} />}
  </ErpListPage>;
}
