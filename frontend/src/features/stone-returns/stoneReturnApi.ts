import api from '@/lib/api';

export const stoneReturnUnitLabels: Record<string, string> = {
  squareMeter: 'مترمربع', meter: 'متر طول', count: 'عدد', ton: 'تن',
};

export type StoneReturnAllocationStatus = 'REJECTED' | 'RECEIVED' | 'DRAFT' | 'FINALIZED';
export const stoneReturnAllocationStatuses = {
  REJECTED: { label: 'رد کامل', tone: 'neutral' },
  RECEIVED: { label: 'در انتظار تخصیص', tone: 'warning' },
  DRAFT: { label: 'پیش‌نویس تخصیص', tone: 'info' },
  FINALIZED: { label: 'ثبت قطعی', tone: 'success' },
} as const;

export type StoneReturnReceipt = {
  allocationStatus?: StoneReturnAllocationStatus;
  id: string;
  customerId: string;
  customerName: string;
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  receivedQuantity: string;
  acceptedQuantity: string;
  rejectedQuantity: string;
  rejectionReason: string | null;
  guardReturnMovementId: string | null;
  inventoryIdentityId: string | null;
  createdAt: string;
};

export type StoneReturnSourceKey = {
  originalInvoiceId: string;
  originalLineId: string;
  dispatchEvidenceId: string;
};

export type StoneReturnAllocationInput = StoneReturnSourceKey & { quantity: string };

export type StoneReturnCandidate = StoneReturnSourceKey & {
  originalInvoiceNumber: string;
  contractNumber: string;
  loadingId: string;
  loadingNumber: string | null;
  deliveredAt: string;
  unit: string;
  originalNetRateRials: string;
  deliveredQuantity: string;
  linePriorReturnedQuantity: string;
  dispatchPriorReturnedQuantity: string;
  lineRemainingQuantity: string;
  dispatchRemainingQuantity: string;
  remainingQuantity: string;
};

export type StoneReturnDraftRow = StoneReturnAllocationInput & { id: string; originalInvoiceNumber: string; contractNumber: string };
export type StoneReturnReview = {
  receipt: StoneReturnReceipt;
  originKnown: boolean;
  blockedReason: string | null;
  hasUnlinkedOriginals: boolean;
  allocationStatus: StoneReturnAllocationStatus;
  candidates: StoneReturnCandidate[];
  draft: { id: string; version: number; attributionReason: string | null; createdAt: string; rows: StoneReturnDraftRow[] } | null;
  allocatedQuantity: string;
  unallocatedQuantity: string;
  canAllocate: boolean;
  finalization: StoneReturnFinalization | null;
};

export type StoneReturnFinalization = {
  id: string;
  draftVersion: number;
  finalizedAt: string;
  documentDate: string;
  summary: {
    inventoryIdentityId: string;
    receiptEventId: string;
    receiptEvidenceHash: string;
    credits: Array<{
      originalInvoiceId: string;
      originalInvoiceNumber: string;
      creditInvoiceId: string;
      creditNumber: string;
      voucherId: string;
      voucherNumber: number | null;
      openItemId: string;
      taxInvoiceId: string;
      customerCreditRials: string;
      shares: Array<{
        draftRowId: string;
        shipmentReturnEvidenceId: string;
        valuationLayerId: string;
        quantity: string;
        originalNetRials: string;
        originalTaxRials: string;
        costRials: string;
      }>;
    }>;
  };
};

export type StoneReturnPostingContext = {
  draftVersion: number;
  book: { id: string; namePersian: string };
  periods: Array<{ id: string; titlePersian: string; fiscalYear: { titlePersian: string } }>;
  rules: Array<{ id: string; code: string; version: number }>;
};

export type StoneReturnOption = { id: string; label: string; description?: string | null };
type Envelope<T> = { success: true; data: T };
type ReceiptPage = { items: StoneReturnReceipt[]; nextCursor: string | null; canRecord?: boolean };
type StoneReturnIntake = {
  requestId: string; customerId: string; productId: string; unit: string;
  receivedQuantity: string; acceptedQuantity: string; rejectionReason: string;
  guardReturnMovementId: string | null;
};

const logistics = '/logistics/stone-returns';
const accounting = '/accounting/stone-returns';
const reviewUrl = (id: string) => `${accounting}/${encodeURIComponent(id)}`;

export const stoneReturnApi = {
  list: async (workspace: 'logistics' | 'accounting', after?: string) =>
    (await api.get<Envelope<ReceiptPage>>(`/${workspace}/stone-returns`, { params: { after } })).data.data,
  review: async (id: string) => (await api.get<Envelope<StoneReturnReview>>(reviewUrl(id))).data.data,
  saveAllocations: async (id: string, command: { expectedVersion: number; rows: StoneReturnAllocationInput[]; attributionReason: string }) =>
    (await api.put<Envelope<StoneReturnReview>>(`${reviewUrl(id)}/allocations`, command)).data.data,
  postingContext: async (id: string, date: string) =>
    (await api.get<Envelope<StoneReturnPostingContext>>(`${reviewUrl(id)}/posting-context`, { params: { date } })).data.data,
  finalize: async (id: string, command: {
    expectedVersion: number; requestId: string; date: string; periodId: string; postingRuleId: string; confirmed: true;
  }) => (await api.post<Envelope<{ data: StoneReturnFinalization; replayed: boolean }>>(`${reviewUrl(id)}/finalize`, command)).data.data,
  customers: async (search: string) =>
    (await api.get<Envelope<StoneReturnOption[]>>(`${logistics}/customers`, { params: { search } })).data.data,
  products: async (search: string) =>
    (await api.get<Envelope<StoneReturnOption[]>>(`${logistics}/products`, { params: { search } })).data.data,
  guard: async (customerId: string, search: string): Promise<StoneReturnOption[]> => {
    const response = await api.get<Envelope<{ id: string; movementNumber: string; occurredAt: string }[]>>(
      `${logistics}/guard-movements`, { params: { customerId, search } },
    );
    return response.data.data.map(row => ({
      id: row.id, label: row.movementNumber, description: new Date(row.occurredAt).toLocaleDateString('fa-IR'),
    }));
  },
  record: async (command: StoneReturnIntake) =>
    (await api.post<Envelope<{ data: StoneReturnReceipt; replayed: boolean }>>(logistics, command)).data.data,
};

/** Keeps all persisted decimal digits when displaying exact quantity. */
export function displayExactDecimal(quantity: string) {
  const [integer, decimals] = quantity.split('.');
  const fraction = decimals?.replace(/0+$/, '');
  const tail = fraction ? '٫' + Array.from(fraction, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]).join('') : '';
  return `${BigInt(integer).toLocaleString('fa-IR')}${tail}`;
}

export function displayStoneReturnQuantity(quantity: string, unit: string) {
  return `${displayExactDecimal(quantity)} ${stoneReturnUnitLabels[unit] ?? unit}`;
}
