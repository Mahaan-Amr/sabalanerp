import { Prisma } from '@prisma/client';
import {
  PROJECT_RETURN_ACCEPTANCE_EVIDENCE, publishProjectReturnAcceptanceEvidence, publishProjectReturnStockReversal,
} from './accountingOperationalEvidence';
import { hashSupplyChainEvidence } from './accountingSupplyChain';
import { lockInventoryIdentities } from './inventoryIdentityLock';

type Tx = Prisma.TransactionClient;

export async function recordProjectReturnStock(tx: Tx, input: {
  caseId: string; versionId: string; itemId: string; guardVisitId: string; customerId: string;
  productId: string; unit: string; healthyQuantity: string; actorId: string; occurredAt: Date;
}) {
  if (input.healthyQuantity === '0') return null;
  const id = `project-return-item:${input.itemId}`;
  await lockInventoryIdentities(tx, [id]);
  const evidence = await publishProjectReturnAcceptanceEvidence(tx, {
    sourceId: input.itemId, occurredAt: input.occurredAt, sourcePayload: { ...input, inventoryIdentityId: id },
  });
  await tx.accountingInventoryIdentity.create({ data: {
    id, originId: input.itemId, kind: 'FINISHED_GOOD',
    valuationMethod: 'SPECIFIC_IDENTIFICATION', governedUnit: input.unit,
  } });
  await tx.accountingInventoryEvent.create({ data: {
    identityId: id, eventType: 'RECEIPT', statusAfter: 'AVAILABLE',
    warehouseId: 'sabalan-warehouse', locationId: 'انبار سبلان',
    unit: input.unit, quantity: input.healthyQuantity, occurredAt: input.occurredAt,
    sourceType: evidence.type, sourceId: evidence.id, sourceVersion: evidence.version,
    sourceHash: evidence.hash, sourcePayload: evidence.payload as Prisma.InputJsonValue,
  } });
  return id;
}

export async function loadProjectReturnStocks(tx: Tx, identityIds: string[]) {
  const items = await tx.projectReturnVersionItem.findMany({
    where: { inventoryIdentityId: { in: identityIds } },
    include: {
      inventoryIdentity: true,
      version: { include: { returnCase: true, revisions: { take: 1, select: { id: true } } } },
    },
  });
  const itemIds = items.map(item => item.id);
  const sourceType = PROJECT_RETURN_ACCEPTANCE_EVIDENCE;
  const [witnesses, events] = await Promise.all([
    tx.accountingOperationalEvidenceReceipt.findMany({
      where: { ownerWorkspace: 'logistics', sourceType, sourceVersion: 1, sourceId: { in: itemIds } },
    }),
    tx.accountingInventoryEvent.findMany({
      where: { sourceType, sourceVersion: 1, sourceId: { in: itemIds }, eventType: 'RECEIPT', identityId: { in: identityIds } },
    }),
  ]);
  const witnessesByItem = new Map(witnesses.map(witness => [witness.sourceId, witness]));
  const eventsByIdentity = new Map(events.map(event => [event.identityId, event]));

  return new Map(items.map(item => {
    const identityId = item.inventoryIdentityId!;
    const witness = witnessesByItem.get(item.id);
    const event = eventsByIdentity.get(identityId);
    const payload = witness?.sourcePayload as Prisma.JsonObject | undefined;
    const { inventoryIdentity: identity, version } = item;
    const { returnCase: receipt } = version;
    if (!version.submittedAt || !receipt.guardVisitId || !identity || identity.kind !== 'FINISHED_GOOD' || identity.originId !== item.id
      || identity.governedUnit !== item.unit || identity.valuationMethod !== 'SPECIFIC_IDENTIFICATION'
      || !witness || !event || event.sourceId !== item.id || event.unit !== item.unit
      || hashSupplyChainEvidence(witness.sourcePayload) !== witness.sourceHash || event.sourceHash !== witness.sourceHash
      || hashSupplyChainEvidence(event.sourcePayload) !== witness.sourceHash
      || payload?.itemId !== item.id || payload.productId !== item.productId || payload.unit !== item.unit
      || payload.inventoryIdentityId !== identityId || payload.versionId !== version.id || payload.caseId !== receipt.id
      || payload.customerId !== version.customerId || payload.guardVisitId !== receipt.guardVisitId
      || payload.actorId !== version.submittedBy || payload.occurredAt !== version.submittedAt.toISOString()
      || payload.healthyQuantity !== item.healthyQuantity.toFixed()
      || !event.quantity.eq(item.healthyQuantity) || !event.quantity.gt(0)
      || event.occurredAt.getTime() !== version.submittedAt.getTime() || witness.occurredAt.getTime() !== version.submittedAt.getTime()) {
      return [identityId, null] as const;
    }
    return [identityId, { item, identity, event }] as const;
  }));
}

export async function loadProjectReturnStock(tx: Tx, identityId: string) {
  return (await loadProjectReturnStocks(tx, [identityId])).get(identityId);
}

export async function reverseProjectReturnStock(tx: Tx, stock: NonNullable<Awaited<ReturnType<typeof loadProjectReturnStock>>>, input: {
  operationId: string; actorId: string; occurredAt: Date;
}) {
  const { event, identity, item } = stock;
  const evidence = await publishProjectReturnStockReversal(tx, {
    sourceId: item.id, occurredAt: input.occurredAt, sourcePayload: {
      ...input, itemId: item.id, versionId: item.versionId, identityId: identity.id,
      originalEventId: event.id, quantity: event.quantity.toFixed(), unit: item.unit,
    },
  });
  await tx.accountingInventoryEvent.create({ data: {
    identityId: identity.id, eventType: 'RETURN', statusAfter: 'RETURNED',
    warehouseId: event.warehouseId, locationId: event.locationId,
    unit: event.unit, quantity: event.quantity, occurredAt: input.occurredAt,
    sourceType: evidence.type, sourceId: evidence.id, sourceVersion: evidence.version,
    sourceHash: evidence.hash, sourcePayload: evidence.payload as Prisma.InputJsonValue,
  } });
}
