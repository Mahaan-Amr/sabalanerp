import api from '@/lib/api';
import type { ProjectReturnItem, ProjectReturnOperationalState, ProjectReturnReceipt } from './projectReturnReceiptApi';
import type { StoneReturnAllocationInput, StoneReturnCandidate } from './stoneReturnApi';

export type ProjectReturnAllocationStatus = 'RECEIVED' | 'DRAFT' | 'ALLOCATION_COMPLETE' | 'DAMAGED_ONLY' | 'CORRECTION_WITH_LOGISTICS'
  | 'REWORK_REQUESTED' | 'RETURNED_TO_LOGISTICS' | 'CANCELLED';
export const projectReturnAllocationStatuses = {
  RECEIVED: { label: 'در انتظار رسیدگی', tone: 'info' },
  DRAFT: { label: 'پیش‌نویس تخصیص', tone: 'warning' },
  ALLOCATION_COMPLETE: { label: 'تخصیص کامل', tone: 'success' },
  CORRECTION_WITH_LOGISTICS: { label: 'اصلاح نزد لجستیک', tone: 'warning' },
  DAMAGED_ONLY: { label: 'فقط آسیب‌دیده', tone: 'neutral' },
  REWORK_REQUESTED: { label: 'درخواست بررسی وابستگی‌ها', tone: 'warning' },
  RETURNED_TO_LOGISTICS: { label: 'ارجاع‌شده به لجستیک', tone: 'info' },
  CANCELLED: { label: 'لغوشده', tone: 'neutral' },
} as const;

export function isProjectReturnAllocationEditable(status: ProjectReturnAllocationStatus) {
  return status === 'RECEIVED' || status === 'DRAFT' || status === 'ALLOCATION_COMPLETE';
}

export type ProjectFinancialAllocationSource = { financialRecordId: string; financialLineId: string };
type ProjectAllocationRow = StoneReturnAllocationInput | ProjectFinancialAllocationSource & { quantity: string };
type FinancialCandidate = ProjectFinancialAllocationSource & {
  dispatchEvidenceId: null;
  originalInvoiceNumber: string;
  originalNetRateRials: string | null;
  remainingQuantity: string;
  contractNumber: string;
  financialParty: { kind: 'CUSTOMER' | 'PARTNER'; id: string };
};
export type ProjectAllocationCandidate = (StoneReturnCandidate | FinancialCandidate) & {
  projectId: string;
  draftRemainingQuantity: string;
  contractDate?: string | null;
  contractCreatedAt?: string;
  sellerName?: string | null;
  replacementCapacity?: { ownQuantity: string; lineRemainingQuantity: string; dispatchRemainingQuantity: string };
};
export type ProjectReturnRateBasis = 'RECEIPT_UNIT' | 'HEALTHY_SQUARE_METER';

export type ProjectAllocationInput = {
  itemId: string;
  agreedUnitRateRials: string | null;
  agreedRateBasis: ProjectReturnRateBasis;
  rows: ProjectAllocationRow[];
};

export type ProjectReturnPriorPosting = {
  finalizationId: string;
  finalizedAt: string;
  agreedUnitRateRials: string;
  creditRials: string;
  projectAttributionKnown: boolean;
  sourceChanged: boolean;
  receipt: { id: string; productName: string; unit: string; acceptedQuantity: string; rejectedQuantity: string };
  rows: Array<{ id: string; quantity: string; originalInvoiceNumber: string; contractNumber: string; projectName: string | null }>;
  credits: Array<{
    creditInvoiceId: string; creditNumber: string; voucherId: string; voucherNumber: number | null; availableRials: string;
    customerCreditRials: string; usedRials: string; voucherStatus: string;
    taxDocument: { id: string; serial: string; status: string };
  }>;
};

export type ProjectReturnAllocationReview = {
  receipt: ProjectReturnReceipt;
  items: Array<ProjectReturnItem & {
    candidates: ProjectAllocationCandidate[];
    hasUnlinkedOriginals: boolean;
    blockedReason?: string | null;
    agreedUnitRateRials: string | null;
    agreedRateBasis: ProjectReturnRateBasis | null;
    legacyRateNeedsReview: boolean;
    draftAmountRials: string | null;
    rows: Array<ProjectAllocationRow & { originalInvoiceNumber: string; contractNumber: string }>;
    allocationError: string | null;
    allocatedQuantity: string;
    unallocatedQuantity: string;
  }>;
  prior: ProjectReturnPriorPosting | null;
  correctionBlocks: Array<{ code: string; message: string }>;
  draft: { number: number; createdAt: string } | null;
  allocationStatus: ProjectReturnAllocationStatus;
  postingBlock: { code: string; message: string };
  canAllocate: boolean;
  operational?: ProjectReturnOperationalState | null;
};

type AllocationList = {
  items: Array<ProjectReturnReceipt & { allocationStatus: ProjectReturnAllocationStatus }>;
  nextCursor: string | null;
  canAllocate: boolean;
};
type Envelope<T> = { data: T };

const path = '/accounting/project-returns';
export const projectReturnAccountingHref = '/dashboard/accounting/returns';
export const projectReturnHistoryHref = `${projectReturnAccountingHref}/history`;
export const projectReturnReviewHref = (id: string) => `${projectReturnAccountingHref}/project/${encodeURIComponent(id)}`;

export const projectReturnAllocationApi = {
  list: async (after?: string) =>
    (await api.get<Envelope<AllocationList>>(path, { params: { after } })).data.data,
  review: async (id: string) =>
    (await api.get<Envelope<ProjectReturnAllocationReview>>(`${path}/${encodeURIComponent(id)}`)).data.data,
  openCorrection: async (legacyReceiptId: string) =>
    (await api.post<Envelope<{ id: string }>>(`${path}/legacy/${encodeURIComponent(legacyReceiptId)}/correction`, {})).data.data,
  returnCorrection: async (id: string, input: { expectedVersionId: string; expectedDraftNumber: number }) =>
    (await api.post<Envelope<{ id: string }>>(`${path}/${encodeURIComponent(id)}/correction/return`, input)).data.data,
  returnToLogistics: async (id: string, expectedVersionId: string) =>
    (await api.post<Envelope<ProjectReturnAllocationReview>>(`${path}/${encodeURIComponent(id)}/return-to-logistics`, { expectedVersionId })).data.data,
  save: async (id: string, input: { expectedVersionId: string; expectedDraftNumber: number; items: ProjectAllocationInput[] }) =>
    (await api.put<Envelope<ProjectReturnAllocationReview>>(`${path}/${encodeURIComponent(id)}/allocations`, input)).data.data,
};
