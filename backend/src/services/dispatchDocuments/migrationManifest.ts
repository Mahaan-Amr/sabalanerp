import type { CanonicalQuantity, ExactMoney } from './contracts';

export const SHIPMENT_STATEMENT_MIGRATION_NAME = '20260809000100_shipment_statement_data_contracts' as const;
export const SHIPMENT_STATEMENT_SCHEMA_VERSION = 1 as const;

export const SHIPMENT_STATEMENT_PRESERVATION_SCOPES = [
  'sales_contracts',
  'contract_items',
  'accounting_financial_records',
  'logistics_allocation_revisions',
  'logistics_allocation_revision_lines',
  'accounting_dispatch_waybills',
  'dispatch_corrections',
  'dispatch_lifecycle_audits',
] as const;

export type ShipmentStatementPreservationScope =
  (typeof SHIPMENT_STATEMENT_PRESERVATION_SCOPES)[number];

export type MigrationEvidenceSnapshot = {
  scope: ShipmentStatementPreservationScope;
  recordCount: string;
  identityHash: string;
  quantityTotal: CanonicalQuantity | null;
  amountTotal: ExactMoney | null;
  evidenceHash: string;
};

export type MigrationEvidenceComparison = {
  scope: ShipmentStatementPreservationScope;
  before: MigrationEvidenceSnapshot;
  after: MigrationEvidenceSnapshot;
  matched: boolean;
  differences: Array<'RECORD_COUNT' | 'IDENTITY_HASH' | 'QUANTITY_TOTAL' | 'AMOUNT_TOTAL' | 'EVIDENCE_HASH'>;
};

export const compareMigrationEvidence = (
  before: MigrationEvidenceSnapshot,
  after: MigrationEvidenceSnapshot,
): MigrationEvidenceComparison => {
  if (before.scope !== after.scope) {
    throw new Error('Migration evidence scopes must match.');
  }

  const differences: MigrationEvidenceComparison['differences'] = [];
  if (before.recordCount !== after.recordCount) differences.push('RECORD_COUNT');
  if (before.identityHash !== after.identityHash) differences.push('IDENTITY_HASH');
  if (before.quantityTotal !== after.quantityTotal) differences.push('QUANTITY_TOTAL');
  if (before.amountTotal !== after.amountTotal) differences.push('AMOUNT_TOTAL');
  if (before.evidenceHash !== after.evidenceHash) differences.push('EVIDENCE_HASH');

  return { scope: before.scope, before, after, matched: differences.length === 0, differences };
};
