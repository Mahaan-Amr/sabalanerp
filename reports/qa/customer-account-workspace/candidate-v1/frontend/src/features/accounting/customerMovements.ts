import { accountOperationLabels, type CustomerAccount } from './customerAccountModel';
export type CustomerMovement = { id: string; label: string; at: string; debit: string; credit: string; balance: string; voucherId: string; contractId: string | null };
export function customerMovements(account: CustomerAccount): CustomerMovement[] {
  const movements: Omit<CustomerMovement, 'balance'>[] = [
    ...account.activityItems.map(item => ({ id: item.id, label: item.sourceKind === 'SALE' ? item.invoiceNumber : `${accountOperationLabels[item.sourceKind as keyof typeof accountOperationLabels] || 'ثبت مستقل'} · ${item.description || ''}`,
      at: item.postedAt, debit: item.kind === 'CREDIT' ? '0' : item.originalRials, credit: item.kind === 'CREDIT' ? item.originalRials : '0', voucherId: item.ledgerVoucherId, contractId: item.contractId })),
    ...account.receipts.map(receipt => ({ id: receipt.id, label: 'دریافت وجه', at: receipt.occurredAt, debit: '0', credit: receipt.amountRials, voucherId: receipt.postedVoucherId, contractId: null })),
    ...account.refunds.map(refund => ({ id: refund.id, label: 'استرداد وجه', at: refund.occurredAt, debit: refund.amountRials, credit: '0', voucherId: refund.postedVoucherId, contractId: null })),
    ...account.receipts.flatMap(receipt => receipt.allocations.flatMap(allocation => {
      const total = allocation.lines.reduce((sum, line) => sum + BigInt(line.amountRials), BigInt(0)).toString();
      return [{ id: allocation.id, label: 'تخصیص دریافت', at: allocation.createdAt, debit: total, credit: total, voucherId: allocation.ledgerVoucherId, contractId: null },
        ...(allocation.reversedAt ? [{ id: `${allocation.id}:reverse`, label: 'برگشت تخصیص', at: allocation.reversedAt, debit: total, credit: total, voucherId: allocation.reversalVoucherId || '', contractId: null }] : [])];
    })),
  ];
  let balance = BigInt(0);
  return movements.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)).map(row => {
    balance += BigInt(row.debit) - BigInt(row.credit); return { ...row, balance: balance.toString() };
  });
}

