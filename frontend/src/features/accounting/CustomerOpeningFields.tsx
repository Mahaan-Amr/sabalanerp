'use client';
import { ErpButton, ErpCard, ErpCheckbox, ErpField, ErpInput, ErpSearchableSelect } from '@/components/erp';
import { accountMoney, type CustomerAccount } from './customerAccountModel';
import { newOpeningLine, type OpeningLineDraft } from './customerFinanceDraft';
export default function CustomerOpeningFields({ lines, onChange, account }: { lines: OpeningLineDraft[]; onChange: (lines: OpeningLineDraft[]) => void; account: CustomerAccount }) {
  const set = (key: string, patch: Partial<OpeningLineDraft>) => onChange(lines.map(line => line.key === key ? { ...line, ...patch } : line));
  return <div className="space-y-3">{lines.map((line, index) => <ErpCard key={line.key} className="space-y-3 p-4">
    <div className="flex flex-wrap justify-between gap-3"><strong>قلم افتتاحیه {(index + 1).toLocaleString('fa-IR')}</strong>{lines.length > 1 && <ErpButton label="حذف قلم" tone="neutral" onClick={() => onChange(lines.filter(row => row.key !== line.key))} />}</div>
    <div className="grid gap-3 md:grid-cols-2">
      <ErpField label="جهت مانده" required><ErpSearchableSelect aria-label={`جهت قلم ${index + 1}`} value={line.kind} onChange={event => set(line.key, { kind: event.target.value as OpeningLineDraft['kind'], existingSourceIds: [] })}><option value="RECEIVABLE">بدهکار</option><option value="CREDIT">بستانکار</option></ErpSearchableSelect></ErpField>
      <ErpField label="مانده باز تأییدشده قلم (ریال)" required hint="مبلغ پرداخت‌شده قبلی را دوباره منظور نکنید."><ErpInput required inputMode="numeric" value={line.amount} onChange={event => set(line.key, { amount: event.target.value })} /></ErpField>
      <ErpField label="فاکتور تطبیق‌شده"><ErpSearchableSelect aria-label={`فاکتور قلم ${index + 1}`} value={line.financialRecordId} onChange={event => { const record = account.financialRecords.find(row => row.id === event.target.value); set(line.key, { financialRecordId: event.target.value, contractId: record?.contractId ?? '' }); }}>
        <option value="">فاقد انتساب / مدرک مستقل</option>{account.financialRecords.map(row => <option key={row.id} value={row.id}>{row.systemInvoiceNumber || 'رکورد بدون شماره فاکتور'} · {accountMoney(row.amount, row.currency)}</option>)}
      </ErpSearchableSelect></ErpField>
      <ErpField label="قرارداد مرتبط"><ErpSearchableSelect aria-label={`قرارداد قلم ${index + 1}`} value={line.contractId} onChange={event => set(line.key, { contractId: event.target.value, financialRecordId: '' })}>
        <option value="">مستقل / نامنطبق</option>{account.contracts.map(row => <option key={row.id} value={row.id}>{row.contractNumber} · {row.titlePersian}</option>)}
      </ErpSearchableSelect></ErpField>
      <ErpField label="مدرک تطبیق و شمول این قلم" required><ErpInput required value={line.reference} onChange={event => set(line.key, { reference: event.target.value })} /></ErpField>
    </div>
    {(account.openingSources ?? []).filter(row => row.kind === line.kind).map(row => <ErpCheckbox key={row.id} checked={line.existingSourceIds.includes(row.id)}
      label={`${row.description || 'قلم قطعی موجود'} · ${accountMoney(row.amountRials)} · در مبلغ این قلم منظور شده`}
      onChange={event => set(line.key, { existingSourceIds: event.target.checked ? [...line.existingSourceIds, row.id] : line.existingSourceIds.filter(id => id !== row.id) })} />)}
  </ErpCard>)}<ErpButton label="افزودن قلم افتتاحیه" tone="neutral" onClick={() => onChange([...lines, newOpeningLine(crypto.randomUUID())])} /></div>;
}
