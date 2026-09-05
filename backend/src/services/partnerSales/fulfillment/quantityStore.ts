import { Prisma } from '@prisma/client';
import { canonicalHash, FulfillmentViewSchema, type FulfillmentView } from '@sabalanerp/partner-sales-contracts';
import { projectPartnerShipmentQuantities, type PartnerShipmentQuantityEvidence } from '../../shipmentQuantityProjection';
import { guardReturnValidationFailure, shipmentQuantityEvidenceIntegrityHash,
  shipmentQuantitySourceFields, type PartnerPersistedShipmentEvidence } from '../../shipmentQuantityProjectionStore';

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const conflict = (): never => { throw new Error('Partner shipment quantity evidence integrity conflict'); };

/** A command-side capture, under the same Case lock as lineage materialization.
 * Reads never manufacture contracted, reserved or dispatched evidence.
 */
export async function capturePartnerContractedQuantities(tx: Prisma.TransactionClient, view: FulfillmentView) {
  const sale = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: view.owner.caseId }, select: {
    state: true, headRevision: true, integrityHash: true, internalRecordId: true, committedAt: true, committedRevision: true,
    events: { where: { caseRevision: view.owner.revision, type: { in: ['CASE_COMMITTED', 'CORRECTION_EFFECTIVE'] } },
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
    if (!quantity.isFinite() || quantity.lt(0) || quantity.decimalPlaces() > 3) return conflict();
    const identity = { sourceType: 'PARTNER_CASE_CONTRACTED_QUANTITY', sourceId: lineage.id, sourceVersion: view.owner.revision };
    const previous = await tx.shipmentQuantityEvidence.findUnique({ where: { sourceType_sourceId_sourceVersion: identity } });
    if (previous) {
      if (previous.sourceKind !== 'PARTNER_CASE' || previous.partnerCaseId !== view.owner.caseId ||
          previous.partnerLineageId !== lineage.id || previous.partnerCaseRevision !== view.owner.revision ||
          previous.partnerIntegrityHash !== view.owner.integrityHash || previous.productRowId !== product.productRowId ||
          previous.unit !== product.unit || previous.kind !== 'CONTRACTED_SET' || !previous.quantity.equals(product.quantity) ||
          previous.integrityHash !== shipmentQuantityEvidenceIntegrityHash({ ...shipmentQuantitySourceFields(previous),
            ...previous, quantity: previous.quantity.toFixed(3), effectiveAt: previous.effectiveAt.toISOString(),
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
      quantity: quantity.toFixed(3),
      effectiveAt: (view.owner.revision === sale.committedRevision ? sale.committedAt : sale.events[0].recordedAt).toISOString(),
      recordedAt: clock.now.toISOString(), integrityHash: '', metadata: {} };
    await tx.shipmentQuantityEvidence.create({ data: { ...evidence, integrityHash: shipmentQuantityEvidenceIntegrityHash(evidence), effectiveAt: new Date(evidence.effectiveAt),
      recordedAt: clock.now, metadata: {} } });
  }
}

/** A successor cannot leave already-materialized obligations on the old head. */
export async function synchronizePartnerContractedQuantities(tx: Prisma.TransactionClient, caseId: string) {
  if (!await tx.partnerFulfillmentLineage.count({ where: { caseId } })) return;
  const row = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: caseId }, include: { head: true } });
  const view = FulfillmentViewSchema.parse(object(row.head.internalProjection).fulfillment);
  const customer = object(object(row.head.partySnapshots).customer);
  const destination = view.deliveries[0]?.destination ?? customer.address;
  if (typeof customer.displayName !== 'string' || typeof customer.phone !== 'string' || typeof destination !== 'string' || !destination) return conflict();
  for (const product of view.products) {
    if (await tx.partnerFulfillmentLineage.findUnique({ where: { caseId_productRowId: { caseId, productRowId: product.productRowId } } })) continue;
    await tx.partnerFulfillmentLineage.create({ data: {
      id: `partner-fulfillment:${(await canonicalHash(`${caseId}:${product.productRowId}`)).slice(10)}`,
      caseId, caseRevision: view.owner.revision, integrityHash: view.owner.integrityHash,
      internalRecordId: view.recordId, productRowId: product.productRowId, quantity: product.quantity, unit: product.unit,
      recipient: { customerId: row.customerId, displayName: customer.displayName, phone: customer.phone, destination },
      deliveryIds: view.deliveries.filter(delivery => delivery.items.some(item => item.productRowId === product.productRowId)).map(delivery => delivery.deliveryId),
      commandId: `partner-successor-lineage:${caseId}:${view.owner.revision}:${product.productRowId}`,
    } });
  }
  await capturePartnerContractedQuantities(tx, view);
}

/** The existing immutable shipment ledger is authoritative for both source kinds. */
export async function readPartnerShipmentQuantityProjection(tx: Prisma.TransactionClient, caseId: string,
  options: { cutoff?: string; mode?: 'OPERATIONAL_AS_OF' | 'AUDIT_KNOWN_AT' } = {}) {
  const rows = await tx.shipmentQuantityEvidence.findMany({ where: { sourceKind: 'PARTNER_CASE', partnerCaseId: caseId },
    include: { partnerLineage: true, guardReturnMovement: true, dispatchEvidence: true },
    orderBy: [{ effectiveAt: 'asc' }, { recordedAt: 'asc' }, { id: 'asc' }] });
  const evidence: PartnerShipmentQuantityEvidence[] = [];
  for (const row of rows) {
    const identity = shipmentQuantitySourceFields(row);
    if (!('sourceKind' in identity) || identity.sourceKind !== 'PARTNER_CASE' || !row.partnerLineage ||
        row.partnerLineage.caseId !== caseId || row.partnerLineage.productRowId !== row.productRowId ||
        row.partnerLineage.unit !== row.unit) return conflict();
    const fact: PartnerPersistedShipmentEvidence = { ...identity, id: row.id, productRowId: row.productRowId,
      unit: row.unit, kind: row.kind, quantity: row.quantity.toFixed(3), effectiveAt: row.effectiveAt.toISOString(),
      recordedAt: row.recordedAt.toISOString(), sourceType: row.sourceType, sourceId: row.sourceId,
      sourceVersion: row.sourceVersion, integrityHash: row.integrityHash, metadata: object(row.metadata),
      guardReturnMovementId: row.guardReturnMovementId ?? undefined, returnEvidenceId: row.returnEvidenceId ?? undefined,
      dispatchEvidenceId: row.dispatchEvidenceId ?? undefined };
    const returnFailure = guardReturnValidationFailure(row, rows);
    const invalid = fact.integrityHash !== shipmentQuantityEvidenceIntegrityHash(fact) || returnFailure;
    const { contractId: _contract, contractItemId: _item, partnerCaseId, partnerLineageId,
      partnerCaseRevision: _revision, partnerIntegrityHash: _hash, ...common } = fact;
    evidence.push({ ...common, caseId: partnerCaseId, lineageId: partnerLineageId,
      internalRecordId: row.partnerLineage.internalRecordId, guardReturnValidated: !returnFailure,
      ...(invalid ? { kind: 'EVIDENCE_CONFLICT' as const, metadata: { reason: returnFailure || 'Shipment evidence hash conflicts' } } : {}) });
  }
  const cutoff = options.cutoff ?? (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0].now.toISOString();
  const candidates = await tx.partnerCaseEvent.findMany({ where: { caseId,
    type: { in: ['CASE_COMMITTED', 'CORRECTION_EFFECTIVE'] },
    ...(options.mode === 'AUDIT_KNOWN_AT' ? { recordedAt: { lte: new Date(cutoff) } } : {}) },
    orderBy: [{ caseRevision: 'desc' }, { sequence: 'desc' }],
    include: { revision: { include: { rowBindings: true } }, case: { select: { internalRecordId: true, committedAt: true } } } });
  // Operational quantities become effective at the same instant used by the
  // contracted ledger writer, not at midnight of the commercial reporting day.
  const effective = candidates.find(event =>
    (event.type === 'CASE_COMMITTED' ? event.case.committedAt : event.recordedAt)?.getTime()! <= Date.parse(cutoff));
  if (effective) {
    const lineages = await tx.partnerFulfillmentLineage.findMany({ where: { caseId, caseRevision: { lte: effective.caseRevision } } });
    const expected = [...effective.revision.rowBindings.map(row => ({ productRowId: row.productRowId, unit: row.unit, quantity: row.quantity })),
      ...lineages.filter(lineage => !effective.revision.rowBindings.some(row => row.productRowId === lineage.productRowId))
        .map(row => ({ productRowId: row.productRowId, unit: row.unit, quantity: new Prisma.Decimal(0) }))];
    for (const binding of expected) {
      const lineage = lineages.find(row => row.productRowId === binding.productRowId);
      const baseline = rows.find(row => row.kind === 'CONTRACTED_SET' && row.partnerCaseRevision === effective.caseRevision &&
        row.partnerIntegrityHash === effective.integrityHash && row.productRowId === binding.productRowId &&
        row.unit === binding.unit && row.quantity.equals(binding.quantity) && row.effectiveAt <= new Date(cutoff) &&
        (options.mode !== 'AUDIT_KNOWN_AT' || row.recordedAt <= new Date(cutoff)));
      if (lineage && baseline) continue;
      evidence.push({ sourceKind: 'PARTNER_CASE', caseId, internalRecordId: effective.case.internalRecordId,
        lineageId: lineage?.id ?? `partner-fulfillment:${(await canonicalHash(`${caseId}:${binding.productRowId}`)).slice(10)}`,
        productRowId: binding.productRowId, unit: binding.unit, kind: 'EVIDENCE_CONFLICT', quantity: '0',
        id: `partner-quantity-coverage:${caseId}:${effective.caseRevision}:${binding.productRowId}`,
        effectiveAt: cutoff, recordedAt: cutoff, sourceType: 'PARTNER_QUANTITY_COVERAGE_CHECK', sourceId: caseId,
        sourceVersion: effective.caseRevision, integrityHash: effective.integrityHash,
        metadata: { reason: 'Effective Case row lacks its exact immutable contracted-quantity baseline' } });
    }
  }
  return projectPartnerShipmentQuantities(evidence, { ...options, cutoff });
}
