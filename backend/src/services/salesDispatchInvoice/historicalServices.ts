import { Prisma } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';

const Decimal = Prisma.Decimal.clone({ precision: 100 });
const array = (value: any): any[] => Array.isArray(value) ? value : [];
const obj = (value: any): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = (...values: any[]) => values.find(value => typeof value === 'string' && value.trim())?.trim();
const first = (...values: any[]) => values.find(value => value !== undefined && value !== null && value !== '');
function decimal(value: any) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  try { const number = new Decimal(String(value)); return number.isFinite() && !number.isNegative() ? number : null; } catch { return null; }
}
function currency(value: any) {
  const code = String(value || '').trim().toUpperCase();
  if (['TOMAN', 'IRT', 'تومان'].includes(code)) return 10;
  if (['RIAL', 'IRR', 'ریال'].includes(code)) return 1;
  return null;
}
function rate(input: { explicit: any; cost: any; quantity: any; base: any; expectedBase: string; currency: any; documentCurrency: string; minimum?: any }) {
  const from = currency(input.currency || input.documentCurrency), to = currency(input.documentCurrency);
  if (!from || !to) return null;
  // A catalog lookup never supplies price or calculation-basis evidence.
  if (input.base != null && input.base !== input.expectedBase) return null;
  const explicit = decimal(input.explicit);
  if (explicit) return explicit.mul(from).div(to).toFixed();
  if (input.base !== input.expectedBase) return null;
  const cost = decimal(input.cost), quantity = decimal(input.quantity), minimum = decimal(input.minimum);
  if (!cost || !quantity || quantity.isZero() || (minimum && minimum.gt(quantity))) return null;
  return cost.div(quantity).mul(from).div(to).toFixed();
}

/** Decorates a copy of frozen financial evidence; catalog reads resolve identity only. */
export async function historicalServicePrintData(tx: PrismaTypes.TransactionClient, contractData: unknown, documentCurrency: string) {
  const data = obj(contractData);
  if (!Array.isArray(data.products)) return contractData;
  const products: Record<string, any>[] = data.products.map((value: any) => { const product = obj(value); return { ...product, meta: { ...obj(product.meta) } }; });
  const ids = new Set<string>(), finishingIds = new Set<string>();
  for (const p of products) {
    for (const operation of [...array(p.tools), ...array(p.meta.tools), ...array(p.appliedSubServices)]) {
      const id = text(operation.toolId, operation.subServiceId, operation.subService?.id, operation.id, operation.sourceId);
      if (id) ids.add(id);
    }
    for (const f of [p, ...array(p.finishings)]) {
      const id = text(f.finishingId, f === p ? p.meta.finishing?.id : f.id);
      if (id) finishingIds.add(id);
    }
  }
  const [services, finishings] = await Promise.all([
    ids.size ? tx.subService.findMany({ where: { id: { in: [...ids] } }, select: { id: true, code: true, name: true, namePersian: true } }) : [],
    finishingIds.size ? tx.stoneFinishing.findMany({ where: { id: { in: [...finishingIds] } }, select: { id: true, code: true, name: true, namePersian: true } }) : [],
  ]);
  const serviceById = new Map(services.map(service => [service.id, service] as const));
  const finishingById = new Map(finishings.map(finishing => [finishing.id, finishing] as const));
  for (const p of products) {
    const tool = (operation: any) => {
      const catalog = serviceById.get(text(operation.toolId, operation.id, operation.sourceId) || '');
      const historicalRate = rate({ explicit: first(operation.pricePerMeter, operation.rate, operation.unitPrice),
        cost: first(operation.totalPrice, operation.cost), quantity: first(operation.computedMeters, operation.meters, operation.amount),
        base: operation.calculationBase || 'length', expectedBase: 'length', currency: operation.currency,
        documentCurrency, minimum: operation.minimumQuantity });
      return { ...operation, namePersian: text(operation.namePersian, operation.name, catalog?.namePersian, catalog?.name),
        code: text(operation.code, operation.toolCode, operation.sourceCode, catalog?.code),
        dispatchHistoricalRate: historicalRate };
    };
    p.tools = array(p.tools).map(tool);
    p.meta.tools = array(p.meta.tools).map(tool);
    p.appliedSubServices = array(p.appliedSubServices).map((operation: any) => {
      const saved = obj(operation.subService), catalog = serviceById.get(text(operation.subServiceId, saved.id) || '');
      const base = first(operation.calculationBase, saved.calculationBase);
      const expectedBase = base === 'squareMeters' ? 'squareMeters' : base === 'count' ? 'count' : 'length';
      return { ...operation, dispatchHistoricalRate: rate({ explicit: first(operation.unitPrice, operation.rate, saved.pricePerMeter),
        cost: operation.cost, quantity: first(operation.quantity, operation.meter), base, expectedBase,
        currency: operation.currency || saved.currency, documentCurrency, minimum: first(operation.minimumQuantity, saved.minimumQuantity) }),
        subService: { ...saved, code: text(saved.code, operation.code, operation.sourceCode, catalog?.code),
          namePersian: text(saved.namePersian, saved.name, operation.namePersian, operation.name, catalog?.namePersian, catalog?.name) } };
    });
    if (p.finishingId || p.finishingCost != null) {
      const saved = obj(p.meta.finishing), catalog = finishingById.get(text(p.finishingId, saved.id) || '');
      const base = first(p.finishingCalculationBase, saved.calculationBase);
      p.finishingName = text(p.finishingName, saved.namePersian, saved.name, catalog?.namePersian, catalog?.name);
      p.finishingCode = text(p.finishingCode, p.finishing?.code, saved.code, catalog?.code);
      p.dispatchHistoricalFinishingRate = rate({ explicit: first(p.finishingUnitPrice, saved.unitPrice, p.finishingPricePerSquareMeter, saved.pricePerSquareMeter),
        cost: p.finishingCost, quantity: first(p.finishingQuantity, saved.quantity, p.finishingSquareMeters, saved.squareMeters, base === 'squareMeters' ? p.squareMeters : undefined),
        base, expectedBase: base === 'length' ? 'length' : 'squareMeters', currency: p.finishingCurrency || saved.currency,
        documentCurrency, minimum: first(p.finishingMinimumQuantity, saved.minimumQuantity) });
    }
    p.finishings = array(p.finishings).map((f: any) => {
      const catalog = finishingById.get(text(f.finishingId, f.id) || '');
      const base = f.calculationBase;
      return { ...f, code: text(f.code, catalog?.code), name: text(f.namePersian, f.name, catalog?.namePersian, catalog?.name),
        dispatchHistoricalRate: rate({ explicit: f.unitPrice, cost: f.cost, quantity: f.quantity, base,
          expectedBase: base === 'length' ? 'length' : base === 'count' ? 'count' : 'squareMeters', currency: f.currency,
          documentCurrency, minimum: f.minimumQuantity }) };
    });
    p.cuttingBreakdown = array(p.cuttingBreakdown).map((cut: any) => ({ ...cut,
      dispatchHistoricalRate: rate({ explicit: cut.rate, cost: cut.cost, quantity: cut.meters,
        base: cut.calculationBase || 'length', expectedBase: 'length', currency: cut.currency, documentCurrency, minimum: cut.minimumQuantity }) }));
    p.cutDetails = array(p.cutDetails).map((cut: any) => ({ ...cut,
      dispatchHistoricalRate: rate({ explicit: first(cut.rate, cut.cuttingCostPerMeter), cost: first(cut.cost, cut.cuttingCost), quantity: first(cut.meters, cut.length),
        base: cut.calculationBase, expectedBase: 'length', currency: cut.currency, documentCurrency, minimum: cut.minimumQuantity }) }));
  }
  return { ...data, products };
}
