import { randomUUID } from 'node:crypto';
import { ApprovedPricingVersionOrigin, Prisma, type PrismaClient } from '@prisma/client';
import {
  APPROVED_PRICING_SCHEMA_VERSION,
  approvedPricingRowIntegrityHash,
  approvedPricingVersionIntegrityHash,
  type ApprovedPricingPersistenceContext,
  type ApprovedPricingRepository,
  type ApprovedPricingVersionInsert,
} from '../approvedPricing';
import { PrismaApprovedPricingRepository } from '../approvedPricing/prismaRepository';
import { classifyLegacyPricingCandidate, type LegacyPricingSealCommand, type LegacyPricingSealWriter } from './index';
import { isCompleteValidApprovalLeaf } from './approvalLeaf';
import { buildLegacyPricingCandidate, type LegacyPricingSourceInput } from './source';

export interface LegacyApprovedPricingWriterRepository extends ApprovedPricingRepository {
  loadLegacyPricingRevalidationSource(contractId: string): Promise<Omit<LegacyPricingSourceInput, 'review'> | null>;
  readPersistenceContext(contractId: string, financialRecordId: string): Promise<{
    origin: ApprovedPricingVersionOrigin;
    legacySourceReference: unknown;
  } | null>;
}

export class PrismaLegacyApprovedPricingRepository extends PrismaApprovedPricingRepository implements LegacyApprovedPricingWriterRepository {
  constructor(private readonly legacyTx: Prisma.TransactionClient) { super(legacyTx); }

  async loadLegacyPricingRevalidationSource(contractId: string) {
    const contract = await this.legacyTx.salesContract.findUnique({
      where: { id: contractId },
      include: {
        items: { orderBy: { id: 'asc' } },
        productGraphState: true,
        approvedPricingVersions: {
          where: { origin: ApprovedPricingVersionOrigin.LEGACY_SEAL },
          select: { id: true, sourceFinancialRecordId: true, legacySourceReference: true },
        },
      },
    });
    if (!contract || contract.productGraphState) return null;
    const financialRecords = await this.legacyTx.accountingFinancialRecord.findMany({
      where: { contractId, kind: 'INVOICE_CANDIDATE' },
      include: { invoiceItems: { orderBy: { id: 'asc' } } },
      orderBy: [{ financiallyApprovedAt: 'desc' }, { id: 'asc' }],
    });
    const records = financialRecords.map(leaf => ({
      id: leaf.id,
      kind: leaf.kind,
      status: leaf.status,
      approvedAt: leaf.financiallyApprovedAt?.toISOString() ?? null,
      approvedBy: leaf.financiallyApprovedBy,
      currency: leaf.currency,
      customerId: leaf.customerId,
      amount: leaf.amount.toFixed(12),
      sourceId: leaf.sourceId,
      sourceSnapshot: leaf.sourceSnapshot,
      metadata: leaf.metadata,
      invoiceItems: leaf.invoiceItems.map(item => ({
        contractItemId: item.contractItemId,
        productId: item.productId,
        quantity: item.quantity.toFixed(3),
        totalPrice: item.totalPrice.toFixed(12),
      })),
    }));
    const selectedId = records.find(leaf => leaf.kind === 'INVOICE_CANDIDATE'
      && ['ISSUED', 'POSTED'].includes(leaf.status)
      && leaf.approvedAt && leaf.approvedBy)?.id ?? records[0]?.id ?? '';
    const existing = contract.approvedPricingVersions.find(version => version.sourceFinancialRecordId === selectedId);
    const reference = record(existing?.legacySourceReference);
    return {
      contract: {
        id: contract.id,
        currency: contract.currency,
        customerId: contract.customerId,
        items: contract.items.map(item => ({
          id: item.id,
          productId: item.productId,
          productRowId: item.productRowId,
          productType: item.productType,
          quantity: item.quantity.toFixed(3),
          totalPrice: item.totalPrice.toFixed(12),
        })),
      },
      financialRecords: records,
      existingSeal: existing && typeof reference.sourceEvidenceHash === 'string'
        ? { pricingVersionId: existing.id, sourceEvidenceHash: reference.sourceEvidenceHash }
        : null,
    };
  }
}

type IdFactory = { version: () => string; row: () => string };
const defaultIds: IdFactory = { version: () => randomUUID(), row: () => randomUUID() };
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export const sealLegacyPricingWithApprovedPricingRepository = async (
  repository: LegacyApprovedPricingWriterRepository,
  command: LegacyPricingSealCommand,
  ids: IdFactory = defaultIds,
) => {
  const classification = classifyLegacyPricingCandidate(command.candidate);
  if (classification.status !== 'READY' || !command.candidate.review) throw new Error('Legacy pricing evidence is not READY for sealing.');
  if (command.sourceReference.contractId !== command.candidate.contractId
    || command.sourceReference.sourceFinancialRecordId !== command.candidate.sourceFinancialRecordId
    || command.sourceReference.sourceIdentityHash !== command.candidate.sourceIdentityHash
    || command.sourceReference.sourceEvidenceHash !== command.candidate.sourceEvidenceHash
    || command.review.sourceEvidenceHash !== command.candidate.sourceEvidenceHash) {
    throw new Error('Legacy pricing seal command does not match its preflight evidence.');
  }
  return repository.withContractLock(command.candidate.contractId, async () => {
    const source = await repository.loadLegacyPricingRevalidationSource(command.candidate.contractId);
    if (!source) throw new Error('Legacy pricing source disappeared or is no longer in the legacy cohort.');
    const refreshedCandidate = buildLegacyPricingCandidate({ ...source, review: command.review });
    const refreshedClassification = classifyLegacyPricingCandidate(refreshedCandidate);
    if (refreshedCandidate.sourceEvidenceHash !== command.review.sourceEvidenceHash
      || refreshedCandidate.sourceEvidenceHash !== command.sourceReference.sourceEvidenceHash
      || refreshedCandidate.sourceIdentityHash !== command.sourceReference.sourceIdentityHash
      || refreshedCandidate.sourceFinancialRecordId !== command.sourceReference.sourceFinancialRecordId
      || refreshedClassification.status !== 'READY') {
      throw new Error('Legacy pricing source evidence changed after preflight.');
    }
    const leaf = await repository.readApprovalLeaf(command.candidate.sourceFinancialRecordId);
    const preflightLeaf = leaf ? refreshedCandidate.approvalLeaves.find(item => item.id === leaf.id) : null;
    if (!leaf || !preflightLeaf || !isCompleteValidApprovalLeaf({
      kind: leaf.kind,
      status: leaf.status,
      approvedAt: leaf.financiallyApprovedAt?.toISOString() ?? null,
      approvedBy: leaf.financiallyApprovedBy,
    }) || leaf.contractId !== command.candidate.contractId
      || leaf.kind !== preflightLeaf.kind || leaf.status !== preflightLeaf.status
      || leaf.financiallyApprovedAt?.toISOString() !== preflightLeaf.approvedAt
      || leaf.financiallyApprovedBy !== preflightLeaf.approvedBy) {
      throw new Error('Legacy pricing approval evidence changed after preflight.');
    }
    const existing = await repository.findByApproval(command.candidate.contractId, command.candidate.sourceFinancialRecordId);
    if (existing) {
      const context = await repository.readPersistenceContext(command.candidate.contractId, command.candidate.sourceFinancialRecordId);
      const reference = record(context?.legacySourceReference);
      if (context?.origin !== ApprovedPricingVersionOrigin.LEGACY_SEAL || reference.sourceEvidenceHash !== command.sourceReference.sourceEvidenceHash) {
        throw new Error('Existing approved pricing version conflicts with the legacy seal command.');
      }
      return { outcome: 'REPLAYED' as const, pricingVersionId: existing.id };
    }
    const versionNumber = await repository.nextVersionNumber(command.candidate.contractId);
    const versionId = ids.version();
    const approvedAt = new Date(command.candidate.approvalLeaves.find(item => item.id === leaf.id)!.approvedAt!);
    const rows = command.candidate.rows.map((row, ordinal) => {
      if (!row.relationalProductRowId || !row.quantity || !row.unit || !row.canonicalAllInTotal
        || row.discountEligible == null || !row.componentEvidence
        || Object.values(row.componentEvidence).some(value => value == null)) {
        throw new Error('READY legacy pricing row lost required evidence before persistence.');
      }
      const rowPayload = {
        versionId,
        contractId: command.candidate.contractId,
        sourceFinancialRecordId: command.candidate.sourceFinancialRecordId,
        versionNumber,
        contractItemId: row.contractItemId,
        productRowId: row.relationalProductRowId,
        ordinal,
        contractedQuantity: row.quantity,
        unit: row.unit,
        canonicalAllInTotal: row.canonicalAllInTotal,
        discountEligible: row.discountEligible,
        componentEvidence: row.componentEvidence as Readonly<Record<string, string>>,
      };
      return { id: ids.row(), ...rowPayload, integrityHash: approvedPricingRowIntegrityHash(rowPayload) };
    });
    const sourceEvidence = {
      origin: 'LEGACY_SEAL',
      sourceReference: command.sourceReference,
      review: command.review,
      customerId: command.candidate.customerId,
      projectId: command.candidate.projectId,
      destination: command.candidate.destination,
      discount: command.candidate.discount,
      rowSnapshotHashes: command.candidate.rows.map(row => ({ contractItemId: row.contractItemId, snapshotHash: row.snapshotHash })),
    };
    const rootPayload = {
      id: versionId,
      contractId: command.candidate.contractId,
      versionNumber,
      sourceFinancialRecordId: command.candidate.sourceFinancialRecordId,
      approvedAt,
      approvedBy: leaf.financiallyApprovedBy!,
      schemaVersion: APPROVED_PRICING_SCHEMA_VERSION,
      currency: command.candidate.currency!,
      grossAmount: command.candidate.grossAmount!,
      discountAmount: command.candidate.discountAmount!,
      netAmount: command.candidate.netAmount!,
      sourceEvidence,
      rowHashes: rows.map(row => row.integrityHash),
    };
    const { rowHashes: _rowHashes, ...versionFields } = rootPayload;
    const version: ApprovedPricingVersionInsert = {
      ...versionFields,
      rows,
      integrityHash: approvedPricingVersionIntegrityHash(rootPayload),
    };
    const context: ApprovedPricingPersistenceContext = {
      origin: ApprovedPricingVersionOrigin.LEGACY_SEAL,
      legacySourceReference: { ...command.sourceReference, review: command.review },
    };
    const persisted = await repository.insertAndAdvance(version, context);
    return { outcome: 'SEALED' as const, pricingVersionId: persisted.id };
  });
};

export const createPrismaLegacyPricingSealWriter = (prisma: PrismaClient): LegacyPricingSealWriter => ({
  seal: command => prisma.$transaction(
    tx => sealLegacyPricingWithApprovedPricingRepository(new PrismaLegacyApprovedPricingRepository(tx), command),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 120_000 },
  ),
});
