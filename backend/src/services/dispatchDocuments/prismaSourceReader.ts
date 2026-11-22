import { createDispatchProductRows } from '../../utils/printTemplate';
import { partnerPhysicalPrintDetails } from '../../utils/partnerProductPrint';
import { readDispatchContractPrintSources } from './contractPrintSource';
import type { PublishedDispatchArtifact, WaybillPrintData } from './contracts';
import { renderDispatchDocumentPdf } from '../../documents/dispatch/dispatchDocumentPdf';
import { dispatchRecoveryIntegrityHash } from '../dispatchDocumentAuditRecovery';
import { canonicalApprovedPricingHash } from '../approvedPricing/domain';
import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { assessBoundAllocationPricingFreshness, readBoundPricedAllocation,
  type BoundPricedAllocationReadModel } from '../allocationPricingReadModel';
import type { DispatchDocumentSourceReader, DispatchSourceIntegrityVerifier, PrimaryBundleIdentity } from './ports';
import { DispatchDocumentConflictError, DispatchDocumentEvidenceConflictError, DispatchDocumentValidationError } from './service';

type Tx = Prisma.TransactionClient;
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)])) : value;
export const dispatchDocumentSourceIntegrityHash = (input: { allocationRevisionId: string; allocationIntegrityHash: string; pricedAllocation: BoundPricedAllocationReadModel }) =>
  createHash('sha256').update(JSON.stringify(stable(input))).digest('hex');

const sourceFrom = async (tx: Tx, candidateId: string, identity: PrimaryBundleIdentity, templateVersion: string, generatorVersion: string,
  reprint?: { frozenPrint?: WaybillPrintData }) => {
  const candidate = await tx.accountingDispatchCandidate.findUnique({ where: { id: candidateId }, include: {
    allocationRevision: { include: { lines: true } },
  } });
  if (!candidate) throw new DispatchDocumentValidationError('Accounting dispatch candidate was not found.');
  let pricedAllocation: BoundPricedAllocationReadModel;
  try {
    pricedAllocation = await readBoundPricedAllocation(tx, candidate.allocationRevisionId);
  } catch (error) {
    throw new DispatchDocumentEvidenceConflictError(error instanceof Error ? error.message : 'Priced allocation evidence is malformed.');
  }
  const revisionSnapshot = record(candidate.allocationRevision.snapshot);
  const loading = record(revisionSnapshot.loading);
  const customer = record(loading.customer);
  const project = record(loading.project);
  const queueTurn = record(revisionSnapshot.queueTurn);
  const admission = record(queueTurn.admissionSnapshot);
  const driver = record(admission.driver);
  const driverName = [admission.driverName, admission.fullName, driver.fullName,
    [driver.firstName || admission.firstName, driver.lastName || admission.lastName]
      .filter(part => typeof part === 'string' && part.trim()).join(' ')]
    .find((name): name is string => typeof name === 'string' && Boolean(name.trim()))?.trim();
  const lineSnapshots = new Map(candidate.allocationRevision.lines.map(line => [line.id, record(line.snapshot)]));
  const waybillTemplateVersion = `${templateVersion}-contract-table-v2`;
  const frozenPrint = reprint?.frozenPrint;
  const print: WaybillPrintData = { loadingNumber: String(loading.number || ''), contacts: [], rows: Object.create(null) };
  const siblingDispatchRows = new Set(pricedAllocation.lines.map(line => line.productRowId));
  const physicalRows = (rows: ReturnType<ReturnType<typeof createDispatchProductRows>>) =>
    rows.map(({ rate: _rate, total: _total, ...physical }) => physical);
  if (pricedAllocation.sourceKind === 'PARTNER_CASE') {
    const partnerCase = await tx.partnerSaleCase.findUnique({ where: { id: candidate.allocationRevision.partnerCaseId || '' },
      select: { caseNumber: true, customerContractId: true } });
    if (!partnerCase || pricedAllocation.pricingVersions.length !== 1) {
      throw new DispatchDocumentEvidenceConflictError('Partner document ownership evidence is incomplete.');
    }
    const contract = !reprint && partnerCase.customerContractId
      ? (await readDispatchContractPrintSources(tx, [partnerCase.customerContractId])).get(partnerCase.customerContractId)
      : undefined;
    if (contract) print.contacts.push(contract.contact);
    const revisionNumber = candidate.allocationRevision.partnerCaseRevision;
    const frozen = frozenPrint || revisionNumber == null ? null : await tx.partnerCaseRevision.findUnique({
      where: { caseId_revision: { caseId: pricedAllocation.pricingVersions[0].caseId, revision: revisionNumber } },
      select: { graph: true, integrityHash: true },
    });
    const lines = pricedAllocation.lines.map(line => {
      const sourceLine = candidate.allocationRevision.lines.find(item => item.id === line.allocationRevisionLineId);
      if (!sourceLine) throw new DispatchDocumentConflictError('Priced allocation line is absent from its allocation revision.');
      const snapshot = lineSnapshots.get(sourceLine.id) || {};
      const nestedRow = record(snapshot.row);
      if (frozen && frozen.integrityHash === candidate.allocationRevision.partnerIntegrityHash) {
        const details = partnerPhysicalPrintDetails(line.productRowId, frozen.graph);
        print.rows[line.productRowId] = physicalRows(createDispatchProductRows({ products: [{
          productRowId: line.productRowId, stoneName: nestedRow.description || snapshot.label,
        }] }, { partnerDetails: details })(line.productRowId));
      }
      return { productRowId: line.productRowId,
        label: String(nestedRow.description || snapshot.description || snapshot.label || line.productRowId),
        unit: line.unit, quantity: line.quantity, grossAmount: line.grossAmount,
        allocatedDiscount: line.discountAmount, netAmount: line.netAmount };
    });
    const base = { schemaVersion: 1 as const, waybillNumber: identity.number, issuedAt: identity.issuedAt,
      customerName: String(customer.companyName || customer.name || customer.id || ''),
      projectOrDestination: String(loading.destination || project.address || project.name || project.id || ''),
      vehiclePlate: String(admission.vehiclePlate || record(admission.plate).plate || record(admission.vehicle).plate || ''), templateVersion };
    const sourceIntegrityHash = dispatchDocumentSourceIntegrityHash({ allocationRevisionId: candidate.allocationRevisionId,
      allocationIntegrityHash: candidate.allocationRevision.integrityHash, pricedAllocation });
    const pricing = pricedAllocation.pricingVersions[0];
    const sourceVersionIdentities = { allocationRevision: candidate.allocationRevisionId,
      [`partnerFinancialApproval:${pricing.caseId}`]: pricing.financialApprovalEvidenceId };
    const provenance = { generatorVersion, templateVersion, waybillTemplateVersion, sourceVersionIdentities,
      allocationRevisionId: candidate.allocationRevisionId,
      allocationIntegrityHash: candidate.allocationRevision.integrityHash, sourceIntegrityHash,
      pricingVersions: pricedAllocation.pricingVersions };
    const shared = { sourceKind: 'PARTNER_CASE' as const, caseNumber: partnerCase.caseNumber,
      deliveryReference: String(loading.plannedDate || 'تحویل مصوب') };
    return { candidateId: candidate.id, allocationRevisionId: candidate.allocationRevisionId, sourceIntegrityHash,
      pricedAllocation, provenance: { generatorVersion, sourceVersionIdentities },
      waybillSnapshot: { ...revisionSnapshot, documentProvenance: provenance, documentPrint: print },
      waybill: { ...base, kind: 'WAYBILL' as const,
        customerName: String(customer.companyName || customer.name || 'نام مشتری ثبت نشده'),
        projectOrDestination: String(loading.destination || project.address || project.name || ''),
        templateVersion: waybillTemplateVersion, driverName, print: frozenPrint ?? print, documentId: identity.waybillDocumentId,
        payload: { ...shared, allocationRevisionId: candidate.allocationRevisionId,
          lines: lines.map(({ grossAmount: _gross, allocatedDiscount: _discount, netAmount: _net, ...line }) => line) } },
      statement: { ...base, kind: 'STATEMENT' as const, documentId: identity.statementDocumentId,
        payload: { ...shared, currency: pricedAllocation.currency, lines,
          grossAmount: pricedAllocation.totals.grossAmount, allocatedDiscount: pricedAllocation.totals.discountAmount,
          netAmount: pricedAllocation.totals.netAmount } } };
  }
  const saved = await readDispatchContractPrintSources(tx, reprint ? [] : pricedAllocation.pricingVersions.map(version => version.contractId));
  print.contacts = [...saved.values()].map(contract => contract.contact);
  const rowsByContract = new Map([...saved].map(([id, contract]) =>
    [id, createDispatchProductRows(contract.contractData, { siblingDispatchRows })]));
  if (reprint && !frozenPrint) {
    for (const bound of pricedAllocation.pricingVersions) {
      const version = await tx.contractApprovedPricingVersion.findUnique({ where: { id: bound.pricingVersionId },
        select: { sourceFinancialRecordId: true, sourceEvidence: true } });
      if (!version) continue;
      const expectedHash = record(record(version.sourceEvidence).financialApproval).sourceSnapshotHash;
      const financial = await tx.accountingFinancialRecord.findUnique({ where: { id: version.sourceFinancialRecordId },
        select: { contractId: true, sourceSnapshot: true } });
      if (financial?.contractId === bound.contractId && expectedHash &&
          canonicalApprovedPricingHash(financial.sourceSnapshot) === expectedHash) {
        rowsByContract.set(bound.contractId, createDispatchProductRows(record(financial.sourceSnapshot).contractData, { siblingDispatchRows }));
      }
    }
  }
  const contracts = new Map<string, { contractId: string; contractNumber: string; lines: any[] }>();
  for (const line of pricedAllocation.lines) {
    const sourceLine = candidate.allocationRevision.lines.find(item => item.id === line.allocationRevisionLineId);
    if (!sourceLine) throw new DispatchDocumentConflictError('Priced allocation line is absent from its allocation revision.');
    const snapshot = lineSnapshots.get(sourceLine.id) || {};
    const group = contracts.get(line.contractId) || { contractId: line.contractId,
      contractNumber: String(snapshot.contractNumber || saved.get(line.contractId)?.contact.contractNumber || 'ثبت نشده'), lines: [] };
    const projectRows = rowsByContract.get(line.contractId);
    const printKey = `${line.contractId}:${line.productRowId}`;
    if (projectRows) print.rows[printKey] = physicalRows(projectRows(line.productRowId));
    if (typeof snapshot.loadedPieceCount === 'string') {
      (print.loadedPieceCounts ??= Object.create(null))[printKey] = snapshot.loadedPieceCount;
    }
    group.lines.push({ contractItemId: line.contractItemId, productRowId: line.productRowId,
      label: String(snapshot.productName || snapshot.label || line.productRowId), unit: line.unit, quantity: line.quantity,
      grossAmount: line.grossAmount, allocatedDiscount: line.discountAmount, netAmount: line.netAmount });
    contracts.set(line.contractId, group);
  }
  const groups = [...contracts.values()].sort((left, right) => left.contractId.localeCompare(right.contractId));
  const base = { schemaVersion: 1 as const, waybillNumber: identity.number, issuedAt: identity.issuedAt,
    customerName: String(customer.companyName || customer.name || customer.id || ''),
    projectOrDestination: String(project.address || project.name || project.id || ''),
    vehiclePlate: String(admission.vehiclePlate || record(admission.plate).plate || record(admission.vehicle).plate || ''), templateVersion };
  const sourceIntegrityHash = dispatchDocumentSourceIntegrityHash({ allocationRevisionId: candidate.allocationRevisionId,
    allocationIntegrityHash: candidate.allocationRevision.integrityHash, pricedAllocation });
  const sourceVersionIdentities = Object.fromEntries([
    ['allocationRevision', candidate.allocationRevisionId],
    ...pricedAllocation.pricingVersions.map(version => [`approvedPricing:${version.contractId}`, version.pricingVersionId]),
  ]);
  const provenance = { generatorVersion, templateVersion, waybillTemplateVersion, sourceVersionIdentities,
    allocationRevisionId: candidate.allocationRevisionId,
    allocationIntegrityHash: candidate.allocationRevision.integrityHash, sourceIntegrityHash,
    pricingVersions: pricedAllocation.pricingVersions };
  return {
    candidateId: candidate.id, allocationRevisionId: candidate.allocationRevisionId, sourceIntegrityHash, pricedAllocation,
    provenance: { generatorVersion, sourceVersionIdentities },
    waybillSnapshot: { ...revisionSnapshot, documentProvenance: provenance, documentPrint: print },
    waybill: { ...base, kind: 'WAYBILL' as const,
        customerName: String(customer.companyName || customer.name || 'نام مشتری ثبت نشده'),
        projectOrDestination: String(loading.destination || project.address || project.name || ''),
        templateVersion: waybillTemplateVersion, driverName, print: frozenPrint ?? print, documentId: identity.waybillDocumentId,
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
  readPrimaryBundle(input: { candidateId: string; waybill: PrimaryBundleIdentity; historicalPrint?: boolean }) {
    return this.prisma.$transaction(tx => sourceFrom(tx, input.candidateId, input.waybill, this.templateVersion, this.generatorVersion,
      input.historicalPrint ? {} : undefined),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
  async readReplacementBundle(input: { waybillId: string; replacement: PrimaryBundleIdentity }) {
    const waybill = await this.prisma.accountingDispatchWaybill.findUnique({ where: { id: input.waybillId }, select: { candidateId: true } });
    if (!waybill) throw new DispatchDocumentValidationError('Dispatch waybill was not found.');
    return { predecessorWaybillId: input.waybillId,
      ...await this.prisma.$transaction(tx => sourceFrom(tx, waybill.candidateId, input.replacement, this.templateVersion, this.generatorVersion),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }) };
  }

  async reprintWaybill(artifact: PublishedDispatchArtifact, render = renderDispatchDocumentPdf): Promise<Uint8Array | undefined> {
    if (artifact.kind !== 'WAYBILL' || artifact.templateVersion.endsWith('-contract-table-v2')) return;
    const input = await this.prisma.$transaction(async tx => {
      const stored = await tx.dispatchDocumentArtifact.findUnique({
        where: { id: artifact.id },
        include: { waybill: { include: { candidate: { select: { allocationRevisionId: true } } } } },
      });
      const waybill = stored?.waybill;
      if (!stored || !waybill || stored.waybillId !== artifact.waybillId) {
        throw new DispatchDocumentConflictError('Waybill reprint evidence is missing.');
      }
      const snapshot = record(waybill.snapshot);
      const hashedSnapshot = waybill.replacesWaybillId ? { ...snapshot, replacementId: waybill.id } : snapshot;
      if (dispatchRecoveryIntegrityHash(hashedSnapshot) !== waybill.integrityHash) {
        throw new DispatchDocumentConflictError('Waybill reprint snapshot failed verification.');
      }
      const frozenPrint = snapshot.documentPrint as WaybillPrintData | undefined;
      const source = await sourceFrom(tx, waybill.candidateId, {
        waybillId: waybill.id, number: waybill.number.toString(), issuedAt: waybill.issuedAt.toISOString(),
        waybillDocumentId: stored.id, statementDocumentId: stored.id,
      }, this.templateVersion, this.generatorVersion, { frozenPrint });
      if (source.sourceIntegrityHash !== stored.sourceIntegrityHash ||
          source.allocationRevisionId !== waybill.candidate.allocationRevisionId) {
        throw new DispatchDocumentConflictError('Waybill reprint allocation failed verification.');
      }
      return { ...source.waybill, voided: waybill.status === 'VOIDED' };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return (await render(input)).bytes;
  }
}

export const allocationPricingIntegrityVerifier: DispatchSourceIntegrityVerifier<Tx> = {
  async assess({ transaction, allocationRevisionId, expectedSourceIntegrityHash }) {
    try {
      const revision = await transaction.logisticsAllocationRevision.findUnique({ where: { id: allocationRevisionId }, select: { integrityHash: true } });
      if (!revision) throw new Error('Allocation revision was not found.');
      const pricedAllocation = await readBoundPricedAllocation(transaction, allocationRevisionId);
      const actual = dispatchDocumentSourceIntegrityHash({ allocationRevisionId, allocationIntegrityHash: revision.integrityHash, pricedAllocation });
      if (actual !== expectedSourceIntegrityHash) throw new Error('Priced allocation source changed before issuance.');
      return await assessBoundAllocationPricingFreshness(transaction, allocationRevisionId);
    } catch (error) {
      if (error instanceof DispatchDocumentEvidenceConflictError) throw error;
      throw new DispatchDocumentEvidenceConflictError(error instanceof Error ? error.message : 'Priced allocation evidence is malformed.');
    }
  },
};
