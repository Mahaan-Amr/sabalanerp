import { exactQuantityText } from '../../exactQuantity';
import { AccountingDispatchCandidateStatus, Prisma } from '@prisma/client';
import { canonicalHash, FulfillmentViewSchema, PartnerEventSchema, partnerError, type Result, type FulfillmentView } from '@sabalanerp/partner-sales-contracts';
import { projectPartnerShipmentQuantities, type PartnerShipmentQuantityEvidence } from '../../shipmentQuantityProjection';
import { guardReturnValidationFailure, shipmentQuantityEvidenceIntegrityHash,
  shipmentQuantitySourceFields, type PartnerPersistedShipmentEvidence } from '../../shipmentQuantityProjectionStore';
import { buildPartnerPhysicalLineage, canonicalPartnerQuantity } from './lineage';
import { readPartnerRevisionProjections } from '../cases/lifecycle';
import { ownsPartnerRevision } from '../events/persisted';

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export class PartnerQuantityEvidenceConflictError extends Error {}
const conflict = (): never => { throw new PartnerQuantityEvidenceConflictError('Partner shipment quantity evidence integrity conflict'); };

const matchesPartnerEvidenceHash = (fact: PartnerPersistedShipmentEvidence) => {
  if (fact.integrityHash === shipmentQuantityEvidenceIntegrityHash(fact)) return true;
  // The original allocation writer hashed these fields in insertion order.
  // PostgreSQL jsonb can return the same fields in a different order.
  if (fact.sourceType !== 'PARTNER_LOGISTICS_ALLOCATION_REVISION' || fact.kind !== 'ALLOCATION_FINALIZED') return false;
  const { loadingId, revisionId, deliveryId, ...other } = fact.metadata ?? {};
  if (!loadingId || !revisionId || !deliveryId || Object.keys(other).length) return false;
  return fact.integrityHash === shipmentQuantityEvidenceIntegrityHash({
    ...fact, metadata: { loadingId, revisionId, deliveryId },
  });
};

/** Commercial corrections share the physical floor used by reviewed Logistics
 * corrections. Caller holds the Case lock; repeat at finality because stock can
 * be reserved while a corrected Contract awaits its approvals. */
export async function validatePartnerCommercialPhysicalFloor(tx: Prisma.TransactionClient, caseId: string,
  products: Array<{ productRowId: string; quantity: string; unit: string }>,
  options: { allowMissingContractedEvidence?: boolean } = {}): Promise<Result<undefined>> {
  if (!await tx.partnerFulfillmentLineage.count({ where: { caseId } })) return { ok: true, value: undefined };
  const projection = await (options.allowMissingContractedEvidence ? readPartnerCorrectionQuantityProjection(tx, caseId)
    : readPartnerShipmentQuantityProjection(tx, caseId));
  for (const row of projection.rows) {
    if (row.health !== 'CURRENT' || !row.quantities) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    const successor = products.find(product => product.productRowId === row.productRowId);
    if ((successor && successor.unit !== row.unit) || new Prisma.Decimal(successor?.quantity ?? '0').lt(
      new Prisma.Decimal(row.quantities.finalizedReserved).add(row.quantities.physicallyDispatched))) {
      return { ok: false, error: { ...partnerError('DEPENDENCY_BLOCKED'),
        message: 'مقدار قرارداد کمتر از مقدار رزروشده یا ارسال‌شده است؛ ابتدا رزرو یا برگشت کالا را در لجستیک تعیین تکلیف کنید.' } };
    }
  }
  return { ok: true, value: undefined };
}

/** A command-side capture, under the same Case lock as lineage materialization.
 * Reads never manufacture contracted, reserved or dispatched evidence.
 */
export async function capturePartnerContractedQuantities(tx: Prisma.TransactionClient, view: FulfillmentView) {
  const sale = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: view.owner.caseId }, select: {
    state: true, headRevision: true, integrityHash: true, internalRecordId: true, committedAt: true, committedRevision: true,
    events: { where: { caseRevision: view.owner.revision, type: { in: ['CASE_COMMITTED', 'CORRECTION_EFFECTIVE', 'CASE_RECOMMITTED'] } },
      orderBy: { sequence: 'desc' }, take: 1, select: { recordedAt: true } } } });
  if (sale.state !== 'COMMITTED' || sale.headRevision !== view.owner.revision || sale.integrityHash !== view.owner.integrityHash ||
      sale.internalRecordId !== view.recordId || !sale.committedAt || !sale.events[0]) return conflict();
  const lineages = await tx.partnerFulfillmentLineage.findMany({ where: { caseId: view.owner.caseId } });
  const bindings = await tx.partnerCaseRowBinding.findMany({ where: { caseId: view.owner.caseId, revision: view.owner.revision } });
  if (bindings.length !== view.products.length || new Set(view.products.map(row => row.productRowId)).size !== bindings.length ||
      view.products.some(product => !bindings.some(row => row.productRowId === product.productRowId &&
        row.unit === product.unit && row.quantity.equals(product.quantity)))) return conflict();
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const obligations = [...view.products, ...lineages.filter(row => !view.products.some(product => product.productRowId === row.productRowId))
    .map(row => ({ productRowId: row.productRowId, unit: row.unit, quantity: '0' }))];
  for (const product of obligations) {
    const lineage = lineages.find(row => row.productRowId === product.productRowId);
    if (!lineage || lineage.internalRecordId !== view.recordId || lineage.unit !== product.unit) return conflict();
    const quantity = new Prisma.Decimal(product.quantity);
    if (!quantity.isFinite() || quantity.lt(0) || quantity.decimalPlaces() > 30) return conflict();
    const identity = { sourceType: 'PARTNER_CASE_CONTRACTED_QUANTITY', sourceId: lineage.id, sourceVersion: view.owner.revision };
    const previous = await tx.shipmentQuantityEvidence.findUnique({ where: { sourceType_sourceId_sourceVersion: identity } });
    if (previous) {
      if (previous.sourceKind !== 'PARTNER_CASE' || previous.partnerCaseId !== view.owner.caseId ||
          previous.partnerLineageId !== lineage.id || previous.partnerCaseRevision !== view.owner.revision ||
          previous.partnerIntegrityHash !== view.owner.integrityHash || previous.productRowId !== product.productRowId ||
          previous.unit !== product.unit || previous.kind !== 'CONTRACTED_SET' || !previous.quantity.equals(product.quantity) ||
          previous.integrityHash !== shipmentQuantityEvidenceIntegrityHash({ ...shipmentQuantitySourceFields(previous),
            ...previous, quantity: exactQuantityText(previous.quantity), effectiveAt: previous.effectiveAt.toISOString(),
            recordedAt: previous.recordedAt.toISOString(), metadata: object(previous.metadata),
            guardReturnMovementId: previous.guardReturnMovementId ?? undefined,
            returnEvidenceId: previous.returnEvidenceId ?? undefined, dispatchEvidenceId: previous.dispatchEvidenceId ?? undefined,
          } as PartnerPersistedShipmentEvidence)) return conflict();
      continue;
    }
    const evidence: PartnerPersistedShipmentEvidence = { ...identity, id: `partner-quantity:${lineage.id}:${view.owner.revision}`,
      sourceKind: 'PARTNER_CASE', contractId: null, contractItemId: null, partnerCaseId: view.owner.caseId,
      partnerLineageId: lineage.id, partnerCaseRevision: view.owner.revision, partnerIntegrityHash: view.owner.integrityHash,
      productRowId: product.productRowId, unit: product.unit, kind: 'CONTRACTED_SET',
      quantity: exactQuantityText(quantity),
      effectiveAt: (view.owner.revision === sale.committedRevision ? sale.committedAt : sale.events[0].recordedAt).toISOString(),
      recordedAt: clock.now.toISOString(), integrityHash: '', metadata: {} };
    await tx.shipmentQuantityEvidence.create({ data: { ...evidence, integrityHash: shipmentQuantityEvidenceIntegrityHash(evidence), effectiveAt: new Date(evidence.effectiveAt),
      recordedAt: clock.now, metadata: {} } });
  }
}

/** A successor cannot leave already-materialized obligations on the old head. */
export async function synchronizePartnerContractedQuantities(tx: Prisma.TransactionClient, caseId: string, options: { initialize?: boolean } = {}) {
  if (!options.initialize && !await tx.partnerFulfillmentLineage.count({ where: { caseId } })) return;
  const row = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: caseId }, include: { head: true } });
  const view = FulfillmentViewSchema.parse(object(row.head.internalProjection).fulfillment);
  const customer = object(object(row.head.partySnapshots).customer);
  const destination = view.deliveries[0]?.destination ?? customer.address;
  if (typeof customer.displayName !== 'string' || typeof customer.phone !== 'string' || typeof destination !== 'string' || !destination) return conflict();
  const recipient = { customerId: row.customerId, displayName: customer.displayName, phone: customer.phone, destination };
  for (const product of view.products) {
    if (await tx.partnerFulfillmentLineage.findUnique({ where: { caseId_productRowId: { caseId, productRowId: product.productRowId } } })) continue;
    if (!canonicalPartnerQuantity(product.quantity)) return conflict();
    const lineage = await buildPartnerPhysicalLineage({ view, customer: recipient }, product);
    await tx.partnerFulfillmentLineage.create({ data: {
      id: lineage.lineageId, caseId, caseRevision: lineage.createdFrom.revision, integrityHash: lineage.createdFrom.integrityHash,
      internalRecordId: lineage.internalRecordId, productRowId: lineage.productRowId, quantity: lineage.quantity, unit: lineage.unit,
      recipient: lineage.recipient, deliveryIds: lineage.deliveryIds,
      commandId: `partner-quantity-lineage:${caseId}:${view.owner.revision}:${product.productRowId}`,
    } });
  }
  await capturePartnerContractedQuantities(tx, view);
}

type QuantityReadOptions = { cutoff?: string; mode?: 'OPERATIONAL_AS_OF' | 'AUDIT_KNOWN_AT' };

/** The existing immutable shipment ledger governs Logistics selection and reporting. */
export function readPartnerShipmentQuantityProjection(tx: Prisma.TransactionClient, caseId: string, options: QuantityReadOptions = {}) {
  return readQuantityProjection(tx, caseId, options);
}

/** Corrections may use the effective Case binding to assess the physical floor
 * when its shipment baseline is absent. All physical movements still come from
 * the immutable ledger, and normal shipment readers still require a baseline. */
export function readPartnerCorrectionQuantityProjection(tx: Prisma.TransactionClient, caseId: string) {
  return readQuantityProjection(tx, caseId, {}, 'CORRECTION');
}

/** Preview the immutable ledger with only the missing effective baselines
 * supplied by the validated Case. This does not persist projection evidence. */
export function readPartnerRepairQuantityProjection(tx: Prisma.TransactionClient, view: FulfillmentView) {
  return readQuantityProjection(tx, view.owner.caseId, {}, view);
}

async function readQuantityProjection(tx: Prisma.TransactionClient, caseId: string,
  options: QuantityReadOptions, missingBaselineSource?: 'CORRECTION' | FulfillmentView) {
  const repairView = typeof missingBaselineSource === 'object' ? missingBaselineSource : undefined;
  const rows = await tx.shipmentQuantityEvidence.findMany({ where: { sourceKind: 'PARTNER_CASE', partnerCaseId: caseId },
    include: { partnerLineage: true, guardReturnMovement: true, dispatchEvidence: true },
    orderBy: [{ effectiveAt: 'asc' }, { recordedAt: 'asc' }, { id: 'asc' }] });
  const evidence: PartnerShipmentQuantityEvidence[] = [];
  for (const row of rows) {
    if (repairView && !row.quantity.isFinite()) return conflict();
    const identity = shipmentQuantitySourceFields(row);
    if (!('sourceKind' in identity) || identity.sourceKind !== 'PARTNER_CASE' || !row.partnerLineage ||
        row.partnerLineage.caseId !== caseId || row.partnerLineage.productRowId !== row.productRowId ||
        row.partnerLineage.unit !== row.unit) return conflict();
    const fact: PartnerPersistedShipmentEvidence = { ...identity, id: row.id, productRowId: row.productRowId,
      unit: row.unit, kind: row.kind, quantity: exactQuantityText(row.quantity), effectiveAt: row.effectiveAt.toISOString(),
      recordedAt: row.recordedAt.toISOString(), sourceType: row.sourceType, sourceId: row.sourceId,
      sourceVersion: row.sourceVersion, integrityHash: row.integrityHash, metadata: object(row.metadata),
      guardReturnMovementId: row.guardReturnMovementId ?? undefined, returnEvidenceId: row.returnEvidenceId ?? undefined,
      dispatchEvidenceId: row.dispatchEvidenceId ?? undefined };
    const returnFailure = guardReturnValidationFailure(row, rows);
    const invalid = !matchesPartnerEvidenceHash(fact) || returnFailure;
    if (repairView && invalid) return conflict();
    const { contractId: _contract, contractItemId: _item, partnerCaseId, partnerLineageId,
      partnerCaseRevision: _revision, partnerIntegrityHash: _hash, ...common } = fact;
    evidence.push({ ...common, caseId: partnerCaseId, lineageId: partnerLineageId,
      internalRecordId: row.partnerLineage.internalRecordId, guardReturnValidated: !returnFailure,
      ...(invalid ? { kind: 'EVIDENCE_CONFLICT' as const, metadata: { reason: returnFailure || 'Shipment evidence hash conflicts' } } : {}) });
  }
  const cutoff = options.cutoff ?? (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0].now.toISOString();
  const candidates = await tx.partnerCaseEvent.findMany({ where: { caseId,
    type: { in: ['CASE_COMMITTED', 'CORRECTION_EFFECTIVE', 'CASE_RECOMMITTED'] },
    ...(options.mode === 'AUDIT_KNOWN_AT' ? { recordedAt: { lte: new Date(cutoff) } } : {}) },
    orderBy: [{ caseRevision: 'desc' }, { sequence: 'desc' }],
    include: { revision: { include: { rowBindings: true } }, case: { select: { internalRecordId: true, committedAt: true, committedRevision: true } } } });
  // Operational quantities become effective at the same instant used by the
  // contracted ledger writer, not at midnight of the commercial reporting day.
  const effective = candidates.find(event =>
    (event.type === 'CASE_COMMITTED' ? event.case.committedAt : event.recordedAt)?.getTime()! <= Date.parse(cutoff));
  if (repairView && (effective?.caseRevision !== repairView.owner.revision || effective.integrityHash !== repairView.owner.integrityHash)) return conflict();
  if (effective?.case.internalRecordId) {
    const contractedAt = (repairView
      ? effective.case.committedRevision === effective.caseRevision
      : effective.type === 'CASE_COMMITTED') ? effective.case.committedAt! : effective.recordedAt;
    const lineages = await tx.partnerFulfillmentLineage.findMany({ where: { caseId, caseRevision: { lte: effective.caseRevision } } });
    const expected = [...effective.revision.rowBindings.map(row => ({ productRowId: row.productRowId, unit: row.unit, quantity: row.quantity })),
      ...lineages.filter(lineage => !effective.revision.rowBindings.some(row => row.productRowId === lineage.productRowId))
        .map(row => ({ productRowId: row.productRowId, unit: row.unit, quantity: new Prisma.Decimal(0) }))];
    const sameRevisionBaselines = rows.filter(row => row.kind === 'CONTRACTED_SET' && row.partnerCaseRevision === effective.caseRevision);
    const missing = expected.filter(binding => !sameRevisionBaselines.some(row => row.productRowId === binding.productRowId));
    let correctionBindings: Map<string, { quantity: string; unit: string }> | undefined;
    if (missingBaselineSource && (missing.length || repairView)) {
      const owner = { caseId, revision: effective.caseRevision, integrityHash: effective.integrityHash };
      const event = PartnerEventSchema.safeParse(object(effective.evidence).publicEvent);
      if (event.success && event.data.eventId === effective.id && event.data.type === effective.type &&
          ownsPartnerRevision(owner, event.data.owner)) {
        const view = await readPartnerRevisionProjections(tx, owner);
        if (view?.accounting) {
          const allocationLines = await tx.logisticsAllocationRevisionLine.findMany({ where: { partnerCaseId: caseId,
            sourceKind: 'PARTNER_CASE', revision: { candidate: { status: { in: [
              AccountingDispatchCandidateStatus.PENDING, AccountingDispatchCandidateStatus.ACCEPTED,
            ] } } } }, select: { id: true, productRowId: true, partnerLineageId: true, quantity: true } });
          if (allocationLines.every(line => rows.some(row => row.kind === 'ALLOCATION_FINALIZED' &&
              row.sourceType === 'PARTNER_LOGISTICS_ALLOCATION_REVISION' && row.sourceId === line.id && row.effectiveAt <= new Date(cutoff) &&
              row.productRowId === line.productRowId && row.partnerLineageId === line.partnerLineageId &&
              row.quantity.equals(line.quantity)))) {
            correctionBindings = new Map(view.accounting.products.filter(product => product.productType !== 'service')
              .map(product => [product.productRowId, product]));
            if (repairView) for (const lineage of lineages) {
              if (!correctionBindings.has(lineage.productRowId)) {
                correctionBindings.set(lineage.productRowId, { quantity: '0', unit: lineage.unit });
              }
            }
          }
        }
      }
    }
    if (repairView && !correctionBindings) return conflict();
    for (const binding of expected) {
      const lineage = lineages.find(row => row.productRowId === binding.productRowId);
      const rowBaselines = sameRevisionBaselines.filter(row => row.productRowId === binding.productRowId);
      const baseline = rowBaselines.find(row => row.partnerIntegrityHash === effective.integrityHash &&
        row.unit === binding.unit && row.quantity.equals(binding.quantity) && row.effectiveAt <= new Date(cutoff) &&
        (options.mode !== 'AUDIT_KNOWN_AT' || row.recordedAt <= new Date(cutoff)));
      if (repairView && rowBaselines.length && (rowBaselines.length !== 1 || !baseline || !lineage ||
          baseline.sourceType !== 'PARTNER_CASE_CONTRACTED_QUANTITY' || baseline.sourceId !== lineage.id ||
          baseline.sourceVersion !== repairView.owner.revision ||
          baseline.effectiveAt.getTime() !== contractedAt.getTime())) return conflict();
      if (lineage && baseline) continue;
      const lineageId = `partner-fulfillment:${(await canonicalHash(`${caseId}:${binding.productRowId}`)).slice(10)}`;
      const canonical = correctionBindings?.get(binding.productRowId);
      if (!rowBaselines.length && canonical?.unit === binding.unit && binding.quantity.equals(canonical.quantity) &&
          (!lineage || (lineage.id === lineageId && lineage.unit === binding.unit &&
            lineage.internalRecordId === effective.case.internalRecordId))) {
        evidence.push({ sourceKind: 'PARTNER_CASE', caseId, internalRecordId: effective.case.internalRecordId,
          lineageId, productRowId: binding.productRowId, unit: binding.unit, kind: 'CONTRACTED_SET',
          quantity: exactQuantityText(binding.quantity), id: repairView ? `partner-quantity:${lineageId}:${effective.caseRevision}` : effective.id,
          sourceType: 'PARTNER_CASE_EFFECTIVE_BINDING', sourceId: caseId,
          sourceVersion: effective.caseRevision, integrityHash: effective.integrityHash,
          effectiveAt: contractedAt.toISOString(), recordedAt: repairView ? cutoff : effective.recordedAt.toISOString() });
        continue;
      }
      evidence.push({ sourceKind: 'PARTNER_CASE', caseId, internalRecordId: effective.case.internalRecordId,
        lineageId: lineage?.id ?? lineageId,
        productRowId: binding.productRowId, unit: binding.unit, kind: 'EVIDENCE_CONFLICT', quantity: '0',
        id: `partner-quantity-coverage:${caseId}:${effective.caseRevision}:${binding.productRowId}`,
        effectiveAt: cutoff, recordedAt: cutoff, sourceType: 'PARTNER_QUANTITY_COVERAGE_CHECK', sourceId: caseId,
        sourceVersion: effective.caseRevision, integrityHash: effective.integrityHash,
        metadata: { reason: 'Effective Case row lacks its exact immutable contracted-quantity baseline' } });
    }
  }
  return projectPartnerShipmentQuantities(evidence, { ...options, cutoff });
}
