import { normalizeAccountAmount, type CustomerAccount } from './customerAccountModel';

export type ReceiptPartDraft = {
  key: string; kind: 'BANK' | 'CASH' | 'CARD' | 'CHECK'; amount: string; financialId: string; ledgerId: string;
  serial: string; bank: string; sayad: string; due: string; fee: string; feeLedgerId: string;
  existingCheckId?: string;
  existingCheckStatus?: string;
  existingClearedRials?: string;
  collectedLedgerId?: string;
};
export const newReceiptPart = (key: string): ReceiptPartDraft => ({ key, kind: 'BANK', amount: '', financialId: '', ledgerId: '', serial: '', bank: '', sayad: '', due: '', fee: '', feeLedgerId: '' });
export type OpeningLineDraft = { key: string; kind: 'RECEIVABLE' | 'CREDIT'; amount: string; reference: string; existingSourceIds: string[]; financialRecordId: string; contractId: string };
export const newOpeningLine = (key: string): OpeningLineDraft => ({ key, kind: 'RECEIVABLE', amount: '', reference: '', existingSourceIds: [], financialRecordId: '', contractId: '' });
export const rialsInput = (value: string, signed = false) => {
  const normalized = normalizeAccountAmount(value);
  if (!(signed ? /^-?\d+$/ : /^\d+$/).test(normalized)) throw new Error('مبلغ را به ریال و بدون اعشار وارد کنید.');
  return normalized;
};
export function receiptPartsPayload(parts: ReceiptPartDraft[]) {
  return parts.map(part => ({ key: part.key, kind: part.kind, amountRials: rialsInput(part.amount), financialAccountId: part.financialId, ledgerAccountId: part.ledgerId,
    existingCheckId: part.existingCheckId || undefined,
    collectedLedgerAccountId: part.collectedLedgerId || undefined,
    feeRials: rialsInput(part.kind === 'CHECK' ? '0' : part.fee || '0'), feeLedgerAccountId: part.kind === 'CHECK' ? undefined : part.feeLedgerId || undefined,
    check: part.kind === 'CHECK' ? { serialNumber: part.serial, bankName: part.bank, sayadId: part.sayad || undefined, dueAt: new Date(part.due).toISOString() } : undefined }));
}
export function openingLinesPayload(lines: OpeningLineDraft[], account: CustomerAccount, total: string) {
  const payload = lines.map(line => ({ key: line.key, kind: line.kind, amountRials: rialsInput(line.amount), reference: line.reference,
    existingSourceIds: line.existingSourceIds, financialRecordId: line.financialRecordId || undefined, contractId: line.contractId || undefined }));
  const used = payload.flatMap(row => row.existingSourceIds);
  if (!payload.length || new Set(used).size !== used.length || (account.openingSources ?? []).some(row => !used.includes(row.id))) throw new Error('تمام اقلام قطعی موجود را یک بار در ریز افتتاحیه تطبیق دهید.');
  if (payload.reduce((sum, row) => sum + (row.kind === 'CREDIT' ? -BigInt(row.amountRials) : BigInt(row.amountRials)), BigInt(0)) !== BigInt(rialsInput(total, true))) throw new Error('جمع ریز با مانده کل تأییدشده برابر نیست.');
  for (const row of payload) {
    const existing = (account.openingSources ?? []).filter(source => row.existingSourceIds.includes(source.id));
    if (!row.reference.trim() || existing.some(source => source.kind !== row.kind) || existing.reduce((sum, source) => sum + BigInt(source.amountRials), BigInt(0)) > BigInt(row.amountRials)) throw new Error('مدرک، جهت یا سهم موجود هر قلم افتتاحیه را بررسی کنید.');
  }
  return payload;
}
export function allocationPlanPayload(shares: Record<string, Record<string, string>>) {
  const plan = Object.entries(shares).map(([source, amounts]) => ({
    receiptId: source.startsWith('receipt:') ? source.slice(8) : undefined, creditItemId: source.startsWith('credit:') ? source.slice(7) : undefined,
    allocations: Object.entries(amounts).filter(([, amount]) => amount.trim()).map(([openItemId, amount]) => ({ openItemId, amountRials: rialsInput(amount) })),
  })).filter(row => row.allocations.length);
  if (!plan.length || plan.some(row => row.allocations.some(line => BigInt(line.amountRials) <= BigInt(0)))) throw new Error('سهم مثبت منبع و بدهی را برای تخصیص مشخص کنید.');
  return plan;
}
