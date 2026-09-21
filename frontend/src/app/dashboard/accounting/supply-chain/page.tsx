'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FaBoxes, FaExclamationTriangle, FaFileInvoice, FaMoneyCheckAlt, FaSync } from 'react-icons/fa';
import { accountingAPI } from '@/lib/api';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpInlineState,
  ErpInput,
  ErpLoading,
  ErpMetricGrid,
  ErpPage,
  ErpSection,
  ErpSegmentedControl,
  ErpSelect,
} from '@/components/erp';

type Tab = 'payables' | 'inventory' | 'checks' | 'exceptions' | 'settings';
const rial = (value: unknown) => `${BigInt(String(value ?? 0)).toLocaleString('fa-IR')} ریال`;
const dateFa = (value: unknown) => value ? new Date(String(value)).toLocaleDateString('fa-IR') : '—';
const checkFa: Record<string, string> = {
  RECEIVED: 'دریافت‌شده', ISSUED: 'صادرشده', ENDORSED: 'ظهرنویسی‌شده', DELIVERED: 'تحویل‌شده', DEPOSITED: 'واگذارشده به بانک', CLEARED: 'وصول‌شده', BOUNCED: 'برگشتی',
  RETURNED: 'پس‌گرفته‌شده', REPLACED: 'جایگزین‌شده', CANCELLED: 'لغوشده',
};
const valuationFa: Record<string, string> = {
  SPECIFIC_IDENTIFICATION: 'شناسایی ویژه', MOVING_WEIGHTED_AVERAGE: 'میانگین موزون متحرک',
};
const postingRoleFa: Record<string, string> = {
  INVENTORY: 'موجودی مواد و کالا', FIXED_ASSET: 'دارایی ثابت', PURCHASE_EXPENSE: 'هزینه خرید و خدمات',
  RECOVERABLE_PURCHASE_TAX: 'مالیات خرید بازیافتنی', PURCHASE_ROUNDING: 'تفاوت گردکردن خرید',
  PURCHASE_DEDUCTION_PAYABLE: 'کسورات پرداختنی خرید', PURCHASE_RETENTION_PAYABLE: 'سپرده حسن انجام کار پرداختنی',
  SUPPLIER_PAYABLE: 'حساب‌های پرداختنی تأمین‌کننده', SUPPLIER_ADVANCE: 'پیش‌پرداخت خرید', CASH_OR_BANK: 'بانک یا صندوق',
  WORK_IN_PROGRESS: 'کالای در جریان ساخت', COST_OF_GOODS_SOLD: 'بهای تمام‌شده کالای فروش‌رفته',
  FINISHED_GOODS: 'کالای ساخته‌شده', PRODUCTION_COST_POOLS: 'مخازن هزینه تولید',
  ABNORMAL_WASTE_EXPENSE: 'هزینه ضایعات غیرعادی', ABNORMAL_WASTE_CLEARING: 'تسویه ضایعات غیرعادی',
  OPENING_INVENTORY: 'موجودی افتتاحیه', OPENING_BALANCE_CONTROL: 'کنترل مانده افتتاحیه',
  PAYABLE_CHECK: 'اسناد پرداختنی', BANK: 'بانک', CHECK_REVERSAL: 'برگشت اسناد پرداختنی',
};

export default function SupplyChainAccountingPage() {
  const [data, setData] = useState<any>();
  const [ledger, setLedger] = useState<any>();
  const [tab, setTab] = useState<Tab>('payables');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; title: string }>();
  const [rule, setRule] = useState({ accountRole: '', accountId: '', effectiveFrom: new Date().toISOString().slice(0, 10) });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [workspaceResponse, ledgerResponse] = await Promise.all([
        accountingAPI.getSupplyChainWorkspace(), accountingAPI.getLedgerContext(),
      ]);
      setData(workspaceResponse.data.data);
      setLedger(ledgerResponse.data.data);
      setMessage(undefined);
    } catch (error: any) {
      setMessage({ kind: 'error', title: error.response?.data?.message || 'دریافت وضعیت خرید و موجودی انجام نشد.' });
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const book = ledger?.books?.[0];
  const accounts = (book?.accounts ?? []).filter((item: any) => item.level === 'MOIN' && !item.retiredAt);
  const allocations = (data?.openItems ?? []).flatMap((item: any) => item.allocations ?? []);
  const openPayable = (data?.openItems ?? []).reduce((sum: bigint, item: any) => {
    const allocated = allocations.filter((allocation: any) => allocation.openItemId === item.id)
      .reduce((total: bigint, allocation: any) => total + BigInt(allocation.amountRials), BigInt(0));
    return sum + BigInt(item.amountRials) - allocated;
  }, BigInt(0));
  const inventoryValue = (data?.identities ?? []).reduce((sum: bigint, identity: any) => sum
    + (identity.layers ?? []).reduce((value: bigint, layer: any) => value + BigInt(layer.valueRials)
      - (layer.consumptions ?? []).reduce((used: bigint, item: any) => used + BigInt(item.valueRials), BigInt(0)), BigInt(0)), BigInt(0));
  const activeChecks = (data?.checks ?? []).filter((item: any) => !['CLEARED', 'CANCELLED', 'REPLACED'].includes(item.status));
  const activeRules = useMemo(() => {
    const seen = new Set<string>();
    return (data?.postingRules ?? []).filter((item: any) => !seen.has(item.accountRole) && seen.add(item.accountRole));
  }, [data?.postingRules]);

  const saveRule = async () => {
    try {
      await accountingAPI.createSupplyChainPostingRule({ ...rule, bookId: book.id, effectiveFrom: `${rule.effectiveFrom}T00:00:00.000Z` });
      setMessage({ kind: 'success', title: 'نسخه جدید قاعده ثبت فعال شد.' });
      setRule((current) => ({ ...current, accountRole: '', accountId: '' }));
      await load();
    } catch (error: any) {
      setMessage({ kind: 'error', title: error.response?.data?.message || 'ثبت قاعده حسابداری انجام نشد.' });
    }
  };

  if (loading && !data) return <ErpPage title="خرید، موجودی و بهای تمام‌شده" backHref="/dashboard/accounting"><ErpLoading /></ErpPage>;
  return (
    <ErpPage
      eyebrow="حسابداری"
      title="خرید، موجودی و بهای تمام‌شده"
      description="بدهی تأمین‌کنندگان، موجودی فیزیکی و جریان بهای واقعی از اسناد قطعی دفترکل بازسازی می‌شوند."
      backHref="/dashboard/accounting"
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: load, disabled: loading }]}
    >
      {message && <ErpInlineState kind={message.kind} title={message.title} />}
      <ErpMetricGrid items={[
        { label: 'بدهی باز تأمین‌کنندگان', value: rial(openPayable), icon: FaFileInvoice, tone: 'warning' },
        { label: 'ارزش لایه‌های موجودی', value: rial(inventoryValue), icon: FaBoxes, tone: 'info' },
        { label: 'چک‌های در جریان', value: activeChecks.length.toLocaleString('fa-IR'), icon: FaMoneyCheckAlt, tone: activeChecks.length ? 'purple' : 'neutral' },
        { label: 'استثنای باز', value: (data?.exceptions?.length ?? 0).toLocaleString('fa-IR'), icon: FaExclamationTriangle, tone: data?.exceptions?.length ? 'danger' : 'success' },
      ]} />
      <ErpSegmentedControl<Tab> value={tab} onChange={setTab} options={[
        { value: 'payables', label: 'بدهی‌ها' }, { value: 'inventory', label: 'موجودی و تولید' },
        { value: 'checks', label: 'چک‌ها' }, { value: 'exceptions', label: 'صف استثنا' },
        ...(ledger?.canManage ? [{ value: 'settings' as const, label: 'قواعد ثبت' }] : []),
      ]} />

      {tab === 'payables' && <ErpSection title="فاکتورها و اقلام باز">
        {!data?.invoices?.length ? <ErpEmptyState title="فاکتور قطعی تأمین‌کننده‌ای ثبت نشده است." /> : <div className="grid gap-3 lg:grid-cols-2">{data.invoices.map((invoice: any) => {
          const openItem = invoice.openItem;
          const allocated = allocations.filter((item: any) => item.openItemId === openItem?.id).reduce((sum: bigint, item: any) => sum + BigInt(item.amountRials), BigInt(0));
          const remaining = openItem ? BigInt(openItem.amountRials) - allocated : BigInt(0);
          return <ErpCard key={invoice.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><strong>{invoice.supplierParty.displayName}</strong><span className="mt-1 block text-sm text-[var(--sds-text-secondary)]">فاکتور {invoice.supplierInvoiceNumber} · {dateFa(invoice.documentDate)}</span></div><ErpBadge tone={remaining > BigInt(0) ? 'warning' : 'success'}>{remaining > BigInt(0) ? 'باز' : 'تسویه‌شده'}</ErpBadge></div><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><span>خالص پرداختنی: {rial(invoice.netPayableRials)}</span><span>مانده: {rial(remaining)}</span><span>سررسید: {dateFa(invoice.dueDate)}</span><span>{Number(invoice.lines.length).toLocaleString('fa-IR')} ردیف</span></div></ErpCard>;
        })}</div>}
      </ErpSection>}

      {tab === 'inventory' && <>
        <ErpSection title="هویت‌ها و لایه‌های ارزش‌گذاری">
          {!data?.identities?.length ? <ErpEmptyState title="موجودی حسابداری‌شده‌ای ثبت نشده است." /> : <div className="grid gap-3 lg:grid-cols-2">{data.identities.map((identity: any) => {
            const currentValue = identity.layers.reduce((sum: bigint, layer: any) => sum + BigInt(layer.valueRials) - (layer.consumptions ?? []).reduce((used: bigint, item: any) => used + BigInt(item.valueRials), BigInt(0)), BigInt(0));
            const latestEvent = identity.events?.[0];
            return <ErpCard key={identity.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><strong>{identity.id}</strong><span className="mt-1 block text-sm text-[var(--sds-text-secondary)]">واحد حاکم: {identity.governedUnit}</span></div><ErpBadge tone="info">{valuationFa[identity.valuationMethod] || 'روش ارزش‌گذاری ثبت‌شده'}</ErpBadge></div><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><span>ارزش جاری: {rial(currentValue)}</span><span>لایه‌ها: {Number(identity.layers.length).toLocaleString('fa-IR')}</span><span>رزرو فعال: {Number(identity.reservations.length).toLocaleString('fa-IR')}</span><span>مکان جاری: {latestEvent ? `${latestEvent.warehouseId} · ${latestEvent.locationId}` : 'ثبت نشده'}</span><span>منشأ: {identity.originId || 'ثبت نشده'}</span></div></ErpCard>;
          })}</div>}
        </ErpSection>
        <ErpSection title="مهاجرت افتتاحیه">
          {!data?.migrations?.length ? <ErpEmptyState title="پیش‌نمایش افتتاحیه‌ای ثبت نشده است." /> : <div className="grid gap-3 md:grid-cols-2">{data.migrations.map((run: any) => <ErpCard key={run.id} className="p-4"><div className="flex items-center justify-between gap-3"><strong>نسخه نگاشت {Number(run.mappingVersion).toLocaleString('fa-IR')}</strong><ErpBadge tone={run.status === 'COMMITTED' ? 'success' : run.status === 'RECONCILED' ? 'info' : 'warning'}>{run.status === 'COMMITTED' ? 'ثبت‌شده' : run.status === 'RECONCILED' ? 'تطبیق‌شده' : 'پیش‌نمایش'}</ErpBadge></div><span className="mt-3 block text-sm">کنترل سپیدار: {rial(run.sepidarControlRials)} · {Number(run._count.items).toLocaleString('fa-IR')} قلم</span></ErpCard>)}</div>}
        </ErpSection>
      </>}

      {tab === 'checks' && <ErpSection title="زنجیره حقوقی و حضانت چک‌های پرداختنی">
        {!data?.checks?.length ? <ErpEmptyState title="چک پرداختنی ثبت نشده است." /> : <div className="grid gap-3 lg:grid-cols-2">{data.checks.map((check: any) => <ErpCard key={check.id} className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><strong>{check.supplierParty.displayName}</strong><span className="mt-1 block text-sm">صیاد {check.sayadId}</span></div><ErpBadge tone={check.status === 'CLEARED' ? 'success' : check.status === 'BOUNCED' ? 'danger' : 'warning'}>{checkFa[check.status] || check.status}</ErpBadge></div><div className="mt-4 grid grid-cols-2 gap-3 text-sm"><span>{rial(check.amountRials)}</span><span>سررسید {dateFa(check.dueDate)}</span></div><div className="mt-3 flex flex-wrap gap-2">{check.events.map((event: any) => <ErpBadge key={event.id} tone="neutral">{checkFa[event.status] || event.status}</ErpBadge>)}</div></ErpCard>)}</div>}
      </ErpSection>}

      {tab === 'exceptions' && <ErpSection title="موارد متوقف‌شده بدون اثر دفترکل">
        {!data?.exceptions?.length ? <ErpEmptyState title="استثنای بازی وجود ندارد." description="همه شواهد پذیرفته‌شده بدون اختلاف ثبت شده‌اند." /> : <div className="grid gap-3 lg:grid-cols-2">{data.exceptions.map((item: any) => <ErpCard key={item.id} className="p-4"><div className="flex items-start justify-between gap-3"><strong>{item.messagePersian}</strong><ErpBadge tone="danger">متوقف</ErpBadge></div><span className="mt-3 block text-sm text-[var(--sds-text-secondary)]">شناسه شاهد {item.sourceId} · نسخه {Number(item.sourceVersion).toLocaleString('fa-IR')} · {dateFa(item.createdAt)}</span></ErpCard>)}</div>}
      </ErpSection>}

      {tab === 'settings' && <>
        <ErpSection title="نسخه جدید قاعده ثبت" description="نسخه پیشین تا لحظه اثر نسخه جدید حفظ می‌شود و سندهای گذشته بازنویسی نمی‌شوند.">
          {!book ? <ErpEmptyState title="ابتدا دفتر اصلی را در بخش دفترکل ایجاد کنید." /> : <><div className="grid gap-3 md:grid-cols-3"><label><span className="mb-2 block text-sm">نقش حسابی</span><ErpSelect value={rule.accountRole} onChange={(event) => setRule({ ...rule, accountRole: event.target.value })}><option value="">انتخاب نقش حسابی</option>{Object.entries(postingRoleFa).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</ErpSelect></label><label><span className="mb-2 block text-sm">حساب معین</span><ErpSelect value={rule.accountId} onChange={(event) => setRule({ ...rule, accountId: event.target.value })}><option value="">انتخاب حساب</option>{accounts.map((account: any) => <option key={account.id} value={account.id}>{account.code} · {account.titlePersian}</option>)}</ErpSelect></label><label><span className="mb-2 block text-sm">تاریخ اثر</span><ErpInput type="date" value={rule.effectiveFrom} onChange={(event) => setRule({ ...rule, effectiveFrom: event.target.value })} /></label></div><div className="mt-4 flex justify-end"><ErpButton label="فعال‌سازی نسخه" disabled={!rule.accountRole.trim() || !rule.accountId || !rule.effectiveFrom} onClick={saveRule} /></div></>}
        </ErpSection>
        <ErpSection title="قواعد فعال">{!activeRules.length ? <ErpEmptyState title="قاعده ثبتی تعریف نشده است." /> : <div className="grid gap-3 md:grid-cols-2">{activeRules.map((item: any) => <ErpCard key={item.id} className="p-4"><strong>{postingRoleFa[item.accountRole] || 'نقش حسابی تعریف‌شده'}</strong><span className="mt-2 block text-sm">{item.account.code} · {item.account.titlePersian}</span><span className="mt-1 block text-xs text-[var(--sds-text-muted)]">نسخه {Number(item.version).toLocaleString('fa-IR')} · از {dateFa(item.effectiveFrom)}</span></ErpCard>)}</div>}</ErpSection>
      </>}
    </ErpPage>
  );
}
