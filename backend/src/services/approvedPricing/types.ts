import type { AccountingRecordStatus, ApprovedPricingVersionOrigin, FinancialRecordKind } from '@prisma/client';

export const APPROVED_PRICING_SCHEMA_VERSION = 1;

export type ApprovalLeaf = {
  id: string;
  contractId: string | null;
  kind: FinancialRecordKind;
  status: AccountingRecordStatus;
  financiallyApprovedAt: Date | null;
  financiallyApprovedBy: string | null;
  amount: string;
  currency: string;
  sourceId: string | null;
  sourceSnapshot: unknown;
  metadata: unknown;
  invoiceItems: readonly {
    id: string;
    contractItemId: string | null;
    productId: string | null;
    quantity: string;
    totalPrice: string;
  }[];
};

export type ApprovedPricingOperationSource = {
  id: string;
  kind: 'tool' | 'finishing';
  amountToman: string;
};

export type ApprovedPricingGraphRowSource = {
  productRowId: string;
  catalogProductId: string;
  contractualTitle: string;
  productType: string;
  baseAmountToman: string | null;
  totalAmountToman: string | null;
  requestedQuantity: string | null;
  requestedLengthMeters: string | null;
  requestedAreaSquareMeters: string | null;
  operations: readonly ApprovedPricingOperationSource[];
};

export type ApprovedPricingSource = {
  leaf: ApprovalLeaf;
  contract: {
    id: string;
    contractNumber: string;
    customerId: string;
    currency: string | null;
    contractData: unknown;
    items: readonly {
      id: string;
      productId: string;
      productRowId: string | null;
      productType: string | null;
      quantity: string;
      totalPrice: string;
    }[];
    currentItems: readonly {
      id: string;
      productId: string;
      productRowId: string | null;
      productType: string | null;
      quantity: string;
      totalPrice: string;
    }[];
    productGraph: {
      schemaVersion: number;
      revision: number;
      inputHash: string;
      resultHash: string;
      totalAmountToman: string;
      rows: readonly ApprovedPricingGraphRowSource[];
    } | null;
  };
};

export type ApprovedPricingRowInsert = {
  id: string;
  contractItemId: string;
  productRowId: string;
  ordinal: number;
  contractedQuantity: string;
  unit: string;
  canonicalAllInTotal: string;
  discountEligible: boolean;
  componentEvidence: Readonly<Record<string, string>>;
  integrityHash: string;
};

export type ApprovedPricingVersionInsert = {
  id: string;
  contractId: string;
  versionNumber: number;
  sourceFinancialRecordId: string;
  approvedAt: Date;
  approvedBy: string;
  schemaVersion: number;
  currency: string;
  grossAmount: string;
  discountAmount: string;
  netAmount: string;
  sourceEvidence: Readonly<Record<string, unknown>>;
  integrityHash: string;
  rows: readonly ApprovedPricingRowInsert[];
};

export type ApprovedPricingVersionRecord = ApprovedPricingVersionInsert;

export type ApprovedPricingPersistenceContext = {
  origin: ApprovedPricingVersionOrigin;
  legacySourceReference?: Readonly<Record<string, unknown>> | null;
};

export type ApprovedPricingSealResult = {
  outcome: 'SEALED' | 'REPLAYED';
  version: ApprovedPricingVersionRecord;
};

export interface ApprovedPricingRepository {
  readApprovalLeaf(financialRecordId: string): Promise<ApprovalLeaf | null>;
  withContractLock<T>(contractId: string, work: () => Promise<T>): Promise<T>;
  findByApproval(contractId: string, financialRecordId: string): Promise<ApprovedPricingVersionRecord | null>;
  loadSource(financialRecordId: string): Promise<ApprovedPricingSource | null>;
  nextVersionNumber(contractId: string): Promise<number>;
  insertAndAdvance(version: ApprovedPricingVersionInsert, context?: ApprovedPricingPersistenceContext): Promise<ApprovedPricingVersionRecord>;
}
