import { Prisma } from '@prisma/client';
import type { LockedApprovedPricingVersion } from '../pricedAllocationLedger';
import { approvedPricingRowIntegrityHash, approvedPricingVersionIntegrityHash } from './domain';

export const persistedApprovedPricingInclude = Prisma.validator<Prisma.ContractApprovedPricingVersionInclude>()({
  rows: { orderBy: [{ ordinal: 'asc' }, { id: 'asc' }] },
});

export type PersistedApprovedPricingVersion = Prisma.ContractApprovedPricingVersionGetPayload<{
  include: typeof persistedApprovedPricingInclude;
}>;
export type PersistedApprovedPricingRow = PersistedApprovedPricingVersion['rows'][number];

export const approvedPricingOperationalContractItemId = (
  row: { contractItemId: string; linkedContractItemId?: string | null },
) => row.linkedContractItemId ?? row.contractItemId;

export const approvedPricingJsonRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};

export const persistedApprovedPricingRowIntegrityMatches = (
  version: PersistedApprovedPricingVersion,
  row: PersistedApprovedPricingRow,
) => {
  try {
    return row.integrityHash === approvedPricingRowIntegrityHash({
      versionId: version.id,
      contractId: version.contractId,
      sourceFinancialRecordId: version.sourceFinancialRecordId,
      versionNumber: version.versionNumber,
      contractItemId: row.contractItemId,
      productRowId: row.productRowId,
      ordinal: row.ordinal,
      contractedQuantity: row.contractedQuantity.toFixed(3),
      unit: row.unit,
      canonicalAllInTotal: row.canonicalAllInTotal.toFixed(12),
      discountEligible: row.discountEligible,
      componentEvidence: approvedPricingJsonRecord(row.componentEvidence) as Readonly<Record<string, string>>,
    });
  } catch {
    return false;
  }
};

export const persistedApprovedPricingVersionIntegrityMatches = (version: PersistedApprovedPricingVersion) => {
  try {
    return version.integrityHash === approvedPricingVersionIntegrityHash({
      id: version.id,
      contractId: version.contractId,
      versionNumber: version.versionNumber,
      sourceFinancialRecordId: version.sourceFinancialRecordId,
      approvedAt: version.approvedAt,
      approvedBy: version.approvedBy,
      schemaVersion: version.schemaVersion,
      currency: version.currency,
      grossAmount: version.grossAmount.toFixed(12),
      discountAmount: version.discountAmount.toFixed(12),
      netAmount: version.netAmount.toFixed(12),
      sourceEvidence: approvedPricingJsonRecord(version.sourceEvidence),
      rowHashes: version.rows.map((row) => row.integrityHash),
    });
  } catch {
    return false;
  }
};

export const mapVerifiedApprovedPricingVersion = (
  version: PersistedApprovedPricingVersion,
  readinessEvidenceHash: string,
): LockedApprovedPricingVersion => {
  if (!persistedApprovedPricingVersionIntegrityMatches(version)
    || version.rows.some((row) => !persistedApprovedPricingRowIntegrityMatches(version, row))) {
    throw new Error(`Approved pricing ${version.id} failed immutable integrity verification.`);
  }
  return {
    id: version.id,
    contractId: version.contractId,
    versionNumber: version.versionNumber,
    sourceFinancialRecordId: version.sourceFinancialRecordId,
    approvedAt: version.approvedAt.toISOString(),
    approvedBy: version.approvedBy,
    schemaVersion: version.schemaVersion,
    currency: version.currency,
    grossAmount: version.grossAmount.toFixed(12),
    discountAmount: version.discountAmount.toFixed(12),
    netAmount: version.netAmount.toFixed(12),
    integrityHash: version.integrityHash,
    readinessEvidenceHash,
    rows: version.rows.map((row) => ({
      id: row.id,
      contractItemId: approvedPricingOperationalContractItemId(row),
      productRowId: row.productRowId,
      ordinal: row.ordinal,
      contractedQuantity: row.contractedQuantity.toFixed(3),
      unit: row.unit,
      canonicalAllInTotal: row.canonicalAllInTotal.toFixed(12),
      discountEligible: row.discountEligible,
      componentEvidence: approvedPricingJsonRecord(row.componentEvidence) as Readonly<Record<string, string>>,
      integrityHash: row.integrityHash,
    })),
  };
};
