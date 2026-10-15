'use client';
import { ErpButton, ErpCard, ErpField, ErpInput, ErpPersianDateField, ErpSearchableSelect } from '@/components/erp';
import { newReceiptPart, type ReceiptPartDraft } from './customerFinanceDraft';
export type CustomerFinanceContext = {
  periods: Array<{ id: string; titlePersian: string; startsAt: string; endsAt: string; fiscalYear: { titlePersian: string } }>;
  rules: Array<{ id: string; code: string; version: number; effectiveFrom: string; effectiveTo: string | null; bankClearingAccountId: string; receivableAccountId: string; customerAdvanceAccountId: string }>;
  accounts: Array<{ id: string; code: string; titlePersian: string; financialAccountRequirement: string; partyRequirement: string; statementRole: string; normalSide: string }>;
  financialAccounts: Array<{ id: string; titlePersian: string; currency: string }>;
  suppliers?: Array<{ id: string; displayName: string }>;
  supplierOpenItems?: Array<{ id: string; supplierPartyId: string; invoiceNumber: string; remainingRials: string }>;
};
export default function CustomerReceiptPartsFields({ parts, onChange, context }: { parts: ReceiptPartDraft[]; onChange: (parts: ReceiptPartDraft[]) => void; context: CustomerFinanceContext }) {
  const set = (key: string, patch: Partial<ReceiptPartDraft>) => onChange(parts.map(part => part.key === key ? { ...part, ...patch } : part));
  return <div className="space-y-3">{parts.map((part, index) => <ErpCard key={part.key} className="space-y-3 p-4">
    <div className="flex flex-wrap justify-between gap-3"><strong>جزء دریافت {(index + 1).toLocaleString('fa-IR')}</strong>{parts.length > 1 && <ErpButton label="حذف جزء" tone="neutral" onClick={() => onChange(parts.filter(row => row.key !== part.key))} />}</div>
    <div className="grid gap-3 md:grid-cols-2">
      <ErpField label="ابزار دریافت" required><ErpSearchableSelect aria-label={`ابزار دریافت ${index + 1}`} value={part.kind} onChange={event => set(part.key, { kind: event.target.value as ReceiptPartDraft['kind'], ledgerId: '', fee: '', feeLedgerId: '', existingCheckId: '', existingCheckStatus: undefined, existingClearedRials: undefined, collectedLedgerId: '' })}>
        <option value="BANK">واریز بانکی</option><option value="CASH">نقد</option><option value="CARD">کارت‌خوان</option><option value="CHECK">چک</option>
      </ErpSearchableSelect></ErpField>
      <ErpField label="مبلغ جزء (ریال)" required><ErpInput required inputMode="numeric" value={part.amount} onChange={event => set(part.key, { amount: event.target.value })} /></ErpField>
      <ErpField label={part.kind === 'CHECK' ? 'حساب مالی نگهداری ابزار' : 'حساب دریافت وجه'} required><ErpSearchableSelect required aria-label={`حساب مالی جزء ${index + 1}`} value={part.financialId} onChange={event => set(part.key, { financialId: event.target.value })}>
        <option value="">انتخاب حساب</option>{context.financialAccounts.filter(row => row.currency === 'IRR').map(row => <option key={row.id} value={row.id}>{row.titlePersian}</option>)}
      </ErpSearchableSelect></ErpField>
      <ErpField label={part.kind === 'CHECK' && part.existingCheckStatus !== 'CLEARED' ? 'معین اسناد در محل فعلی' : 'معین بانک / صندوق'} required><ErpSearchableSelect required aria-label={`معین جزء ${index + 1}`} value={part.ledgerId} onChange={event => set(part.key, { ledgerId: event.target.value })}>
        <option value="">انتخاب معین</option>{context.accounts.filter(row => row.statementRole === 'ASSET' && (part.kind === 'CHECK' && part.existingCheckStatus !== 'CLEARED' ? row.partyRequirement === 'REQUIRED' && row.financialAccountRequirement === 'FORBIDDEN' : row.financialAccountRequirement !== 'FORBIDDEN')).map(row => <option key={row.id} value={row.id}>{row.code} · {row.titlePersian}</option>)}
      </ErpSearchableSelect></ErpField>
      {part.kind === 'CHECK' ? <>
        {part.existingCheckStatus !== 'CLEARED' && BigInt(part.existingClearedRials || '0') > BigInt(0) && <ErpField label="معین بانکی بخش وصول‌شده قبلی" required hint="مانده در جریان وصول جدا از بخش وصول‌شده حفظ می‌شود."><ErpSearchableSelect required aria-label={`معین وصول قبلی جزء ${index + 1}`} value={part.collectedLedgerId || ''} onChange={event => set(part.key, { collectedLedgerId: event.target.value })}><option value="">انتخاب معین بانک</option>{context.accounts.filter(row => row.statementRole === 'ASSET' && row.financialAccountRequirement === 'REQUIRED' && row.partyRequirement !== 'REQUIRED').map(row => <option key={row.id} value={row.id}>{row.code} · {row.titlePersian}</option>)}</ErpSearchableSelect></ErpField>}
        <ErpField label="شماره چک" required><ErpInput required value={part.serial} onChange={event => set(part.key, { serial: event.target.value })} /></ErpField>
        <ErpField label="بانک چک" required><ErpInput required value={part.bank} onChange={event => set(part.key, { bank: event.target.value })} /></ErpField>
        <ErpField label="شناسه صیادی"><ErpInput value={part.sayad} onChange={event => set(part.key, { sayad: event.target.value })} /></ErpField>
        <ErpPersianDateField label="سررسید چک" value={part.due} onChange={due => set(part.key, { due })} valueFormat="iso-date" required />
      </> : <>
        <ErpField label="کارمزد شرکت (ریال)" hint="دریافت مشتری به مبلغ ناخالص ثبت می‌شود؛ کارمزد هزینه جداست."><ErpInput inputMode="numeric" value={part.fee} onChange={event => set(part.key, { fee: event.target.value })} /></ErpField>
        {part.fee.trim() && <ErpField label="معین هزینه کارمزد" required><ErpSearchableSelect required aria-label={`معین هزینه جزء ${index + 1}`} value={part.feeLedgerId} onChange={event => set(part.key, { feeLedgerId: event.target.value })}>
          <option value="">انتخاب معین</option>{context.accounts.filter(row => row.statementRole === 'EXPENSE' && row.partyRequirement !== 'REQUIRED' && row.financialAccountRequirement !== 'REQUIRED').map(row => <option key={row.id} value={row.id}>{row.code} · {row.titlePersian}</option>)}
        </ErpSearchableSelect></ErpField>}
      </>}
    </div>
  </ErpCard>)}<ErpButton label="افزودن ابزار دریافت" tone="neutral" onClick={() => onChange([...parts, newReceiptPart(crypto.randomUUID())])} /></div>;
}
