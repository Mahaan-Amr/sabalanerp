import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { assessBoundAllocationPricingFreshness, readBoundPricedAllocation,
  type BoundPricedAllocationReadModel } from '../allocationPricingReadModel';
import type { DispatchDocumentSourceReader, DispatchSourceIntegrityVerifier, PrimaryBundleIdentity } from './ports';
import { DispatchDocumentConflictError, DispatchDocumentValidationError } from './service';

type Tx = Prisma.TransactionClient;
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)])) : value;
export const dispatchDocumentSourceIntegrityHash = (input: { allocationRevisionId: string; allocationIntegrityHash: string; pricedAllocation: BoundPricedAllocationReadModel }) =>
  createHash('sha256').update(JSON.stringify(stable(input))).digest('hex');

const sourceFrom = async (tx: Tx, candidateId: string, identity: PrimaryBundleIdentity, templateVersion: string, generatorVersion: string) => {
  const candidate = await tx.accountingDispatchCandidate.findUnique({ where: { id: candidateId }, include: {
    allocationRevision: { include: { lines: true } },
  } });
  if (!candidate) throw new DispatchDocumentValidationError('Accounting dispatch candidate was not found.');
  const pricedAllocation = await readBoundPricedAllocation(tx, candidate.allocationRevisionId);
  const revisionSnapshot = record(candidate.allocationRevision.snapshot);
  const loading = record(revisionSnapshot.loading);
  const customer = record(loading.customer);
  const project = record(loading.project);
  const queueTurn = record(revisionSnapshot.queueTurn);
  const admission = record(queueTurn.admissionSnapshot);
  const lineSnapshots = new Map(candidate.allocationRevision.lines.map(line => [line.id, record(line.snapshot)]));
  const contracts = new Map<string, { contractId: string; contractNumber: string; lines: any[] }>();
  for (const line of pricedAllocation.lines) {
    const sourceLine = candidate.allocationRevision.lines.find(item => item.id === line.allocationRevisionLineId);
    if (!sourceLine) throw new DispatchDocumentConflictError('Priced allocation line is absent from its allocation revision.');
    const snapshot = lineSnapshots.get(sourceLine.id) || {};
    const group = contracts.get(line.contractId) || { contractId: line.contractId,
      contractNumber: String(snapshot.contractNumber || line.contractId), lines: [] };
    group.lines.push({ contractItemId: line.contractItemId, productRowId: line.productRowId,
      label: String(snapshot.productName || snapshot.label || line.productRowId), unit: line.unit, quantity: line.quantity,
      grossAmount: line.grossAmount, allocatedDiscount: line.discountAmount, netAmount: line.netAmount });
    contracts.set(line.contractId, group);
  }
  const groups = [...contracts.values()].sort((left, right) => left.contractId.localeCompare(right.contractId));
  const base = { schemaVersion: 1 as const, waybillNumber: identity.number, issuedAt: identity.issuedAt,
    customerName: String(customer.companyName || customer.name || customer.id || ''),
    projectOrDestination: String(project.address || project.name || project.id || ''),
    vehiclePlate: String(admission.vehiclePlate || record(admission.vehicle).plate || ''), templateVersion };
  const sourceIntegrityHash = dispatchDocumentSourceIntegrityHash({ allocationRevisionId: candidate.allocationRevisionId,
    allocationIntegrityHash: candidate.allocationRevision.integrityHash, pricedAllocation });
  const sourceVersionIdentities = Object.fromEntries([
    ['allocationRevision', candidate.allocationRevisionId],
    ...pricedAllocation.pricingVersions.map(version => [`approvedPricing:${version.contractId}`, version.pricingVersionId]),
  ]);
  const provenance = { generatorVersion, templateVersion, sourceVersionIdentities,
    allocationRevisionId: candidate.allocationRevisionId,
    allocationIntegrityHash: candidate.allocationRevision.integrityHash, sourceIntegrityHash,
    pricingVersions: pricedAllocation.pricingVersions };
  return {
    candidateId: candidate.id, allocationRevisionId: candidate.allocationRevisionId, sourceIntegrityHash, pricedAllocation,
    provenance: { generatorVersion, sourceVersionIdentities },
    waybillSnapshot: { ...revisionSnapshot, documentProvenance: provenance },
    waybill: { ...base, kind: 'WAYBILL' as const, documentId: identity.waybillDocumentId,
      payload: { allocationRevisionId: candidate.allocationRevisionId, contracts: groups.map(group => ({ ...group,
        lines: group.lines.map(({ grossAmount: _gross, allocatedDiscount: _discount, netAmount: _net, ...line }) => line) })) } },
    statement: { ...base, kind: 'STATEMENT' as const, documentId: identity.statementDocumentId,
      payload: { currency: pricedAllocation.currency, contracts: groups.map(group => ({ ...group,
        grossAmount: group.lines.reduce((sum, line) => new Prisma.Decimal(sum).add(line.grossAmount).toFixed(12), '0.000000000000'),
        allocatedDiscount: group.lines.reduce((sum, line) => new Prisma.Decimal(sum).add(line.allocatedDiscount).toFixed(12), '0.000000000000'),
        netAmount: group.lines.reduce((sum, line) => new Prisma.Decimal(sum).add(line.netAmount).toFixed(12), '0.000000000000') })),
        grossAmount: pricedAllocation.totals.grossAmount, allocatedDiscount: pricedAllocation.totals.discountAmount,
        netAmount: pricedAllocation.totals.netAmount } },
  };
};

export class PrismaDispatchDocumentSourceReader implements DispatchDocumentSourceReader {
  constructor(private readonly prisma: PrismaClient, private readonly templateVersion: string, private readonly generatorVersion: string) {}
  readPrimaryBundle(input: { candidateId: string; waybill: PrimaryBundleIdentity }) {
    return this.prisma.$transaction(tx => sourceFrom(tx, input.candidateId, input.waybill, this.templateVersion, this.generatorVersion),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  async readReplacementBundle(input: { waybillId: string; replacement: PrimaryBundleIdentity }) {
    const waybill = await this.prisma.accountingDispatchWaybill.findUnique({ where: { id: input.waybillId }, select: { candidateId: true } });
    if (!waybill) throw new DispatchDocumentValidationError('Dispatch waybill was not found.');
    return { predecessorWaybillId: input.waybillId,
      ...await this.prisma.$transaction(tx => sourceFrom(tx, waybill.candidateId, input.replacement, this.templateVersion, this.generatorVersion),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }) };
  }
}

export const allocationPricingIntegrityVerifier: DispatchSourceIntegrityVerifier<Tx> = {
  async assess({ transaction, allocationRevisionId, expectedSourceIntegrityHash }) {
    const revision = await transaction.logisticsAllocationRevision.findUnique({ where: { id: allocationRevisionId }, select: { integrityHash: true } });
    if (!revision) throw new DispatchDocumentValidationError('Allocation revision was not found.');
    const pricedAllocation = await readBoundPricedAllocation(transaction, allocationRevisionId);
    const actual = dispatchDocumentSourceIntegrityHash({ allocationRevisionId, allocationIntegrityHash: revision.integrityHash, pricedAllocation });
    if (actual !== expectedSourceIntegrityHash) throw new DispatchDocumentConflictError('Priced allocation source changed before issuance.');
    return assessBoundAllocationPricingFreshness(transaction, allocationRevisionId);
  },
};
