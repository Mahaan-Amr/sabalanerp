import type { AccountItem, CustomerAccount } from './customerAccountModel';

// Contract-only attribution is not proof that a particular invoice is included.
export function recordForPostedItem(account: CustomerAccount, item: AccountItem) {
  if (item.financialRecordId) return account.financialRecords.find(row => row.id === item.financialRecordId && (!item.contractId || row.contractId === item.contractId));
  if (item.sourceKind !== 'SALE' || !item.contractId) return undefined;
  const matches = account.financialRecords.filter(row => row.contractId === item.contractId && row.systemInvoiceNumber === item.invoiceNumber);
  return matches.length === 1 ? matches[0] : undefined;
}

export function postedReceiptShares(account: CustomerAccount, itemId: string) {
  return account.receipts.flatMap(receipt => receipt.allocations.filter(row => !row.reversedAt).flatMap(allocation => allocation.lines
    .filter(line => line.openItemId === itemId).map(line => ({ receipt, allocation, amountRials: line.amountRials }))));
}
