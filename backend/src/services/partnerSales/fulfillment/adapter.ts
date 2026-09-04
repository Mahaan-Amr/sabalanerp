import { contracts, type FulfillmentPartnerPort, type FulfillmentView, type PartnerErrorCode, type Result } from './contracts';
import type { PartnerFulfillmentCommand, PartnerFulfillmentRepository, PartnerFulfillmentSource, PartnerPhysicalLineage, PartnerLoadingSource } from './repository';
import { parseShipmentQuantityToScaledInteger } from '../../shipmentQuantityProjection';
import { buildPartnerPhysicalLineage, canonicalPartnerQuantity as canonicalQuantity } from './lineage';

const failure = <T = never>(code: PartnerErrorCode): Result<T> => ({ ok: false, error: contracts.partnerError(code) });

const validateSource = (input: FulfillmentView, source: PartnerFulfillmentSource, historical = false): Result<PartnerFulfillmentSource> => {
  const parsedInput = contracts.FulfillmentViewSchema.safeParse(input);
  const parsedSource = contracts.FulfillmentViewSchema.safeParse(source.view);
  const parsedGraph = contracts.CaseGraphRefSchema.safeParse(source.graph);
  if (!parsedInput.success || !parsedSource.success || !parsedGraph.success || !source.customer ||
      !contracts.IdSchema.safeParse(source.customer.customerId).success ||
      !contracts.TextSchema.safeParse(source.customer.displayName).success ||
      !contracts.TextSchema.safeParse(source.customer.phone).success ||
      !contracts.TextSchema.safeParse(source.customer.destination).success) return failure('INVALID_PAYLOAD');
  const view = parsedSource.data;
  const revisionConflict = contracts.checkExpectedRevision(parsedInput.data.owner, view.owner);
  if (revisionConflict) return { ok: false, error: revisionConflict };
  if (contracts.canonicalJson(parsedInput.data) !== contracts.canonicalJson(view)) return failure('INTEGRITY_CONFLICT');
  if (!historical && source.caseState !== 'COMMITTED') return failure('STATE_CONFLICT');
  if (contracts.checkExpectedRevision(view.owner, parsedGraph.data.owner)) return failure('INTEGRITY_CONFLICT');
  if (!view.products.length || new Set(view.products.map(row => row.productRowId)).size !== view.products.length) return failure('INTEGRITY_CONFLICT');
  const viewRows = [...view.products.map(row => row.productRowId)].sort();
  const graphRows = [...parsedGraph.data.productRowIds].sort();
  if (!source.canonicalGraph || !Array.isArray(source.canonicalGraph.productRowIds)) return failure('INTEGRITY_CONFLICT');
  const canonicalRows = [...source.canonicalGraph.productRowIds].sort();
  if (!contracts.HashSchema.safeParse(source.canonicalGraph.graphHash).success ||
      source.canonicalGraph.productRowIds.some(row => !contracts.IdSchema.safeParse(row).success) ||
      parsedGraph.data.graphHash !== source.canonicalGraph.graphHash ||
      contracts.canonicalJson(viewRows) !== contracts.canonicalJson(graphRows) ||
      contracts.canonicalJson(graphRows) !== contracts.canonicalJson(canonicalRows)) return failure('INTEGRITY_CONFLICT');
  if (view.products.some(row => canonicalQuantity(row.quantity) === null)) return failure('INTEGRITY_CONFLICT');
  if (new Set(view.deliveries.map(row => row.deliveryId)).size !== view.deliveries.length) return failure('INTEGRITY_CONFLICT');
  const products = new Map(view.products.map(row => [row.productRowId, row]));
  const delivered = new Map<string, bigint>();
  for (const delivery of view.deliveries) {
    if (new Set(delivery.items.map(item => item.productRowId)).size !== delivery.items.length) return failure('INTEGRITY_CONFLICT');
    for (const item of delivery.items) {
      const quantity = canonicalQuantity(item.quantity);
      if (!quantity || !products.has(item.productRowId)) return failure('INTEGRITY_CONFLICT');
      delivered.set(item.productRowId, (delivered.get(item.productRowId) || 0n) + parseShipmentQuantityToScaledInteger(quantity));
    }
  }
  for (const [productRowId, product] of products) {
    if ((delivered.get(productRowId) || 0n) > parseShipmentQuantityToScaledInteger(product.quantity)) return failure('INTEGRITY_CONFLICT');
  }
  return { ok: true, value: { ...source, view, graph: parsedGraph.data } };
};

export function createPartnerFulfillmentAdapter(repository: PartnerFulfillmentRepository) {
  const inspect = (view: FulfillmentView, mode: 'SUCCESSOR' | 'VOIDING') => repository.transaction(async tx => {
    const loaded = await tx.readAuthorizedSource(view.owner, mode === 'VOIDING' ? 'INSPECT_VOIDING' : 'INSPECT_DEPENDENCIES');
    if (!loaded.ok) return loaded;
    const validated = validateSource(view, loaded.value);
    if (!validated.ok) return validated;
    const dependencies = await tx.readQuantityDependencies(view.owner);
    const products = new Map(validated.value.view.products.map(row => [row.productRowId, row]));
    const counts = new Map<string, number>();
    for (const row of dependencies) counts.set(row.productRowId, (counts.get(row.productRowId) || 0) + 1);
    const blocked = new Set<string>();
    for (const product of validated.value.view.products) {
      if (!counts.has(product.productRowId) && await tx.findLineage(view.owner.caseId,
        product.productRowId)) blocked.add(product.productRowId);
    }
    dependencies.filter(row => {
      const product = products.get(row.productRowId);
      if (counts.get(row.productRowId) !== 1 || row.sourceKind !== 'PARTNER_CASE' || !row.evidenceIds.length ||
          row.internalRecordId !== validated.value.view.recordId || row.health !== 'CURRENT' || (product && row.unit !== product.unit) ||
          contracts.checkExpectedRevision(validated.value.view.owner, row.owner)) return true;
      try {
        const contracted = parseShipmentQuantityToScaledInteger(row.contracted);
        const reserved = parseShipmentQuantityToScaledInteger(row.finalizedReserved);
        const dispatched = parseShipmentQuantityToScaledInteger(row.physicallyDispatched);
        if (!product) return contracted !== 0n || reserved !== 0n || dispatched !== 0n;
        const proposed = parseShipmentQuantityToScaledInteger(product.quantity);
        const invalid = contracted <= 0n || reserved < 0n || dispatched < 0n || reserved + dispatched > contracted;
        return invalid || contracted !== proposed || (mode === 'VOIDING' ? reserved > 0n || dispatched > 0n : reserved + dispatched > proposed);
      } catch {
        return true;
      }
    }).forEach(row => blocked.add(row.productRowId));
    return { ok: true, value: {
      evidenceIds: [...new Set(dependencies.flatMap(row => row.evidenceIds))],
      blockedProductRowIds: [...blocked],
    } };
  });
  const inspectDependencies: FulfillmentPartnerPort['inspectDependencies'] = view => inspect(view, 'SUCCESSOR');

  const readLoading = (expected: FulfillmentView['owner'], deliveryId: string, historical: boolean): Promise<Result<PartnerLoadingSource>> => repository.transaction(async tx => {
      if (!contracts.RevisionRefSchema.safeParse(expected).success || !contracts.IdSchema.safeParse(deliveryId).success) return failure('INVALID_PAYLOAD');
      const loaded = await tx.readAuthorizedSource(expected, historical ? 'INSPECT_LOADING' : 'SELECT_DELIVERY');
      if (!loaded.ok) return loaded;
      const stale = contracts.checkExpectedRevision(expected, loaded.value.view.owner);
      if (stale) return { ok: false, error: stale };
      const validated = validateSource(loaded.value.view, loaded.value, historical);
      if (!validated.ok) return validated;
      const source = validated.value;
      const delivery = source.view.deliveries.find(row => row.deliveryId === deliveryId);
      if (!delivery) return failure('NOT_FOUND');
      const rows: PartnerLoadingSource['rows'] = [];
      for (const item of delivery.items) {
        const product = source.view.products.find(row => row.productRowId === item.productRowId)!;
        const lineage = await tx.findLineage(expected.caseId, item.productRowId);
        if (!lineage || lineage.sourceKind !== 'PARTNER_CASE' || lineage.caseId !== expected.caseId ||
            lineage.internalRecordId !== source.view.recordId || lineage.productRowId !== item.productRowId ||
            lineage.unit !== product.unit || lineage.recipient.customerId !== source.customer.customerId ||
            lineage.createdFrom.caseId !== expected.caseId || lineage.createdFrom.revision > expected.revision) return failure('INTEGRITY_CONFLICT');
        rows.push({ lineageId: lineage.lineageId, productRowId: item.productRowId, description: product.description,
          unit: product.unit, plannedQuantity: canonicalQuantity(item.quantity)! });
      }
      return { ok: true, value: { sourceKind: 'PARTNER_CASE', owner: source.view.owner,
        internalRecordId: source.view.recordId, deliveryId, plannedDate: delivery.date,
        recipient: { ...source.customer, destination: delivery.destination }, rows } };
    });
  return {
    readLoadingSource: (expected: FulfillmentView['owner'], deliveryId: string) => readLoading(expected, deliveryId, false),
    readLoadingEvidence: (expected: FulfillmentView['owner'], deliveryId: string) => readLoading(expected, deliveryId, true),
    inspectDependencies,
    inspectVoidingDependencies: (view: FulfillmentView) => inspect(view, 'VOIDING'),
    ensureCommittedLineage: (view: FulfillmentView, command: PartnerFulfillmentCommand) => repository.transaction(async tx => {
      if (command.schemaVersion !== 1 || !contracts.IdSchema.safeParse(command.commandId).success ||
          !contracts.IdSchema.safeParse(command.correlationId).success || !contracts.IdSchema.safeParse(command.authenticatedActorId).success ||
          !contracts.IdSchema.safeParse(command.idempotencyKey).success || !contracts.RevisionRefSchema.safeParse(command.expected).success) return failure('INVALID_PAYLOAD');
      const commandConflict = contracts.checkExpectedRevision(command.expected, view.owner);
      if (commandConflict) return { ok: false, error: commandConflict };
      const operation = 'PARTNER_FULFILLMENT_MATERIALIZE';
      const intentHash = await contracts.canonicalHash({ schemaVersion: 1, operation, targetId: view.owner.caseId,
        expected: command.expected, view });
      const scopedCommand = { ...command, idempotency: { actorId: command.authenticatedActorId, operation,
        targetId: view.owner.caseId, key: command.idempotencyKey, payloadHash: intentHash } };
      const loaded = await tx.readAuthorizedSource(view.owner, 'MATERIALIZE', command.authenticatedActorId);
      if (!loaded.ok) return loaded;
      const replay = await tx.readLineageCommand(scopedCommand);
      if (replay) {
        if (replay.intentHash !== intentHash || contracts.compareIdempotency(replay.idempotency, scopedCommand.idempotency) !== 'REPLAY') {
          return failure('IDEMPOTENCY_CONFLICT');
        }
        return { ok: true, value: { commandId: replay.commandId, replayed: true, lineageEvidenceIds: replay.lineageEvidenceIds } };
      }
      const validated = validateSource(view, loaded.value);
      if (!validated.ok) return validated;
      const lineages: PartnerPhysicalLineage[] = [];
      for (const product of validated.value.view.products) {
        const expected = await buildPartnerPhysicalLineage(validated.value, product);
        const existing = await tx.findLineage(expected.caseId, expected.productRowId);
        if (existing) {
          if (existing.lineageId !== expected.lineageId || existing.sourceKind !== 'PARTNER_CASE' ||
              existing.caseId !== expected.caseId || existing.internalRecordId !== expected.internalRecordId ||
              existing.productRowId !== expected.productRowId || existing.unit !== expected.unit ||
              existing.recipient.customerId !== expected.recipient.customerId ||
              !contracts.RevisionRefSchema.safeParse(existing.createdFrom).success ||
              existing.createdFrom.caseId !== expected.caseId || existing.createdFrom.revision > expected.createdFrom.revision ||
              (existing.createdFrom.revision === expected.createdFrom.revision &&
                contracts.canonicalJson(existing) !== contracts.canonicalJson(expected))) return failure('INTEGRITY_CONFLICT');
          lineages.push(existing);
          continue;
        }
        lineages.push(expected);
      }
      const committed = await tx.commitLineages({ command: scopedCommand, intentHash, lineages });
      return committed.ok ? { ok: true, value: { commandId: committed.value.commandId, replayed: false,
        lineageEvidenceIds: committed.value.lineageEvidenceIds } } : committed;
    }),
  };
}
