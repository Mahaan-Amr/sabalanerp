import type { AppliedSubService, ContractProduct } from '../types/contract.types';

export interface RemainingChildAddOnResult {
  ok: boolean;
  product: ContractProduct;
  reason?: string;
}

export type LegacyRemainingAddOnAction = 'adopt' | 'remove';

const legacyTools = (product: ContractProduct): any[] =>
  Array.isArray(product.meta?.tools) ? product.meta.tools : [];

const hasExplicitTools = (product: ContractProduct): boolean =>
  Array.isArray(product.appliedSubServices) && product.appliedSubServices.length > 0;

const hasExplicitFinishing = (product: ContractProduct): boolean =>
  !!product.finishingId;

export const hasUnresolvedLegacyRemainingChildAddOns = (product: ContractProduct): boolean => {
  const isRemainingChild = !!(product.parentProductRowId || product.meta?.remainingSource);
  if (!isRemainingChild || product.legacyRemainingAddOnResolution) return false;
  return (legacyTools(product).length > 0 && !hasExplicitTools(product)) ||
    (!!product.meta?.finishing && !hasExplicitFinishing(product));
};

export const resolveLegacyRemainingChildAddOns = (
  product: ContractProduct,
  action: LegacyRemainingAddOnAction
): RemainingChildAddOnResult => {
  if (!hasUnresolvedLegacyRemainingChildAddOns(product)) {
    return { ok: true, product };
  }

  if (action === 'remove') {
    return {
      ok: true,
      product: {
        ...product,
        appliedSubServices: [],
        totalSubServiceCost: 0,
        usedLengthForSubServices: 0,
        usedSquareMetersForSubServices: 0,
        finishingEnabled: false,
        finishingId: null,
        finishingCode: null,
        finishingName: null,
        finishingPricePerSquareMeter: null,
        finishingUnitPrice: null,
        finishingCalculationBase: null,
        finishingQuantity: null,
        finishingCost: null,
        finishingSquareMeters: null,
        legacyRemainingAddOnResolution: 'removed',
        meta: {
          ...(product.meta || {}),
          tools: undefined,
          finishing: undefined
        }
      }
    };
  }

  const adoptedTools: AppliedSubService[] = legacyTools(product).map((tool, index) => {
    const sourceId = String(tool.toolId || tool.id || `legacy-tool-${index}`);
    const rate = Number(tool.pricePerMeter || tool.unitPrice || 0);
    const calculationBase = tool.calculationBase === 'squareMeters' ? 'squareMeters' : 'length';
    return {
      id: `adopted-${product.rowId || 'child'}-${sourceId}-${index}`,
      subServiceId: sourceId,
      subService: {
        id: sourceId,
        code: String(tool.code || sourceId),
        namePersian: String(tool.name || tool.namePersian || 'ابزار قدیمی'),
        pricePerMeter: rate,
        calculationBase,
        isActive: true
      },
      meter: Number(tool.quantity ?? tool.computedMeters ?? tool.meter ?? 0),
      cost: 0,
      calculationBase,
      edges: tool.edges || undefined
    };
  });
  const finishing = product.meta?.finishing;
  const adopted: ContractProduct = {
    ...product,
    appliedSubServices: adoptedTools,
    finishingEnabled: !!finishing,
    finishingId: finishing ? String(finishing.id || finishing.code || 'legacy-finishing') : null,
    finishingCode: finishing?.code || null,
    finishingName: finishing?.name || finishing?.namePersian || null,
    finishingUnitPrice: finishing ? Number(finishing.unitPrice ?? finishing.pricePerSquareMeter ?? 0) : null,
    finishingPricePerSquareMeter: finishing ? Number(finishing.pricePerSquareMeter ?? finishing.unitPrice ?? 0) : null,
    finishingCalculationBase: finishing?.calculationBase === 'length' ? 'length' : (finishing ? 'squareMeters' : null),
    finishingQuantity: finishing ? Number(finishing.quantity ?? finishing.squareMeters ?? 0) : null,
    legacyRemainingAddOnResolution: 'adopted'
  };
  return recalculateRemainingChildAddOns(adopted);
};

const toLengthMeters = (product: ContractProduct): number =>
  (product.lengthUnit === 'cm' ? Number(product.length || 0) / 100 : Number(product.length || 0)) *
  Math.max(1, Number(product.quantity) || 1);

const toWidthMeters = (product: ContractProduct): number =>
  (product.widthUnit === 'm' ? Number(product.width || 0) : Number(product.width || 0) / 100) *
  Math.max(1, Number(product.quantity) || 1);

const hasSelectedEdges = (tool: AppliedSubService): boolean => {
  const edges = tool.edges;
  return !!(edges?.perimeter || edges?.front || edges?.back || edges?.left || edges?.right);
};

const calculateEdgeMeters = (product: ContractProduct, tool: AppliedSubService): number => {
  const edges = tool.edges || {};
  const lengthMeters = toLengthMeters(product);
  const widthMeters = toWidthMeters(product);
  if (edges.perimeter) return (lengthMeters + widthMeters) * 2;

  return (edges.front ? lengthMeters : 0) +
    (edges.back ? lengthMeters : 0) +
    (edges.left ? widthMeters : 0) +
    (edges.right ? widthMeters : 0);
};

export const recalculateRemainingChildAddOns = (product: ContractProduct): RemainingChildAddOnResult => {
  if (hasUnresolvedLegacyRemainingChildAddOns(product)) {
    return {
      ok: false,
      product,
      reason: 'افزونه‌های قدیمی این محصول باقی‌مانده هنوز تعیین تکلیف نشده‌اند؛ ابتدا حذف یا پذیرش و محاسبه مجدد را انتخاب کنید.'
    };
  }
  const lengthCapacity = toLengthMeters(product);
  const areaCapacity = Number(product.squareMeters || 0);
  const recalculatedTools: AppliedSubService[] = [];

  for (const tool of product.appliedSubServices || []) {
    const capacity = tool.calculationBase === 'squareMeters' ? areaCapacity : lengthCapacity;
    const meter = hasSelectedEdges(tool) ? calculateEdgeMeters(product, tool) : Number(tool.meter || 0);
    if (!hasSelectedEdges(tool) && meter > capacity + 0.000001) {
      return {
        ok: false,
        product,
        reason: `مقدار ابزار ${tool.subService?.namePersian || tool.subService?.name || ''} (${meter}) از ظرفیت هندسی جدید (${capacity}) بیشتر است.`
      };
    }
    const rate = Number(tool.subService?.pricePerMeter || 0);
    recalculatedTools.push({ ...tool, meter, cost: meter * rate });
  }

  const finishingCapacity = product.finishingCalculationBase === 'length' ? lengthCapacity : areaCapacity;
  const finishingQuantity = Number(product.finishingQuantity || 0);
  if (product.finishingId && finishingQuantity > finishingCapacity + 0.000001) {
    return {
      ok: false,
      product,
      reason: `مقدار پرداخت سنگ ${product.finishingName || ''} (${finishingQuantity}) از ظرفیت هندسی جدید (${finishingCapacity}) بیشتر است.`
    };
  }

  const totalSubServiceCost = recalculatedTools.reduce((sum, tool) => sum + Number(tool.cost || 0), 0);
  const usedLengthForSubServices = recalculatedTools
    .filter((tool) => tool.calculationBase === 'length')
    .reduce((sum, tool) => sum + Number(tool.meter || 0), 0);
  const usedSquareMetersForSubServices = recalculatedTools
    .filter((tool) => tool.calculationBase === 'squareMeters')
    .reduce((sum, tool) => sum + Number(tool.meter || 0), 0);
  const finishingCost = product.finishingId
    ? finishingQuantity * Number(product.finishingUnitPrice || product.finishingPricePerSquareMeter || 0)
    : 0;

  return {
    ok: true,
    product: {
      ...product,
      appliedSubServices: recalculatedTools,
      totalSubServiceCost,
      usedLengthForSubServices,
      usedSquareMetersForSubServices,
      finishingCost,
      finishingSquareMeters: product.finishingCalculationBase === 'squareMeters' ? finishingQuantity : null,
      meta: {
        ...(product.meta || {}),
        tools: recalculatedTools.map((tool) => ({
          toolId: tool.subServiceId,
          id: tool.subServiceId,
          name: tool.subService?.namePersian || tool.subService?.name || '',
          pricePerMeter: tool.subService?.pricePerMeter || 0,
          calculationBase: tool.calculationBase,
          quantity: tool.meter,
          computedMeters: tool.meter,
          totalPrice: tool.cost,
          edges: tool.edges || {}
        })),
        finishing: product.finishingId
          ? {
              ...(product.meta?.finishing || {}),
              id: product.finishingId,
              code: product.finishingCode,
              name: product.finishingName,
              unitPrice: product.finishingUnitPrice || product.finishingPricePerSquareMeter || 0,
              calculationBase: product.finishingCalculationBase,
              quantity: finishingQuantity,
              cost: finishingCost
            }
          : undefined
      }
    }
  };
};
