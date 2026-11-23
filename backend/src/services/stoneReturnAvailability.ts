import { Prisma, type PrismaClient } from '@prisma/client';
import { ExactQuantityDecimal, exactQuantityText } from './exactQuantity';
import { resolveAccountingOperationalEvidence } from './accountingOperationalEvidence';
import { hashSupplyChainEvidence } from './accountingSupplyChain';

type Tx = Prisma.TransactionClient;

export async function loadAcceptedStoneReturnStock(tx: Tx, receipt: {
  id: string; inventoryIdentityId: string | null; unit: string; acceptedQuantity: string;
  customerId: string; productId: string; guardReturnMovementId: string | null; createdAt: Date;
}) {
  if (!receipt.inventoryIdentityId) return null;
  const reference = { type: 'LOGISTICS_STONE_RETURN_ACCEPTANCE', id: receipt.id, version: 1 };
  const [identity, evidence, event] = await Promise.all([
    tx.accountingInventoryIdentity.findUnique({ where: { id: receipt.inventoryIdentityId } }),
    resolveAccountingOperationalEvidence(tx, reference, [reference.type]),
    tx.accountingInventoryEvent.findUnique({ where: { sourceType_sourceId_sourceVersion_eventType_identityId: {
      sourceType: reference.type, sourceId: reference.id, sourceVersion: reference.version,
      eventType: 'RECEIPT', identityId: receipt.inventoryIdentityId,
    } } }),
  ]);
  const payload = evidence.payload as Prisma.JsonObject;
  if (!identity || identity.kind !== 'FINISHED_GOOD' || identity.originId !== receipt.id || identity.governedUnit !== receipt.unit
    || identity.valuationMethod !== 'SPECIFIC_IDENTIFICATION' || !event || event.unit !== receipt.unit
    || event.sourceHash !== evidence.hash || hashSupplyChainEvidence(event.sourcePayload) !== evidence.hash
    || payload?.id !== receipt.id || payload.customerId !== receipt.customerId || payload.productId !== receipt.productId
    || payload.unit !== receipt.unit || payload.inventoryIdentityId !== identity.id
    || payload.guardReturnMovementId !== receipt.guardReturnMovementId
    || typeof payload.acceptedQuantity !== 'string' || exactQuantityText(payload.acceptedQuantity) !== exactQuantityText(receipt.acceptedQuantity)
    || !event.quantity.gt(0) || !event.quantity.eq(receipt.acceptedQuantity) || event.occurredAt.getTime() !== receipt.createdAt.getTime()) {
    return null;
  }
  return { identity, event, evidence };
}

const increasesStock = new Set(['RECEIPT', 'OPENING', 'TRANSFORMATION_OUTPUT']);
const decreasesStock = new Set(['SALE_RELIEF', 'RETURN', 'TRANSFORMATION_INPUT']);

async function readPhysicalStoneReturnQuantities(tx: Tx, identityIds: string[]) {
  const eventTotals = await tx.accountingInventoryEvent.groupBy({
    by: ['identityId', 'eventType'], where: { identityId: { in: identityIds } }, _sum: { quantity: true },
  });
  const onHand = new Map<string, Prisma.Decimal>();
  for (const row of eventTotals) {
    const current = onHand.get(row.identityId) ?? new ExactQuantityDecimal(0);
    const amount = row._sum.quantity ?? 0;
    if (increasesStock.has(row.eventType)) onHand.set(row.identityId, current.plus(amount));
    if (decreasesStock.has(row.eventType)) onHand.set(row.identityId, current.minus(amount));
  }
  return onHand;
}

export async function readAcceptedStoneReturnQuantity(tx: Tx, identityId: string) {
  const receipt = await tx.stoneReturnReceipt.findUnique({ where: { inventoryIdentityId: identityId } });
  if (!receipt) return null;
  const stock = await loadAcceptedStoneReturnStock(tx, { ...receipt, acceptedQuantity: receipt.acceptedQuantity.toFixed() });
  const onHand = stock && (await readPhysicalStoneReturnQuantities(tx, [identityId])).get(identityId);
  return { unit: stock?.identity.governedUnit ?? null, quantity: onHand && onHand.gt(0) ? onHand.toFixed() : '0' };
}

/** Sellable physical quantity of accepted return lots, without requiring a valuation layer. */
export async function readStoneReturnAvailability(
  db: PrismaClient | Tx, products: string[] | Prisma.ProductWhereInput,
) {
  const productFilter = Array.isArray(products) ? { id: { in: products } } : products;
  const read = async (tx: Tx) => {
    const lots = await tx.stoneReturnReceipt.findMany({
      where: { product: { AND: [{ isActive: true, deletedAt: null }, productFilter] }, inventoryIdentityId: { not: null } },
      select: { productId: true, unit: true, inventoryIdentityId: true },
    });
    if (!lots.length) return new Map<string, { unit: string; quantity: string }[]>();
    const identityIds = lots.map(lot => lot.inventoryIdentityId!);
    const [onHand, reservationTotals] = await Promise.all([
      readPhysicalStoneReturnQuantities(tx, identityIds),
      tx.accountingInventoryReservation.groupBy({
        by: ['identityId'], where: { identityId: { in: identityIds }, status: 'ACTIVE' }, _sum: { quantity: true },
      }),
    ]);
    const reserved = new Map(reservationTotals.map(row => [row.identityId, row._sum.quantity]));
    const totals = new Map<string, Map<string, Prisma.Decimal>>();
    for (const lot of lots) {
      const id = lot.inventoryIdentityId!;
      const free = (onHand.get(id) ?? new ExactQuantityDecimal(0)).minus(reserved.get(id) ?? 0);
      if (free.lte(0)) continue;
      const product = totals.get(lot.productId) ?? new Map<string, Prisma.Decimal>();
      product.set(lot.unit, (product.get(lot.unit) ?? new ExactQuantityDecimal(0)).plus(free));
      totals.set(lot.productId, product);
    }
    return new Map([...totals].map(([productId, units]) => [
      productId, [...units].sort(([a], [b]) => a.localeCompare(b)).map(([unit, quantity]) => ({ unit, quantity: quantity.toFixed() })),
    ]));
  };
  return '$transaction' in db ? db.$transaction(read, { isolationLevel: 'RepeatableRead' }) : read(db);
}

export function readProductCatalogAvailabilityPage(
  db: PrismaClient, where: Prisma.ProductWhereInput, availability: boolean | undefined, skip: number, take: number,
) {
  return db.$transaction(async tx => {
    let filtered = where;
    if (availability !== undefined) {
      const returnStock = await readStoneReturnAvailability(tx, { AND: [where, { isAvailable: false }] });
      const returnedProductIds = [...returnStock.keys()];
      filtered = { AND: [where, availability
        ? { OR: [{ isAvailable: true }, { id: { in: returnedProductIds } }] }
        : { isAvailable: false, id: { notIn: returnedProductIds } }] };
    }
    const [products, total] = await Promise.all([
      tx.product.findMany({ where: filtered, skip, take, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
      tx.product.count({ where: filtered }),
    ]);
    const returnStock = await readStoneReturnAvailability(tx, products.map(product => product.id));
    return { products, total, returnStock };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
