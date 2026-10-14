export type CustomerAccountRow = {
  id: string; customerId: string; displayName: string; trustCategory: string; historical: boolean;
  receivableRials: string; unallocatedCreditRials: string; netBalanceRials: string; openItemCount: number; hasActivity: boolean;
};
export type CustomerAccount = {
  movements: Array<{ id: string; label: string; at: string; debit: string; credit: string; balance: string; voucherId: string | null; contractId: string | null }>;
  customerId: string; displayName: string; bookId: string | null; profile: { id: string } | null;
  customer: { trustCategory: string; cardDeletedAt: string | null; workNumber: string | null; homeNumber: string | null } | null;
  credit: { limitRials: string | null; usedRials: string; availableRials: string | null } | null;
  receivableRials: string; unallocatedCreditRials: string; netBalanceRials: string;
  debitOpenRials?: string; standaloneCreditRials?: string; refundableRials?: string;
  openingSnapshotHash?: string;
  openingReview?: { id: string; basisAt: string; totalRials: string; transferRials: string; createdAt?: string; evidence: { review: { lines: Array<{ key: string; reference: string; contractId?: string; financialRecordId?: string }> } } } | null;
  openingAttributions?: Array<{ id: string; lineKey: string; sequence: number; contractId: string | null; financialRecordId: string | null; reason: string; reference: string; createdAt: string }>;
  openingSources?: Array<{ id: string; kind: 'RECEIVABLE' | 'CREDIT'; description: string | null; amountRials: string; contractId: string | null; voucherId: string | null }>;
  creditAllocations?: Array<{ id: string; creditItemId: string; occurredAt: string; reversedAt: string | null; ledgerVoucherId: string | null;
    lines: Array<{ openItemId: string; amountRials: string }> }>;
  capabilities: { canExport: boolean; canManageTreasury: boolean; canManageAccount: boolean; canRefund: boolean };
  contracts: Array<{ id: string; contractNumber: string; titlePersian: string; totalAmount: string | null; currency: string;
    status: string; isInactive: boolean; createdAt: string; commercialFlowVersion: number; customerCreditAmountRials: string; customerCreditPromisedDate: string | null }>;
  financialRecords: Array<{ id: string; contractId: string | null; kind: string; status: string; amount: string; currency: string; systemInvoiceNumber: string | null;
    systemInvoiceDate?: string | null; sepidarAmount?: string | null; createdAt: string; financiallyApprovedAt: string | null }>;
  receivables: Array<{ id: string; contractId: string | null; originalAmount: string; remainingAmount: string; paidAmount: string; currency: string; dueDate: string; status: string }>;
  payments: Array<{ id: string; contractId: string | null; method: string; amount: string; currency: string; status: string; checkStatus: string | null; checkNumber: string | null; checkDueDate: string | null; occurredAt: string | null }>;
  treasuryChecks: Array<{ id: string; serialNumber: string; bankName: string; amountRials: string; clearedRials?: string; unpaidRials?: string;
    dueAt: string; status: string; direction: string; events?: Array<{ sequence: number }> }>;
  openItems: AccountItem[]; activityItems: AccountItem[];
  receipts: Array<{ id: string; amountRials: string; effectiveAmountRials?: string; remainingRials?: string; refundableRials?: string;
    componentKind?: string; receiptGroupId?: string | null; checkInstrumentId?: string | null; source?: { type: string; id: string };
    allocatedRials: string; refundedRials: string; occurredAt: string; postedVoucherId: string;
    adjustments?: Array<{ id: string; kind: string; deltaRials: string; occurredAt: string; ledgerVoucherId: string; reason: string; reference: string }>;
    allocations: Array<{ id: string; createdAt: string; reversedAt: string | null; reversalVoucherId?: string | null; ledgerVoucherId: string; lines: Array<{ openItemId: string; amountRials: string }> }> }>;
  refunds: Array<{ id: string; amountRials: string; occurredAt: string; postedVoucherId: string }>;
};
export type AccountItem = { id: string; kind: string; sourceKind: string; description: string | null; invoiceNumber: string;
  contractId: string | null; originalRials: string; remainingRials: string; dueAt: string; postedAt: string; ledgerVoucherId: string; agingDays: number };
export type AccountOperationKind = 'RECEIPT' | 'ALLOCATION' | 'REVERSE_ALLOCATION' | 'OPENING' | 'DEBIT' | 'CREDIT' | 'SET_BALANCE' | 'REFUND' | 'CORRECT_RECEIPT' | 'CANCEL_RECEIPT' | 'CHECK_DEPOSIT' | 'CHECK_SETTLE' | 'ATTRIBUTION';
export const accountOperationLabels: Record<AccountOperationKind, string> = { RECEIPT: 'ثبت دریافت', ALLOCATION: 'تخصیص اعتبار', REVERSE_ALLOCATION: 'برگشت تخصیص',
  OPENING: 'مانده افتتاحیه', DEBIT: 'ثبت بدهکاری', CREDIT: 'ثبت بستانکاری', SET_BALANCE: 'تنظیم مانده', REFUND: 'استرداد وجه',
  CORRECT_RECEIPT: 'اصلاح دریافت', CANCEL_RECEIPT: 'لغو دریافت', CHECK_DEPOSIT: 'واگذاری چک به بانک', CHECK_SETTLE: 'وصول / عدم پرداخت چک', ATTRIBUTION: 'تطبیق انتساب افتتاحیه' };
export const accountStatusLabels: Record<string, string> = {
  DRAFT: 'پیش‌نویس', READY: 'آماده بررسی', POSTED: 'ثبت قطعی', ISSUED: 'صادرشده', VOIDED: 'باطل‌شده',
  EXPECTED: 'در انتظار دریافت', RECEIVED: 'دریافت‌شده', RECONCILED: 'تطبیق‌شده', CLEARED: 'وصول‌شده',
  DEPOSITED: 'واگذارشده به بانک', BOUNCED: 'برگشت‌خورده', RETURNED: 'عودت‌شده', REVERSED: 'برگشت ثبت',
  ENDORSED: 'پشت‌نویسی‌شده', ASSIGNED: 'واگذارشده', REPLACED: 'جایگزین‌شده', CANCELLED: 'باطل‌شده',
  OPEN: 'باز', PARTIALLY_PAID: 'پرداخت بخشی', SETTLED: 'تسویه‌شده', OVERDUE: 'سررسید گذشته',
  PARTIAL_SETTLED: 'بخشی وصول، بخشی پرداخت‌نشده', CARD: 'کارت‌خوان', BANK: 'بانکی',
  INVOICE_CANDIDATE: 'صورتحساب', RECEIPT: 'دریافت', ADJUSTMENT: 'اصلاح مالی', CASH: 'نقدی', TRANSFER: 'واریز', BANK_TRANSFER: 'واریز بانکی', CHECK: 'چک',
};
export const receiptRemainingRials = (receipt: CustomerAccount['receipts'][number]) => receipt.remainingRials
  ?? (BigInt(receipt.effectiveAmountRials ?? receipt.amountRials) - BigInt(receipt.allocatedRials) - BigInt(receipt.refundedRials)).toString();
export const receiptIsCheck = (receipt: CustomerAccount['receipts'][number]) => receipt.componentKind === 'CHECK' || receipt.source?.type === 'CHECK_INSTRUMENT';
export const accountBalanceLabel = (value: string) => BigInt(value) > BigInt(0) ? 'بدهکار' : BigInt(value) < BigInt(0) ? 'بستانکار' : 'تراز';
export const normalizeAccountAmount = (value: string) => value.replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).replace(/[,٬\s]/g, '').replace(/−/g, '-');
export function accountMoney(value: string | null | undefined, currency = 'IRR') {
  if (value == null) return 'تعیین نشده';
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return 'مبلغ نامعتبر';
  const integer = (match[1] && BigInt(match[2]) === BigInt(0) && match[3] ? "−" : "") + BigInt(`${match[1]}${match[2]}`).toLocaleString('fa-IR');
  const fraction = match[3]?.replace(/0+$/, '');
  const suffix = currency === 'IRR' || currency === 'ریال' ? 'ریال' : currency === 'IRT' || currency === 'تومان' ? 'تومان' : currency;
  return `${integer}${fraction ? `٫${fraction.replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)])}` : ''} ${suffix}`;
}
