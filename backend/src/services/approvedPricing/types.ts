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

export type ApprovedPricingComponentSource = {
  id: string;
  kind: string;
  amountToman: string;
};

export type ApprovedPricingGraphRowSource = {
  productRowId: string;
  catalogProductId: string;
  contractualTitle: string;
  productType: string;
  baseAmountToman: string | null;
  totalAmountToman: string | null;
  legacyRawTotalAmountToman?: string | null;
  requestedQuantity: string | null;
  requestedLengthMeters: string | null;
  requestedAreaSquareMeters: string | null;
  pricingComponents?: readonly ApprovedPricingComponentSource[];
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
      roundingPolicy: string;
      revision: number;
      inputHash: string;
      resultHash: string;
      totalAmountToman: string;
      quantityPolicyProvenance: {
        producer: 'LEGACY_MIGRATION' | 'CANONICAL_WIZARD_SAVE';
        producerVersion: 0 | 1;
        graphAuditCommandId: string;
      } | null;
      compatibility?: {
        evidenceOrigin:
          | 'POST_SNAPSHOT_DETERMINISTIC_LEGACY_GRAPH_MIGRATION'
          | 'POST_SNAPSHOT_DETERMINISTIC_CANONICAL_GRAPH_BINDING'
          | 'GRAPH_V1_LEGACY_SNAPSHOT_RECONSTRUCTION';
        migrationAuditCommandId?: string;
        snapshotOriginallyMissing: boolean;
        rowIdentityAssignments?: readonly {
          contractItemId: string;
          productRowId: string;
          rawContractItemProductRowId: string | null;
          rawProductSnapshotRowId: string | null;
          rule:
            | 'MIGRATED_GRAPH_ORDINAL_PRODUCT_IDENTITY_V1'
            | 'FROZEN_ITEM_AND_PRODUCT_UNIQUE_COMMERCIAL_TUPLE_V1';
        }[];
        monetaryNormalizations?: readonly {
          productRowId: string;
          rawTotalAmountToman: string;
          sealedTotalAmountToman: string;
          difference: string;
          rule: 'LEGACY_GRAPH_V1_ROUND_HALF_UP_TOMAN';
          componentConversions?: readonly {
            component: 'cutting';
            rawValue: string;
            duplicatedToolValue: string;
            sealedValue: string;
            difference: string;
            rule: 'LEGACY_STAIR_V1_CUTTING_PHYSICAL_AND_TOOL_LINES';
          }[];
        }[];
        legacyQuantityNormalizations?: readonly {
          productRowId: string;
          productType: string;
          rawValue: string;
          sealedValue: string;
          unit: string;
          rule: 'LEGACY_GRAPH_V1_ROUND_HALF_UP_SCALE_THREE';
        }[];
        discountEligibilityAssignments?: readonly {
          productRowId: string;
          rawIsLayer: null;
          sealedIsLayer: false;
          rule: 'LEGACY_GRAPH_V1_EMPTY_LAYER_CONFIGURATION_NON_LAYER';
        }[];
        recoveredAccountingRows?: readonly {
          contractItemId: string;
          invoiceItemId: string;
          productRowId: string;
          rule: 'FROZEN_GRAPH_ROW_ACCOUNTING_EVIDENCE_V1';
        }[];
        recoveredInvoiceAmount?: {
          rawFinancialRecordAmount: string;
          sealedContractTotal: string;
          recoveredInvoiceAmount: string;
          currencyFactor: string;
          rule: 'ZERO_SENTINEL_FROM_FROZEN_CONTRACT_TOTAL_V1';
        };
        liveContractItemRebindings?: readonly {
          sourceContractItemId: string;
          linkedContractItemId: string;
          invoiceItemId: string;
          productRowId: string;
          rule: 'FROZEN_STABLE_PRODUCT_ROW_LIVE_ITEM_REBINDING_V1';
        }[];
      };
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
