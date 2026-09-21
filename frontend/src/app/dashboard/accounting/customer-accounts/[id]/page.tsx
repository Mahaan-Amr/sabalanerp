'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { FaFileExcel, FaFilePdf, FaSync } from 'react-icons/fa';
import { ErpBadge, ErpCard, ErpEmptyState, ErpInlineState, ErpPage, ErpSection } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { accountingFailureMessage, dateFa, money } from '@/features/accounting/accountingUi';

export default function CustomerAccountDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<any>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const response = await accountingAPI.getCustomerAccountProjection(params.id, { asOf: new Date().toISOString() }); setData(response.data.data); }
    catch (reason) { setError(accountingFailureMessage(reason, 'ریزگردش حساب مشتری بارگیری نشد.')); }
    finally { setLoading(false); }
  }, [params.id]);
  useEffect(() => { load(); }, [load]);
  const download = useCallback(async (format: 'pdf' | 'xlsx') => {
    setError(null);
    try {
      const response = await accountingAPI.exportCustomerStatement(params.id, format, new Date().toISOString());
      const url = window.URL.createObjectURL(response.data);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `صورتحساب-مشتری.${format}`; anchor.click();
      window.URL.revokeObjectURL(url);
    } catch (reason) { setError(accountingFailureMessage(reason, 'ساخت خروجی صورتحساب انجام نشد.')); }
  }, [params.id]);
  return <ErpPage eyebrow="حسابداری مشتریان" title={data?.profile?.displayName || 'ریزگردش حساب مشتری'}
    description="هر مبلغ به فاکتور تجاری، سند دفترکل، شاهد انتقال کنترل و تخصیص تسویه قابل پیگیری است."
    backHref="/dashboard/accounting/customer-accounts" actions={[...(data?.capabilities?.canExport ? [
      { label: 'خروجی PDF', icon: FaFilePdf, onClick: () => download('pdf') },
      { label: 'خروجی Excel', icon: FaFileExcel, onClick: () => download('xlsx') },
    ] : []), { label: 'به‌روزرسانی', icon: FaSync, onClick: load }]}
    metrics={data ? [
      { label: 'مانده دریافتنی', value: money(data.receivableRials, 'IRR') },
      { label: 'وجه تخصیص‌نیافته', value: money(data.unallocatedCreditRials, 'IRR') },
      { label: 'اقلام باز', value: Number(data.openItems?.length || 0).toLocaleString('fa-IR') },
    ] : []}>
    {loading && <ErpInlineState kind="empty" title="در حال محاسبه مانده از اسناد قطعی..." />}
    {error && <ErpInlineState kind="error" title={error} action={{ label: 'تلاش دوباره', onClick: load }} />}
    {data && <ErpSection title="اقلام باز و سررسید" description="تسویه فقط با تخصیص قطعی کم می‌شود و اصلاح، سند برگشت مستقل می‌سازد.">
      {data.openItems?.length ? <div className="grid gap-3">{data.openItems.map((item: any) => <ErpCard key={item.id} className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><strong>{item.kind === 'CREDIT' ? 'بستانکاری' : 'صورتحساب'} {item.invoiceNumber}</strong><span className="mt-1 block text-sm text-[var(--sds-text-secondary)]">قرارداد {item.contractId}</span></div>
          <ErpBadge tone={item.kind === 'CREDIT' ? 'success' : item.agingDays > 0 ? 'danger' : 'info'}>{item.kind === 'CREDIT' ? 'اعتبار برگشت از فروش' : item.agingDays > 0 ? `${Number(item.agingDays).toLocaleString('fa-IR')} روز گذشته` : 'در مهلت'}</ErpBadge></div>
        <div className="mt-4 grid gap-2 text-sm md:grid-cols-3"><span>اصل مبلغ: {money(item.originalRials, 'IRR')}</span><strong>مانده: {money(item.remainingRials, 'IRR')}</strong><span>سررسید: {dateFa(item.dueAt)}</span></div>
        <div className="mt-3 grid gap-1 text-xs text-[var(--sds-text-muted)]"><span>سند دفترکل: {item.ledgerVoucherId}</span><span>صورتحساب مالیاتی: {item.taxInvoiceId || 'ندارد'}</span><span>شاهد {item.controlEvidence.type}: {item.controlEvidence.id} · نسخه {Number(item.controlEvidence.version).toLocaleString('fa-IR')}</span></div>
      </ErpCard>)}</div> : <ErpEmptyState title="قلم بازی وجود ندارد" description="همه دریافتنی‌های قطعی تا این لحظه تسویه شده‌اند." />}
    </ErpSection>}
    {data && <ErpSection title="دریافت‌ها و سابقه تخصیص" description="شناسه منبع، سند قطعی و برگشت تخصیص برای ردیابی کامل حفظ می‌شود.">
      {data.receipts?.length ? <div className="grid gap-3">{data.receipts.map((receipt: any) => <ErpCard key={receipt.id} className="p-4">
        <div className="flex flex-wrap justify-between gap-3"><div><strong>دریافت {receipt.source.type}</strong><span className="mt-1 block text-sm text-[var(--sds-text-secondary)]">{dateFa(receipt.occurredAt)} · منبع {receipt.source.id}</span></div><strong>{money(receipt.amountRials, 'IRR')}</strong></div>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-3"><span>تخصیص فعال: {money(receipt.allocatedRials, 'IRR')}</span><span>سند دفترکل: {receipt.postedVoucherId}</span><span>{Number(receipt.allocations.length).toLocaleString('fa-IR')} رویداد تخصیص</span></div>
      </ErpCard>)}</div> : <ErpEmptyState title="دریافتی ثبت نشده است" description="وجوه ثبت‌شده در خزانه‌داری اینجا با تخصیص‌هایشان نمایش داده می‌شوند." />}
    </ErpSection>}
  </ErpPage>;
}
