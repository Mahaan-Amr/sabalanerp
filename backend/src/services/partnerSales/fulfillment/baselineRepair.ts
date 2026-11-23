import { Prisma, type PrismaClient } from '@prisma/client';
import { assertCanonicalDispatchCommandAllowed, PilotSafetyPauseError } from '../../dispatchCutover';
import { exactQuantityText } from '../../exactQuantity';
import { authorizePartnerTechnicalRollout, lockPartnerOperationsControl } from '../authorization/technicalRollout';
import { partnerPredecessorIsFrozen } from '../corrections/mutationFreeze';
import { hasPartnerDraftAuthority, readPartnerDraftCase } from './draftEligibility';
import { isFinalPartnerLoadingContract } from './effectiveRevision';
import { canonicalPartnerQuantity } from './lineage';
import { validatePartnerPhysicalLineage } from './prismaRepository';
import { PartnerQuantityEvidenceConflictError, readPartnerRepairQuantityProjection,
  synchronizePartnerContractedQuantities } from './quantityStore';

type Tx = Prisma.TransactionClient;
type RepairTarget = { contractNumber: string; caseId?: string };
type Baseline = { productRowId: string; unit: string; quantity: string };
type RepairReport = RepairTarget & (
  { status: 'not-found' | 'ineligible' | 'conflict'; reason: string } |
  { status: 'already-present' | 'missing' | 'repaired'; revision: number;
    missingLineages: string[]; missingBaselines: Baseline[] }
);

async function preflight(tx: Tx, contractNumber: string, apply: boolean): Promise<RepairReport> {
  let target: RepairTarget = { contractNumber };
  const ineligible = (reason: string): RepairReport => ({ ...target, status: 'ineligible', reason });
  const conflict = (reason: string): RepairReport => ({ ...target, status: 'conflict', reason });
  if (apply) await lockPartnerOperationsControl(tx);
  const where = { contractNumber, partnerKind: 'PARTNER_CUSTOMER' as const };
  const selected = await tx.salesContract.findUnique({ where, select: { id: true, partnerCaseId: true } });
  if (!selected?.partnerCaseId) return { ...target, status: 'not-found', reason: 'No linked Partner customer contract' };

  const caseId = selected.partnerCaseId;
  target = { ...target, caseId };
  if (apply) {
    // Preserve the regular command lock order, and read mutable witnesses after waiting.
    await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${caseId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM sales_contracts WHERE id = ${selected.id} FOR UPDATE`;
  }
  try {
    await assertCanonicalDispatchCommandAllowed(tx, { readOnly: !apply });
  } catch (error) {
    if (error instanceof PilotSafetyPauseError) return ineligible(error.message);
    throw error;
  }
  const contract = await tx.salesContract.findUnique({ where, include: {
    customer: { select: { isActive: true } },
    partnerCase: { select: { state: true, customerId: true, committedAt: true } },
  } });
  if (!contract || contract.id !== selected.id || contract.partnerCaseId !== caseId) {
    return conflict('The contract and Case link changed during repair admission');
  }
  if (contract.partnerCase?.state !== 'COMMITTED' || !contract.customer.isActive || !isFinalPartnerLoadingContract(contract)) {
    return ineligible('The Case and customer contract must be committed, active and final');
  }
  const current = await readPartnerDraftCase(tx, caseId);
  if (!current || current.contract.id !== contract.id || contract.partnerCase.customerId !== contract.customerId) {
    return conflict('The reciprocal Case, customer contract and effective revision could not be verified');
  }
  const { view, row } = current;
  if (!(await authorizePartnerTechnicalRollout(tx, row.profileId, 'READ_COMMITTED_FULFILLMENT')).ok ||
      await partnerPredecessorIsFrozen(tx, caseId, view.owner.revision)) {
    return ineligible('Current fulfillment is blocked by rollout or correction controls');
  }
  if (!await hasPartnerDraftAuthority(tx, current)) return ineligible('No current financial, managerial or settlement authority');

  const bindings = await tx.partnerCaseRowBinding.findMany({ where: { caseId, revision: view.owner.revision } });
  if (!contract.partnerCase.committedAt || bindings.length !== view.products.length ||
      view.products.some(product => !canonicalPartnerQuantity(product.quantity) ||
        !bindings.some(binding => binding.productRowId === product.productRowId &&
          binding.unit === product.unit && binding.quantity.equals(product.quantity)))) {
    return conflict('The effective revision has inconsistent physical row bindings');
  }
  const party = (row.head.partySnapshots as Prisma.JsonObject | null)?.customer as Prisma.JsonObject | undefined;
  const destination = view.deliveries[0]?.destination ?? party?.address;
  if (typeof party?.displayName !== 'string' || typeof party.phone !== 'string' || typeof destination !== 'string' || !destination) {
    return conflict('The effective revision lacks valid physical recipient evidence');
  }

  const lineages = await tx.partnerFulfillmentLineage.findMany({ where: { caseId }, orderBy: { productRowId: 'asc' } });
  for (const lineage of lineages) {
    if (lineage.caseRevision > view.owner.revision || lineage.internalRecordId !== view.recordId ||
        !await validatePartnerPhysicalLineage(tx, lineage)) return conflict('A stored physical lineage has invalid origin evidence');
  }

  const projection = await readPartnerRepairQuantityProjection(tx, view);
  if (projection.rows.some(line => line.health !== 'CURRENT' || !line.quantities ||
      new Prisma.Decimal(line.quantities.availableToLoad).lt(0))) {
    return conflict('Shipment movements, baseline evidence or the reserved and dispatched floor conflict');
  }
  const baselines = await tx.shipmentQuantityEvidence.findMany({ where: {
    partnerCaseId: caseId, partnerCaseRevision: view.owner.revision, kind: 'CONTRACTED_SET',
  }, select: { productRowId: true } });
  const expected = [...view.products, ...lineages.filter(lineage => !view.products.some(product => product.productRowId === lineage.productRowId))
    .map(lineage => ({ productRowId: lineage.productRowId, unit: lineage.unit, quantity: '0' }))];
  if (baselines.some(baseline => !expected.some(product => product.productRowId === baseline.productRowId))) {
    return conflict('The effective ledger contains an unexpected contracted row');
  }
  const missingLineages = view.products.filter(product => !lineages.some(lineage => lineage.productRowId === product.productRowId))
    .map(product => product.productRowId);
  const missingBaselines = expected.filter(product => !baselines.some(baseline => baseline.productRowId === product.productRowId))
    .map(({ productRowId, unit, quantity }) => ({ productRowId, unit, quantity: exactQuantityText(quantity) }));
  return { ...target, revision: view.owner.revision, status: missingBaselines.length ? 'missing' : 'already-present',
    missingLineages, missingBaselines };
}

export async function repairPartnerLoadingBaseline(database: PrismaClient, contractNumber: string, apply: boolean): Promise<RepairReport> {
  let target: RepairTarget = { contractNumber };
  try {
    return await database.$transaction(async tx => {
      if (!apply) await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const report = await preflight(tx, contractNumber, apply);
      target = { contractNumber, caseId: report.caseId };
      if (!apply || report.status !== 'missing') return report;
      await synchronizePartnerContractedQuantities(tx, report.caseId!, { initialize: true });
      return { ...report, status: 'repaired' };
    }, { isolationLevel: apply ? 'ReadCommitted' : 'RepeatableRead', timeout: 30_000 });
  } catch (error) {
    if (error instanceof PartnerQuantityEvidenceConflictError ||
        (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
      return { ...target, status: 'conflict', reason: 'Conflicting or invalid immutable shipment evidence' };
    }
    throw error;
  }
}
