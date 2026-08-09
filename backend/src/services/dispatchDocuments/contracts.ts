export const DISPATCH_DOCUMENT_KINDS = [
  'WAYBILL',
  'STATEMENT',
  'STATEMENT_ADJUSTMENT',
] as const;
export type DispatchDocumentKind = (typeof DISPATCH_DOCUMENT_KINDS)[number];

export const PRICING_READINESS_STATUSES = ['READY', 'BLOCKED', 'QUARANTINED'] as const;
export type PricingReadinessStatus = (typeof PRICING_READINESS_STATUSES)[number];

export const PRICING_READINESS_REASON_CODES = [
  'MISSING_FINANCIAL_APPROVAL',
  'MISSING_STABLE_ROW_IDENTITY',
  'MISSING_CURRENCY',
  'MISSING_CONTRACTED_QUANTITY',
  'MISSING_CANONICAL_ROW_TOTAL',
  'MISSING_DISCOUNT_EVIDENCE',
  'ROW_IDENTITY_CONFLICT',
  'CURRENCY_CONFLICT',
  'SOURCE_HASH_MISMATCH',
  'SOURCE_EVIDENCE_INCOMPLETE',
] as const;
export type PricingReadinessReasonCode = (typeof PRICING_READINESS_REASON_CODES)[number];

export const MIGRATION_RUN_STATUSES = ['STARTED', 'COMPLETED', 'FAILED'] as const;
export type MigrationRunStatus = (typeof MIGRATION_RUN_STATUSES)[number];

export const DISPATCH_DOCUMENT_COMMAND_SCOPES = [
  'CANDIDATE',
  'WAYBILL',
  'CORRECTION',
  'PRINT_HANDOFF',
] as const;
export type DispatchDocumentCommandScope = (typeof DISPATCH_DOCUMENT_COMMAND_SCOPES)[number];

export type CanonicalQuantity = string;
export type ExactMoney = string;

export type ShipmentMoneyAllocation = {
  grossAmount: ExactMoney;
  allocatedDiscount: ExactMoney;
  netAmount: ExactMoney;
};

export type ShipmentMoneyAllocationDelta = {
  grossAmountDelta: ExactMoney;
  discountDelta: ExactMoney;
  netAmountDelta: ExactMoney;
};

export type DispatchDocumentLine = {
  contractItemId: string;
  productRowId: string;
  label: string;
  unit: string;
  quantity: CanonicalQuantity;
};

export type DispatchDocumentContractGroup = {
  contractId: string;
  contractNumber: string;
  lines: DispatchDocumentLine[];
};

export type DispatchDocumentRenderBase = {
  schemaVersion: 1;
  documentId: string;
  waybillNumber: string;
  issuedAt: string;
  customerName: string;
  projectOrDestination: string;
  vehiclePlate: string;
  templateVersion: string;
};

export type WaybillRenderInput = DispatchDocumentRenderBase & {
  kind: 'WAYBILL';
  payload: {
    allocationRevisionId: string;
    contracts: DispatchDocumentContractGroup[];
  };
};

export type StatementRenderLine = DispatchDocumentLine & ShipmentMoneyAllocation;

export type StatementRenderInput = DispatchDocumentRenderBase & {
  kind: 'STATEMENT';
  payload: {
    currency: string;
    contracts: Array<{
      contractId: string;
      contractNumber: string;
      lines: StatementRenderLine[];
    } & ShipmentMoneyAllocation>;
  } & ShipmentMoneyAllocation;
};

export type StatementAdjustmentRenderInput = DispatchDocumentRenderBase & {
  kind: 'STATEMENT_ADJUSTMENT';
  payload: {
    sequence: number;
    originalStatementDocumentId: string;
    reason: string;
    currency: string;
    lines: Array<{
      contractId: string;
      contractItemId: string;
      productRowId: string;
      label: string;
      unit: string;
      quantityDelta: CanonicalQuantity;
    } & ShipmentMoneyAllocationDelta>;
  } & ShipmentMoneyAllocationDelta;
};

export type DispatchDocumentRenderInput =
  | WaybillRenderInput
  | StatementRenderInput
  | StatementAdjustmentRenderInput;

export type ApprovedPricingRowContract = {
  contractItemId: string;
  productRowId: string;
  ordinal: number;
  contractedQuantity: CanonicalQuantity;
  unit: string;
  canonicalAllInTotal: ExactMoney;
  discountEligible: boolean;
  componentEvidence: Readonly<Record<string, ExactMoney>>;
  integrityHash: string;
};

export type ApprovedPricingVersionContract = {
  id: string;
  contractId: string;
  versionNumber: number;
  sourceFinancialRecordId: string;
  approvedAt: string;
  approvedBy: string;
  schemaVersion: number;
  currency: string;
  grossAmount: ExactMoney;
  discountAmount: ExactMoney;
  netAmount: ExactMoney;
  rows: ApprovedPricingRowContract[];
  integrityHash: string;
};

export type PricingReadinessContract = {
  status: PricingReadinessStatus;
  reasons: Array<{ code: PricingReadinessReasonCode; detail: Readonly<Record<string, unknown>> }>;
  sourceCount: number;
  sourceIdentityHash: string;
  quantityTotal: CanonicalQuantity | null;
  amountTotal: ExactMoney | null;
};

export type PublishedDispatchArtifact = {
  id: string;
  waybillId: string;
  kind: DispatchDocumentKind;
  adjustmentSequence: number | null;
  templateVersion: string;
  storageKey: string;
  mediaType: 'application/pdf';
  byteLength: number;
  sha256: string;
  publishedAt: string;
};

export type DispatchDocumentCommandIdentity =
  | { scope: 'CANDIDATE'; scopeId: string; waybillId: null }
  | { scope: 'WAYBILL'; scopeId: string; waybillId: string }
  | { scope: 'CORRECTION'; scopeId: string; waybillId: string }
  | { scope: 'PRINT_HANDOFF'; scopeId: string; waybillId: string };

export interface DispatchArtifactPublisher {
  publish(input: DispatchDocumentRenderInput): Promise<{
    bytes: Uint8Array;
    mediaType: 'application/pdf';
  }>;
}
