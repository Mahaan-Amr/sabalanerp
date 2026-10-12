import Decimal from 'decimal.js';
import { calculateProductOperations, parseProductOperationsInput } from './operationsPolicy';
import { calculateProductOperationsTechnical, type ProductOperationsTechnicalInput } from './operationsTechnical';

export type MinimumOperationKind = 'tool' | 'finishing';
export interface OperationMinimumRule {
  kind: MinimumOperationKind;
  catalogItemId: string;
  name: string;
  unit: 'meter' | 'squareMeter';
  minimumQuantity?: string | number | null;
}
export interface OperationMinimumQuantity {
  kind: MinimumOperationKind;
  catalogItemId: string;
  unit: 'meter' | 'squareMeter' | 'count';
  quantity: string;
  /** Stable selection identity prevents counting duplicated graph projections. */
  selectionId: string;
  scopeId?: string;
}
export interface OperationMinimumDeficit extends OperationMinimumRule {
  minimumQuantity: string;
  totalQuantity: string;
  deficitQuantity: string;
  unitMismatch: boolean;
}
const ExactDecimal = Decimal.clone({ precision: 60 });
export const operationMinimumKey = (kind: MinimumOperationKind, id: string) => `${kind}:${id}`;

export function evaluateOperationMinimums(quantities: readonly OperationMinimumQuantity[], rules: readonly OperationMinimumRule[]): OperationMinimumDeficit[] {
  const unique = new Set<string>();
  const totals = new Map<string, InstanceType<typeof ExactDecimal>>();
  const units = new Map<string, Set<string>>();
  for (const item of quantities) {
    const key = operationMinimumKey(item.kind, item.catalogItemId);
    const identity = `${key}:${item.selectionId}`;
    if (unique.has(identity)) continue;
    unique.add(identity);
    const quantity = new ExactDecimal(item.quantity);
    if (!quantity.isFinite() || quantity.isNegative()) throw new Error('مقدار عملیات معتبر نیست؛ تنظیمات عملیات را اصلاح کنید.');
    const unitKey = `${key}:${item.unit}`;
    totals.set(unitKey, (totals.get(unitKey) ?? new ExactDecimal(0)).plus(quantity));
    units.set(key, new Set([...(units.get(key) ?? []), item.unit]));
  }
  const deficits: OperationMinimumDeficit[] = [];
  for (const rule of rules) {
    const key = operationMinimumKey(rule.kind, rule.catalogItemId);
    if (!units.has(key)) continue;
    const minimum = new ExactDecimal(rule.minimumQuantity || 0);
    if (!minimum.isFinite() || minimum.isNegative()) throw new Error('حداقل مقدار عملیات معتبر نیست؛ با مدیر انبار تماس بگیرید.');
    if (minimum.isZero()) continue;
    const total = totals.get(`${key}:${rule.unit}`) ?? new ExactDecimal(0);
    const unitMismatch = [...units.get(key)!].some(unit => unit !== rule.unit);
    if (unitMismatch || total.lt(minimum)) deficits.push({ ...rule, minimumQuantity: minimum.toFixed(),
      totalQuantity: total.toFixed(), deficitQuantity: ExactDecimal.max(0, minimum.minus(total)).toFixed(), unitMismatch });
  }
  return deficits;
}

export function operationMinimumMessage(deficit: OperationMinimumDeficit): string {
  if (deficit.unitMismatch) return `واحد عملیات «${deficit.name}» با واحد فعلی انبار متفاوت است؛ عملیات را بازبینی کنید.`;
  const fa = (value: string) => value.replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
  const unit = deficit.unit === 'meter' ? 'متر طول' : 'متر مربع';
  return `مقدار اجرای «${deficit.name}» کمتر از حداقل است. حداقل: ${fa(deficit.minimumQuantity)} ${unit}؛ مجموع فعلی: ${fa(deficit.totalQuantity)} ${unit}؛ کسری: ${fa(deficit.deficitQuantity)} ${unit}. مقدار را افزایش دهید یا این عملیات را حذف کنید.`;
}

/** Read calculated graph/preview selections, including nested layer-side results.
 * Input selections have no finalQuantity and never contribute. */
export function collectCalculatedOperationQuantities(value: unknown): OperationMinimumQuantity[] {
  const result: OperationMinimumQuantity[] = [];
  const seen = new Set<string>();
  const visit = (node: unknown, inheritedScope?: string) => {
    if (Array.isArray(node)) { node.forEach(item => visit(item, inheritedScope)); return; }
    if (!node || typeof node !== 'object') return;
    const item = node as Record<string, unknown>;
    const scopeId = typeof item.operationScopeId === 'string' ? item.operationScopeId
      : typeof item.productRowId === 'string' ? item.productRowId : inheritedScope;
    const kind = item.toolSelectionId ? 'tool' : item.finishingSelectionId ? 'finishing' : undefined;
    if (kind && typeof item.catalogItemId === 'string' && typeof item.finalQuantity === 'string' &&
        (item.unit === 'meter' || item.unit === 'squareMeter')) {
      const selectionId = String(item.toolSelectionId ?? item.finishingSelectionId);
      const key = `${kind}:${selectionId}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ kind, catalogItemId: item.catalogItemId, unit: item.unit, quantity: item.finalQuantity, selectionId, scopeId });
      }
    }
    Object.values(item).forEach(child => visit(child, scopeId));
  };
  visit(value);
  return result;
}

/** Ordinary wizard snapshots retain legacy display copies next to canonical inputs.
 * Prefer the input calculation and read legacy copies only when it is absent. */
export function collectProductOperationQuantities(products: readonly unknown[]): OperationMinimumQuantity[] {
  const quantities: OperationMinimumQuantity[] = [];
  const inputIds = new Set<string>();
  const input = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return;
    const value = raw as Record<string, any>;
    const id = String(value.operationScopeId ?? value.productRowId);
    const identity = JSON.stringify([id, value.tools?.map((tool: any) => tool.toolSelectionId), value.finishings?.map((item: any) => item.finishingSelectionId)]);
    if (inputIds.has(identity)) return;
    inputIds.add(identity);
    const result = 'inputRevision' in value
      ? calculateProductOperationsTechnical(value as ProductOperationsTechnicalInput)
      : calculateProductOperations(parseProductOperationsInput(value));
    if ('result' in result && result.result) quantities.push(...collectCalculatedOperationQuantities(result.result).map(item => ({ ...item, scopeId: id })));
  };
  products.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return;
    const product = raw as Record<string, any>;
    if (product.retiredAt) return;
    const scopeId = String(product.rowId ?? product.productRowId ?? `legacy:${index}`);
    if (product.operationPolicyInput) input(product.operationPolicyInput);
    else {
      (product.appliedSubServices ?? []).forEach((tool: any, ordinal: number) => quantities.push({ kind: 'tool',
        catalogItemId: tool.subServiceId, scopeId, unit: tool.calculationBase === 'squareMeters' ? 'squareMeter' : 'meter',
        quantity: String(tool.meter ?? 0), selectionId: String(tool.id ?? `legacy:${index}:tool:${ordinal}`) }));
      if (product.finishings?.length) product.finishings.forEach((finishing: any, ordinal: number) => quantities.push({ kind: 'finishing',
        catalogItemId: finishing.finishingId, scopeId, unit: finishing.calculationBase === 'count' ? 'count' : finishing.calculationBase === 'length' ? 'meter' : 'squareMeter',
        quantity: String(finishing.quantity ?? 0), selectionId: String(finishing.selectionId ?? `legacy:${index}:finishing:${ordinal}`) }));
      else if (product.finishingEnabled && product.finishingId) quantities.push({ kind: 'finishing', catalogItemId: product.finishingId, scopeId,
        unit: product.finishingCalculationBase === 'count' ? 'count' : product.finishingCalculationBase === 'length' ? 'meter' : 'squareMeter',
        quantity: String(product.finishingQuantity ?? product.finishingSquareMeters ?? 0), selectionId: `legacy:${index}:finishing` });
    }
    for (const side of product.layerSourcePlan?.canonicalInput?.sideOperations ?? []) input(side.operations);
  });
  return quantities;
}
