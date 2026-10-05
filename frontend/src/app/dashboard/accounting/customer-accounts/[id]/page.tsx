'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { FaArrowDown, FaBalanceScale, FaEye, FaFileExcel, FaFilePdf, FaMoneyBillWave, FaSync } from 'react-icons/fa';
import { ErpActionMenu, ErpBadge, ErpButton, ErpCard, ErpDisclosure, ErpEmptyState, ErpField, ErpInlineState, ErpInput, ErpMetricGrid, ErpPresentationProvider, ErpSection, ErpSegmentedControl, ErpSheet, ErpSummaryGrid, ErpWorkspacePage, type ErpAction } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { accountingFailureMessage, dateFa, StatusBadge } from '@/features/accounting/accountingUi';
import { contractLifecycleLabel } from '@/features/sales/contractLifecyclePresentation';
import { accountBalanceLabel, accountMoney, accountOperationLabels, accountStatusLabels, type AccountOperationKind, type CustomerAccount } from '@/features/accounting/customerAccountModel';
import CustomerAccountOperationFlow from '@/features/accounting/CustomerAccountOperationFlow';
import AccountingLedgerEvidence from '@/features/accounting/AccountingLedgerEvidence';

type Tab = 'overview' | 'contracts' | 'records' | 'receipts' | 'statement';
function AccountCards<T>({ items, render, empty }: { items: T[]; render: (item: T, index: number) => ReactNode; empty: string }) {
  const [page, setPage] = useState(1);
  if (!items.length) return <ErpEmptyState title={empty} />;
  const current = Math.min(page, Math.ceil(items.length / 15));
  return <div className="space-y-3">{items.slice((current - 1) * 15, current * 15).map(render)}
    {items.length > 15 && <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm sds-text-secondary">صفحه {current.toLocaleString('fa-IR')} از {Math.ceil(items.length / 15).toLocaleString('fa-IR')}</span><div className="flex gap-2">
      <ErpButton label="قبلی" tone="neutral" disabled={current === 1} onClick={() => setPage(current - 1)} /><ErpButton label="بعدی" tone="neutral" disabled={current * 15 >= items.length} onClick={() => setPage(current + 1)} />
    </div></div>}</div>;
}
export default function CustomerAccountDetailPage() {
  const params = useParams<{ id: string }>();
  const accountId = decodeURIComponent(params.id);
  const [data, setData] = useState<CustomerAccount>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string>();
  const [tab, setTab] = useState<Tab>('overview');
  const [search, setSearch] = useState('');
  const [operation, setOperation] = useState<{ kind: AccountOperationKind; allocationId?: string }>();
  const [exporting, setExporting] = useState(false);
  const [evidence, setEvidence] = useState<unknown>();
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true); setError(null);
    try { const response = await accountingAPI.getCustomerWorkspace(accountId); if (request === sequence.current) setData(response.data.data); }
    catch (reason) { if (request === sequence.current) { setData(undefined); setError(accountingFailureMessage(reason, 'پرونده مالی مشتری بارگیری نشد.')); } }
    finally { if (request === sequence.current) setLoading(false); }
  }, [accountId]);
  useEffect(() => { setData(undefined); setTab('overview'); setSuccess(undefined); setOperation(undefined); void load(); return () => { sequence.current++; }; }, [load]);
  const download = async (format: 'pdf' | 'xlsx') => {
    if (!data?.profile || exporting) return;
    setExporting(true); setError(null);
    try {
      const response = await accountingAPI.exportCustomerStatement(data.profile.id, format, new Date().toISOString());
      const url = window.URL.createObjectURL(response.data); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `صورتحساب-${data.displayName}.${format}`; anchor.click(); window.URL.revokeObjectURL(url);
    } catch (reason) { setError(accountingFailureMessage(reason, 'خروجی صورتحساب ساخته نشد.')); }
    finally { setExporting(false); }
  };
  const openOperation = (kind: AccountOperationKind, allocationId?: string) => { setSuccess(undefined); setOperation({ kind, allocationId }); };
  const openEvidence = async (voucherId: string) => {
    setEvidenceLoading(true); setError(null);
    try { const response = await accountingAPI.getLedgerVoucherEvidence(voucherId, 'بررسی سند و مستندات از پرونده مالی مشتری'); setEvidence(response.data.data); }
    catch (reason) { setError(accountingFailureMessage(reason, 'سند و مستندات بارگیری نشد.')); }
    finally { setEvidenceLoading(false); }
  };
  const operations: ErpAction[] = data ? [
    ...(data.capabilities.canRefund ? [{ label: accountOperationLabels.REFUND, onClick: () => openOperation('REFUND') }] : []),
    ...(data.capabilities.canManageTreasury ? (['ALLOCATION'] as AccountOperationKind[]).map(kind => ({ label: accountOperationLabels[kind], onClick: () => openOperation(kind) })) : []),
    ...(data.capabilities.canManageAccount ? (['DEBIT', 'CREDIT', 'OPENING', 'SET_BALANCE'] as AccountOperationKind[]).map(kind => ({ label: accountOperationLabels[kind], onClick: () => openOperation(kind), disabled: kind === 'OPENING' && data.activityItems.some(row => row.sourceKind === 'OPENING') })) : []),
  ] : [];
  const contractName = (id: string | null) => data?.contracts.find(row => row.id === id)?.contractNumber || (id ? 'قرارداد تاریخی' : 'مستقل از قرارداد');
  const contractLink = (id: string | null): ErpAction[] => id ? [{ label: 'رسیدگی مالی قرارداد', icon: FaEye, href: `/dashboard/accounting/contracts/${id}` }] : [];
  const movements = data?.movements || [];
  const contractTotals = data ? Array.from(data.contracts.filter(row => !row.isInactive && !['CANCELLED', 'EXPIRED'].includes(row.status)).reduce((totals, row) => {
    if (row.totalAmount != null) { const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(row.totalAmount); if (match) totals.set(row.currency, (totals.get(row.currency) || BigInt(0)) + BigInt(match[1]) * BigInt(100) + BigInt((match[2] || '').padEnd(2, '0'))); }
    return totals;
  }, new Map<string, bigint>())).map(([currency, value]) => accountMoney(`${value / BigInt(100)}.${(value % BigInt(100)).toString().padStart(2, '0')}`, currency)).join(' + ') : '';
  return <ErpPresentationProvider scope="workspace"><ErpWorkspacePage title={data?.displayName || 'پرونده مالی مشتری'} backHref="/dashboard/accounting/customer-accounts"
    context={data && <div className="flex flex-wrap items-center gap-2"><ErpBadge tone={data.customer?.trustCategory === 'SPECIAL' ? 'purple' : 'neutral'}>{data.customer?.trustCategory === 'SPECIAL' ? 'مشتری خاص' : data.customer ? 'مشتری عادی' : 'هویت تاریخی'}</ErpBadge>
      {data.customer?.cardDeletedAt && <ErpBadge tone="neutral">پرونده تاریخی</ErpBadge>}<span>{data.customer?.workNumber || data.customer?.homeNumber}</span></div>}
    primaryAction={data?.capabilities.canManageTreasury ? { label: 'ثبت دریافت', icon: FaMoneyBillWave, onClick: () => openOperation('RECEIPT'), disabled: loading } : undefined}
    secondaryActions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: () => void load() }, ...(data?.capabilities.canExport ? [
      { label: 'خروجی PDF', icon: FaFilePdf, onClick: () => void download('pdf'), disabled: exporting },
      { label: 'خروجی Excel', icon: FaFileExcel, onClick: () => void download('xlsx'), disabled: exporting },
    ] : [])]}>
    {loading && <ErpInlineState kind="empty" title="در حال بارگیری پرونده مالی…" />}
    {error && <ErpInlineState kind="error" title={error} action={{ label: 'تلاش دوباره', onClick: () => void load() }} />}
    {success && <ErpInlineState kind="success" title={success} />}
    {data && !loading && <>
      <ErpCard className="p-4 sm:hidden"><span className="text-xs sds-text-secondary">نام مشتری</span><strong className="mt-1 block break-words">{data.displayName}</strong></ErpCard>
      <ErpMetricGrid items={[
        { label: `خالص وضعیت مالی · ${accountBalanceLabel(data.netBalanceRials)}`, value: accountMoney(data.netBalanceRials), icon: FaBalanceScale, tone: BigInt(data.netBalanceRials) > BigInt(0) ? 'warning' : BigInt(data.netBalanceRials) < BigInt(0) ? 'success' : 'neutral' },
        { label: 'مانده دریافتنی قطعی', value: accountMoney(data.receivableRials), hint: 'پس از تخصیص‌ها و بستانکاری‌ها' },
        { label: 'وجه تخصیص‌نیافته', value: accountMoney(data.unallocatedCreditRials), icon: FaArrowDown },
        { label: 'مبلغ قراردادهای جاری', value: contractTotals || 'بدون قرارداد جاری', hint: `${data.contracts.length.toLocaleString('fa-IR')} قرارداد در سابقه؛ مبلغ قرارداد، بدهی قطعی نیست` },
      ]} />
      <div className="flex flex-wrap items-center justify-between gap-3"><ErpSegmentedControl value={tab} onChange={setTab} options={[
        { value: 'overview', label: 'نمای کلی' }, { value: 'contracts', label: 'قراردادها', count: data.contracts.length },
        { value: 'records', label: 'رکوردها و دریافتنی‌ها', count: data.financialRecords.length }, { value: 'receipts', label: 'دریافت‌ها و چک‌ها' }, { value: 'statement', label: 'ریزگردش' },
      ]} />{operations.length > 0 && <ErpActionMenu label="عملیات حساب" actions={operations} portal />}</div>
      {tab === 'overview' && <>
        <ErpSection title="بدهی‌ها و بستانکاری‌های باز" actions={[{ label: 'مشاهده همه جزئیات', onClick: () => setTab('statement') }]}>
          <AccountCards items={data.openItems.slice(0, 5)} empty="قلم مالی بازی وجود ندارد" render={item => <ErpCard key={item.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><strong>{item.invoiceNumber}</strong><p className="mt-1 text-xs sds-text-secondary">{contractName(item.contractId)} · سررسید {dateFa(item.dueAt)}</p></div><ErpBadge tone={item.kind === 'CREDIT' ? 'success' : item.agingDays ? 'warning' : 'info'}>{item.kind === 'CREDIT' ? 'بستانکاری' : item.agingDays ? `${item.agingDays.toLocaleString('fa-IR')} روز از سررسید` : 'دریافتنی'}</ErpBadge></div>
            <p className="mt-3 text-lg font-bold">{accountMoney(item.remainingRials)}</p></ErpCard>} />
        </ErpSection>
        {data.credit && data.customer?.trustCategory === 'SPECIAL' && <ErpSection title="اعتبار مشتری خاص"><ErpSummaryGrid columns={3} items={[
          { label: 'سقف اعتبار', value: data.credit.limitRials === null ? 'نامحدود' : accountMoney(data.credit.limitRials) }, { label: 'اعتبار مصرف‌شده', value: accountMoney(data.credit.usedRials) },
          { label: 'اعتبار قابل استفاده', value: data.credit.availableRials === null ? 'نامحدود' : accountMoney(data.credit.availableRials) },
        ]} /></ErpSection>}
        <ErpSection title="آخرین گردش‌ها" actions={[{ label: 'ریزگردش کامل', onClick: () => setTab('statement') }]}>
          <AccountCards items={movements.slice(-4).reverse()} empty="هنوز گردش مالی قطعی ثبت نشده است" render={row => <ErpCard key={row.id} className="p-4"><div className="flex flex-wrap justify-between gap-3"><strong>{row.label}</strong><span className="text-sm sds-text-secondary">{dateFa(row.at)}</span></div><p className="mt-2 text-sm">مانده پس از رویداد: {accountMoney(row.balance)}</p></ErpCard>} />
        </ErpSection>
      </>}
      {tab === 'contracts' && <ErpSection title="قراردادهای مشتری"><ErpField label="جستجوی قرارداد"><ErpInput type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="شماره یا عنوان قرارداد" /></ErpField>
        <div className="mt-4"><AccountCards key={search} items={data.contracts.filter(row => `${row.contractNumber} ${row.titlePersian}`.includes(search))} empty="قراردادی پیدا نشد" render={row => <ErpCard key={row.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><strong>قرارداد {row.contractNumber}</strong><p className="mt-1 text-sm sds-text-secondary">{row.titlePersian} · {dateFa(row.createdAt)}</p></div><div className="flex flex-wrap gap-2"><StatusBadge status={row.status} label={contractLifecycleLabel(row)} />{row.isInactive && <ErpBadge tone="neutral">غیرفعال</ErpBadge>}</div></div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><strong>{accountMoney(row.totalAmount, row.currency)}</strong><ErpButton label="مشاهده قرارداد و امور مالی" icon={FaEye} href={`/dashboard/accounting/contracts/${row.id}`} tone="neutral" /></div>
          {BigInt(row.customerCreditAmountRials) > BigInt(0) && <p className="mt-3 text-sm sds-text-secondary">بخش اعتباری: {accountMoney(row.customerCreditAmountRials)} · وعده پرداخت {dateFa(row.customerCreditPromisedDate)}</p>}
        </ErpCard>} /></div></ErpSection>}
      {tab === 'records' && <>
        <ErpSection title="رکوردهای مالی قراردادها" description="وضعیت عملیاتی این رکوردها جدا از گردش قطعی حساب نمایش داده می‌شود."><AccountCards items={data.financialRecords} empty="رکورد مالی ثبت نشده است" render={row => <ErpCard key={row.id} className="p-4"><div className="flex flex-wrap justify-between gap-3"><strong>{accountStatusLabels[row.kind] || 'رکورد مالی'} {row.systemInvoiceNumber}</strong><StatusBadge status={row.status} label={accountStatusLabels[row.status] || row.status} /></div><ErpSummaryGrid columns={3} items={[{ label: 'مبلغ', value: accountMoney(row.amount, row.currency) }, { label: 'قرارداد', value: contractName(row.contractId) }, { label: 'ثبت', value: dateFa(row.createdAt) }]} /><div className="mt-3 flex gap-2">{contractLink(row.contractId).map(action => <ErpButton key={action.label} {...action} tone="neutral" />)}</div></ErpCard>} /></ErpSection>
        <ErpSection title="دریافتنی‌های عملیاتی"><AccountCards items={data.receivables} empty="دریافتنی عملیاتی وجود ندارد" render={row => <ErpCard key={row.id} className="p-4"><div className="flex flex-wrap justify-between gap-3"><strong>{contractName(row.contractId)}</strong><StatusBadge status={row.status} label={accountStatusLabels[row.status] || row.status} /></div><ErpSummaryGrid columns={3} items={[{ label: 'مانده', value: accountMoney(row.remainingAmount, row.currency) }, { label: 'دریافت‌شده', value: accountMoney(row.paidAmount, row.currency) }, { label: 'سررسید', value: dateFa(row.dueDate) }]} /><div className="mt-3"><ErpButton label="رسیدگی دریافتنی" href={`/dashboard/accounting/receivables?recordId=${row.id}`} tone="neutral" /></div></ErpCard>} /></ErpSection>
      </>}
      {tab === 'receipts' && <>
        <ErpSection title="دریافت‌های قطعی"><AccountCards items={data.receipts} empty="دریافت قطعی ثبت نشده است" render={row => <ErpCard key={row.id} className="p-4"><div className="flex flex-wrap justify-between gap-3"><strong>دریافت {dateFa(row.occurredAt)}</strong><strong>{accountMoney(row.amountRials)}</strong></div><div className="mt-3"><ErpSummaryGrid columns={3} items={[{ label: 'تخصیص فعال', value: accountMoney(row.allocatedRials) }, { label: 'استرداد', value: accountMoney(row.refundedRials) }, { label: 'وجه آزاد', value: accountMoney((BigInt(row.amountRials) - BigInt(row.allocatedRials) - BigInt(row.refundedRials)).toString()) }]} /></div>
          {row.allocations.length > 0 && <div className="mt-3"><ErpDisclosure title="سابقه تخصیص"><div className="space-y-3">{row.allocations.map(allocation => <div key={allocation.id} className="flex flex-wrap items-center justify-between gap-3"><div><span>{dateFa(allocation.createdAt)} · {accountMoney(allocation.lines.reduce((sum, line) => sum + BigInt(line.amountRials), BigInt(0)).toString())}</span><p className="text-xs sds-text-secondary">{allocation.reversedAt ? `برگشت در ${dateFa(allocation.reversedAt)}` : 'تخصیص فعال'}</p></div>{!allocation.reversedAt && data.capabilities.canManageTreasury && <ErpButton label="برگشت تخصیص" tone="warning" onClick={() => openOperation('REVERSE_ALLOCATION', allocation.id)} />}</div>)}</div></ErpDisclosure></div>}
        </ErpCard>} /></ErpSection>
        <ErpSection title="چک‌های خزانه"><AccountCards items={data.treasuryChecks || []} empty="چکی در خزانه برای این مشتری ثبت نشده است" render={row => <ErpCard key={row.id} className="p-4"><div className="flex flex-wrap justify-between gap-3"><strong>{row.bankName} · {row.serialNumber}</strong><StatusBadge status={row.status} label={accountStatusLabels[row.status] || row.status} /></div><ErpSummaryGrid columns={3} items={[{ label: "مبلغ", value: accountMoney(row.amountRials) }, { label: "سررسید", value: dateFa(row.dueAt) }, { label: "جهت", value: row.direction === "INBOUND" ? "دریافتی" : "پرداختی" }]} /><ErpButton label="پیگیری در خزانه" href={`/dashboard/accounting/treasury?checkId=${row.id}`} tone="neutral" /></ErpCard>} /></ErpSection>
        <ErpSection title="دریافت‌ها و چک‌های قرارداد"><AccountCards items={data.payments} empty="دریافت یا چکی در قراردادها ثبت نشده است" render={row => <ErpCard key={row.id} className="p-4"><div className="flex flex-wrap justify-between gap-3"><strong>{accountStatusLabels[row.method] || 'دریافت'} {row.checkNumber}</strong><StatusBadge status={row.checkStatus || row.status} label={accountStatusLabels[row.checkStatus || row.status] || row.checkStatus || row.status} /></div><ErpSummaryGrid columns={3} items={[{ label: 'مبلغ', value: accountMoney(row.amount, row.currency) }, { label: 'قرارداد', value: contractName(row.contractId) }, { label: row.method === 'CHECK' ? 'سررسید چک' : 'تاریخ دریافت', value: dateFa(row.checkDueDate || row.occurredAt) }]} /><div className="mt-3"><ErpButton label="پیگیری دریافت / چک" href={`/dashboard/accounting/payments?recordId=${row.id}`} tone="neutral" /></div></ErpCard>} /></ErpSection>
      </>}
      {tab === 'statement' && <ErpSection title="ریزگردش قطعی" description="تخصیص وجه خالص مانده را تغییر نمی‌دهد."><AccountCards items={movements} empty="گردش مالی قطعی وجود ندارد" render={row => <ErpCard key={row.id} className="p-4"><div className="flex flex-wrap justify-between gap-3"><strong>{row.label}</strong><span className="text-sm sds-text-secondary">{dateFa(row.at)}</span></div><div className="mt-3"><ErpSummaryGrid columns={3} items={[{ label: 'بدهکار', value: accountMoney(row.debit) }, { label: 'بستانکار', value: accountMoney(row.credit) }, { label: `مانده · ${accountBalanceLabel(row.balance)}`, value: accountMoney(row.balance) }]} /></div><div className="mt-3 flex flex-wrap gap-2">{row.voucherId && <ErpButton label="مشاهده سند و مستندات" onClick={() => void openEvidence(row.voucherId!)} disabled={evidenceLoading} tone="neutral" />}{contractLink(row.contractId).map(action => <ErpButton key={action.label} {...action} tone="neutral" />)}</div></ErpCard>} /></ErpSection>}
    </>}
    {data && operation && <CustomerAccountOperationFlow key={`${operation.kind}:${operation.allocationId || ''}`} accountId={accountId} account={data} kind={operation.kind} allocationId={operation.allocationId}
      onClose={() => setOperation(undefined)} onSaved={async () => { setSuccess(`${accountOperationLabels[operation.kind]} با موفقیت ثبت شد.`); await load(); }} />}
    <ErpSheet open={Boolean(evidence)} onClose={() => setEvidence(undefined)} title="سند و مستندات" presentation="modal" size="wide">{Boolean(evidence) && <AccountingLedgerEvidence evidence={evidence} />}</ErpSheet>
  </ErpWorkspacePage></ErpPresentationProvider>;
}
