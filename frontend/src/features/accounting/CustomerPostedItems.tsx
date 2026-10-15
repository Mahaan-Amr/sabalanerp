'use client';
import { ErpBadge, ErpButton, ErpCard, ErpDisclosure, ErpEmptyState, ErpSection, ErpSummaryGrid } from '@/components/erp';
import { dateFa } from './accountingUi';
import { accountMoney, accountStatusLabels, type AccountItem, type CustomerAccount } from './customerAccountModel';
import { postedReceiptShares, recordForPostedItem } from './customerPostedLinks';

export default function CustomerPostedItems({ account, items, title, onEvidence, evidenceLoading }: {
  account: CustomerAccount; items: AccountItem[]; title: string; onEvidence: (id: string) => void; evidenceLoading: boolean;
}) {
  return <section aria-label={title}><ErpSection title={title} description="مبلغ قلم منتقل‌شده و مصرف آن جدا از مبلغ اصلی صورتحساب است؛ این نمایش ثبت مالی تازه‌ای نمی‌سازد.">
    {!items.length && <ErpEmptyState title="قلم قطعی مرتبط ثبت نشده است" />}
    {items.map(item => {
      const record = recordForPostedItem(account, item);
      const contract = account.contracts.find(row => row.id === item.contractId);
      const shares = postedReceiptShares(account, item.id);
      const creditShares = (account.creditAllocations || []).filter(row => !row.reversedAt).flatMap(row => row.lines.filter(line => line.openItemId === item.id).map(line => ({ ...line, allocation: row })));
      return <ErpCard key={item.id} className="mb-3 space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><strong className="min-w-0 break-words">{item.description || item.invoiceNumber}</strong><div className="flex flex-wrap gap-2"><ErpBadge tone={item.kind === 'CREDIT' ? 'success' : 'info'}>{item.kind === 'CREDIT' ? 'بستانکاری قطعی' : 'دریافتنی قطعی'}</ErpBadge><ErpBadge tone="neutral">{item.sourceKind === 'OPENING' ? 'افتتاحیه' : item.sourceKind === 'SALE' ? 'فروش قطعی' : 'ثبت مستقل'}</ErpBadge><ErpBadge tone={BigInt(item.remainingRials) === BigInt(0) ? 'success' : 'warning'}>{BigInt(item.remainingRials) === BigInt(0) ? 'تسویه‌شده' : 'دارای مانده'}</ErpBadge></div></div>
        <p className="text-sm sds-text-secondary">{contract ? `قرارداد ${contract.contractNumber}` : 'مستقل از قرارداد'} · {record ? `فاکتور ${record.systemInvoiceNumber || 'بدون شماره'}` : 'بدون انتساب دقیق به فاکتور'} · سررسید {dateFa(item.dueAt)}</p>
        <ErpSummaryGrid columns={3} items={[{ label: 'مبلغ اصلی قلم قطعی', value: accountMoney(item.originalRials) }, { label: 'تسویه / مصرف فعال', value: accountMoney((BigInt(item.originalRials) - BigInt(item.remainingRials)).toString()) }, { label: 'مانده قلم قطعی', value: accountMoney(item.remainingRials) }]} />
        {(shares.length > 0 || creditShares.length > 0) && <ErpDisclosure title="منابع تخصیص فعال"><div className="space-y-3">
          {shares.map((share, index) => <div key={`${share.allocation.id}:${index}`} className="space-y-2"><p>{accountStatusLabels[share.receipt.componentKind || 'BANK']} · {dateFa(share.receipt.occurredAt)} · سهم این بدهی: {accountMoney(share.amountRials)}</p><ErpButton label="سند دریافت مرتبط" tone="neutral" disabled={evidenceLoading} onClick={() => onEvidence(share.receipt.postedVoucherId)} /><ErpButton label="سند تخصیص مرتبط" tone="neutral" disabled={evidenceLoading} onClick={() => onEvidence(share.allocation.ledgerVoucherId)} /></div>)}
          {creditShares.map((share, index) => <div key={`${share.allocation.id}:${index}`}><p>بستانکاری مستقل · سهم این بدهی: {accountMoney(share.amountRials)}</p>{share.allocation.ledgerVoucherId && <ErpButton label="سند تخصیص اعتبار مرتبط" tone="neutral" disabled={evidenceLoading} onClick={() => onEvidence(share.allocation.ledgerVoucherId!)} />}</div>)}
        </div></ErpDisclosure>}
        <div className="flex flex-wrap gap-2"><ErpButton label="سند قلم قطعی" tone="neutral" disabled={evidenceLoading} onClick={() => onEvidence(item.ledgerVoucherId)} />{contract && <ErpButton label="رسیدگی مالی قرارداد مرتبط" tone="neutral" href={`/dashboard/accounting/contracts/${contract.id}`} />}</div>
      </ErpCard>;
    })}
  </ErpSection></section>;
}
