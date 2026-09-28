import { Prisma } from '@prisma/client';
import { RevisionRefSchema, SabalanInternalRecordViewSchema } from '@sabalanerp/partner-sales-contracts';

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const array = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(object) : [];
const decimal = (value: unknown) => typeof value === 'string' && /^(0|[1-9]\d*)(\.\d+)?$/.test(value) ? value : undefined;
const sideNames: Record<string, string> = { front: 'جلو', back: 'عقب', left: 'چپ', right: 'راست' };
const families: Record<string, string> = { longitudinal: 'سنگ طولی', stair: 'پله', slab: 'اسلب', prepared: 'سنگ آماده' };
const units: Record<string, string> = { meter: 'متر طول', count: 'عدد', squareMeter: 'متر مربع', ton: 'تن' };
export const internalQuantityUnit = (unit: string) => units[unit] || unit;

/** Copy only approved Sabalan money and allowlisted physical facts. The graph's
 * commercial amounts and the customer projection are never serialized here. */
export function projectPartnerInternalContent(sourceSnapshot: unknown, graph?: unknown) {
  const preparation = object(object(sourceSnapshot).partnerPreparation);
  const parsed = SabalanInternalRecordViewSchema.pick({ products: true, totals: true, sabalanPaymentPlan: true }).safeParse({
    products: array(preparation.products).map(row => ({ productRowId: row.productRowId, description: row.description,
      quantity: row.quantity, unit: row.unit, wholesaleUnitPrice: row.wholesaleUnitPrice, approvalEvidenceId: row.approvalEvidenceId })),
    totals: preparation.totals, sabalanPaymentPlan: preparation.paymentPlan,
  });
  const owner = RevisionRefSchema.safeParse(preparation.owner);
  if (!parsed.success || !owner.success) return { items: [], totals: undefined, paymentPlan: undefined };
  const rows = array(object(graph).rows), layers = array(object(graph).layerConfigurations);
  const items = parsed.data.products.map(product => {
    const row = rows.find(row => row.productRowId === product.productRowId);
    const facts = object(row?.commercial);
    const details: string[] = [];
    if (row && families[String(row.productType)]) details.push(`نوع: ${families[String(row.productType)]}`);
    for (const [key, label, suffix] of [['requestedLengthMeters', 'طول', ' متر'],
      ['requestedWidthMeters', 'عرض', ' متر'], ['requestedQuantity', 'تعداد', ''],
      ['requestedAreaSquareMeters', 'مساحت', ' متر مربع']]) {
      const value = decimal(facts[key]); if (value) details.push(`${label}: ${value}${suffix}`);
    }
    const operations = object(object(facts.calculationSnapshot).operations);
    for (const tool of array(operations.tools)) if (typeof tool.name === 'string') {
      const quantity = decimal(tool.finalQuantity);
      details.push(`ابزار: ${tool.name}${quantity ? ` · ${quantity} ${internalQuantityUnit(String(tool.unit || ''))}` : ''}`);
    }
    for (const layer of layers.filter(layer => layer.parentProductRowId === product.productRowId)) {
      const input = object(layer.input);
      const sides = Array.isArray(input.targetSides) ? input.targetSides.map(side => sideNames[String(side)]).filter(Boolean).join('، ') : '';
      const width = decimal(input.widthMeters);
      details.push(`لایه: ${typeof input.layerTitle === 'string' ? input.layerTitle : 'ثبت‌شده'}${sides ? ` · ${sides}` : ''}${width ? ` · عرض ${width} متر` : ''}`);
    }
    const ExactDecimal = Prisma.Decimal.clone({ precision: product.quantity.length + product.wholesaleUnitPrice.length + 4 });
    return { productRowId: product.productRowId, description: product.description, productType: typeof row?.productType === 'string' ? row.productType : undefined,
      lengthMeters: decimal(facts.requestedLengthMeters), widthMeters: decimal(facts.requestedWidthMeters),
      pieceCount: decimal(facts.requestedQuantity), areaSquareMeters: decimal(facts.requestedAreaSquareMeters), quantity: product.quantity, unit: product.unit,
      unitPrice: product.wholesaleUnitPrice, totalPrice: new ExactDecimal(product.quantity).mul(product.wholesaleUnitPrice).toFixed(), details };
  });
  return { items, totals: parsed.data.totals, paymentPlan: parsed.data.sabalanPaymentPlan };
}
