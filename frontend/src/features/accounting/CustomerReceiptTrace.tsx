'use client';
import { useState } from 'react';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpField, ErpSearchableSelect } from '@/components/erp';
import { accountMoney, accountStatusLabels, receiptRemainingRials, type CustomerAccount } from './customerAccountModel';
import { recordForPostedItem } from './customerPostedLinks';
import { dateFa } from './accountingUi';
import styles from './customerAccountWorkspace.module.css';

export default function CustomerReceiptTrace({ account, onAllocate, onItem, onEvidence, evidenceLoading }: {
  account: CustomerAccount; onAllocate: () => void; onItem: (id: string) => void; onEvidence: (id: string) => void; evidenceLoading: boolean;
}) {
  const [selected, setSelected] = useState('');
  const receipt = account.receipts.find(row => row.id === selected) ?? account.receipts[0];
  if (!receipt) return <ErpEmptyState title="دریافت قطعی ثبت نشده است" />;
  const allocations = receipt.allocations.filter(row => !row.reversedAt);
  const shares = allocations.flatMap(allocation => allocation.lines.map((line, index) => ({ ...line, allocation, key: `${allocation.id}:${index}` })));
  return <ErpCard className="p-4 sm:p-5"><div className={styles.trace}>
    <div className="min-w-0 space-y-4"><ErpField label="دریافت"><ErpSearchableSelect value={receipt.id} onChange={event => setSelected(event.target.value)}>{account.receipts.map(row => <option key={row.id} value={row.id}>
      {accountStatusLabels[row.componentKind || 'BANK'] || 'دریافت'} · {accountMoney(row.effectiveAmountRials ?? row.amountRials)} · {dateFa(row.occurredAt)}</option>)}</ErpSearchableSelect></ErpField>
      <strong className="block">{accountMoney(receipt.effectiveAmountRials ?? receipt.amountRials)}</strong>
      <p className="text-sm sds-text-secondary">آزاد: {accountMoney(receiptRemainingRials(receipt))}</p>
      <ErpButton label="سند دریافت" tone="neutral" disabled={evidenceLoading} onClick={() => onEvidence(receipt.postedVoucherId)} />
      {account.capabilities.canManageTreasury && <ErpButton label="تخصیص اعتبار" onClick={onAllocate} />}
    </div>
    <div className="min-w-0 space-y-3"><div className="flex flex-wrap items-center gap-2"><strong>ارتباط با بدهی‌ها</strong><ErpBadge tone={shares.length ? 'success' : 'neutral'}>{shares.length.toLocaleString('fa-IR')} سهم فعال</ErpBadge></div>
      {!shares.length && <ErpEmptyState title="تخصیص فعالی ندارد" />}
      {shares.map(share => {
        const item = account.activityItems.find(row => row.id === share.openItemId);
        const record = item ? recordForPostedItem(account, item) : undefined;
        const contract = account.contracts.find(row => row.id === item?.contractId);
        return <ErpCard key={share.key} className="space-y-3 p-4" tone="success"><div className="flex flex-wrap justify-between gap-3"><strong>{contract ? `قرارداد ${contract.contractNumber}` : item?.contractId ? 'قرارداد تاریخی' : 'مستقل از قرارداد'}</strong><strong>{accountMoney(share.amountRials)}</strong></div>
          <p className="break-words text-sm sds-text-secondary">{record ? `فاکتور ${record.systemInvoiceNumber || 'بدون شماره'}` : item?.invoiceNumber || 'قلم تاریخی'}</p>
          {item && <p className="text-sm">مانده بدهی: {accountMoney(item.remainingRials)}</p>}
          <div className="flex flex-wrap gap-2">{item && <ErpButton label="جزئیات بدهی" tone="neutral" onClick={() => onItem(item.id)} />}
            <ErpButton label="سند تخصیص" tone="neutral" disabled={evidenceLoading} onClick={() => onEvidence(share.allocation.ledgerVoucherId)} /></div>
        </ErpCard>;
      })}
    </div>
  </div></ErpCard>;
}
