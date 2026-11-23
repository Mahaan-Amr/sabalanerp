import type { Prisma, PrismaClient } from '@prisma/client';
import { ExactQuantityDecimal } from './exactQuantity';

const increasesStock = new Set(['RECEIPT', 'OPENING', 'TRANSFORMATION_OUTPUT']);
const decreasesStock = new Set(['SALE_RELIEF', 'RETURN', 'TRANSFORMATION_INPUT']);

/** Sellable physical quantity of accepted return lots, without requiring a valuation layer. */
export async function readStoneReturnAvailability(db: PrismaClient | Prisma.TransactionClient, productIds: string[]) {
  if (!productIds.length) return new Map<string, { unit: string; quantity: string }[]>();
  const read = async (tx: Prisma.TransactionClient) => {
    const lots = await tx.stoneReturnReceipt.findMany({
      where: { productId: { in: productIds }, inventoryIdentityId: { not: null } },
      select: { productId: true, unit: true, inventoryIdentityId: true },
    });
    const identityIds = lots.flatMap(lot => lot.inventoryIdentityId ? [lot.inventoryIdentityId] : []);
    const [eventTotals, reservationTotals] = await Promise.all([
      tx.accountingInventoryEvent.groupBy({
        by: ['identityId', 'eventType'], where: { identityId: { in: identityIds } }, _sum: { quantity: true },
      }),
      tx.accountingInventoryReservation.groupBy({
        by: ['identityId'], where: { identityId: { in: identityIds }, status: 'ACTIVE' }, _sum: { quantity: true },
      }),
    ]);
    const onHand = new Map<string, Prisma.Decimal>();
    for (const row of eventTotals) {
      const current = onHand.get(row.identityId) ?? new ExactQuantityDecimal(0);
      const amount = row._sum.quantity ?? 0;
      if (increasesStock.has(row.eventType)) onHand.set(row.identityId, current.plus(amount));
      if (decreasesStock.has(row.eventType)) onHand.set(row.identityId, current.minus(amount));
    }
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
