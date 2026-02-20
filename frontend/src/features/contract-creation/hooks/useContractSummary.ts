// useContractSummary Hook
// Provides contract summary computations including products, services, and totals

import { useMemo } from 'react';
import type { ContractProduct, StairStepperPart } from '../types/contract.types';
import { formatDisplayNumber, formatSquareMeters, formatPrice } from '@/lib/numberFormat';

interface ServiceEntry {
  key: string;
  type: 'tool' | 'layer' | 'cut' | 'finishing';
  productName: string;
  description: string;
  amountLabel: string;
  cost: number;
  meta?: {
    rateLabel?: string;
  };
}

interface ProductPriceEntry {
  key: string;
  name: string;
  partLabel: string;
  quantity: number;
  squareMeters: number;
  stoneAreaUsedSqm: number | null;
  isLayer: boolean;
  pricePerSquareMeter: number | null;
  totalPrice: number;
}

interface ProductsSummary {
  totalPrice: number;
  totalSquareMeters: number;
  totalQuantity: number;
}

interface ServiceTotals {
  total: number;
  counts: Record<'tool' | 'layer' | 'cut' | 'finishing', number>;
  amounts: Record<'tool' | 'layer' | 'cut' | 'finishing', number>;
}

interface UseContractSummaryReturn {
  productsSummary: ProductsSummary;
  serviceEntries: ServiceEntry[];
  serviceTotals: ServiceTotals;
  productPriceEntries: ProductPriceEntry[];
  contractGrandTotal: number;
}

const getPartDisplayLabel = (part: StairStepperPart): string => {
  const labels: Record<StairStepperPart, string> = {
    tread: 'کف پله',
    riser: 'پیشانی',
    landing: 'پاگرد'
  };
  return labels[part] || part;
};

export const useContractSummary = (products: ContractProduct[]): UseContractSummaryReturn => {
  // Calculate products summary (total price, square meters, quantity)
  const productsSummary = useMemo<ProductsSummary>(() => {
    const summary = products.reduce((acc, product) => {
      const totalPriceValue = typeof product.totalPrice === 'number'
        ? product.totalPrice
        : parseFloat(String(product.totalPrice || '0'));
      const squareMetersValue = typeof product.squareMeters === 'number'
        ? product.squareMeters
        : parseFloat(String(product.squareMeters || '0'));
      const quantityValue = typeof product.quantity === 'number'
        ? product.quantity
        : parseFloat(String(product.quantity || '0'));

      acc.totalPrice += isNaN(totalPriceValue) ? 0 : totalPriceValue;
      acc.totalSquareMeters += isNaN(squareMetersValue) ? 0 : squareMetersValue;
      acc.totalQuantity += isNaN(quantityValue) ? 0 : quantityValue;
      return acc;
    }, { totalPrice: 0, totalSquareMeters: 0, totalQuantity: 0 });

    return summary;
  }, [products]);

  // Generate service entries (tools, layers, cuts, finishings)
  const serviceEntries = useMemo<ServiceEntry[]>(() => {
    const entries: ServiceEntry[] = [];
    products.forEach((product, productIndex) => {
      const productLabel = product.stoneName || product.product?.namePersian || product.product?.name || `محصول ${productIndex + 1}`;

      // Applied sub-services (tools)
      if (product.appliedSubServices && product.appliedSubServices.length > 0) {
        product.appliedSubServices.forEach((applied, appliedIndex) => {
          const unitLabel = applied.calculationBase === 'squareMeters' ? 'متر مربع' : 'متر';
          const amountLabel = `${formatDisplayNumber(applied.meter || 0)} ${unitLabel}`;
          entries.push({
            key: `tool-${productIndex}-${appliedIndex}-${applied.id}`,
            type: 'tool',
            productName: productLabel,
            description: applied.subService?.namePersian || applied.subService?.name || 'نامشخص',
            amountLabel,
            cost: applied.cost || 0,
            meta: {
              rateLabel: applied.subService?.pricePerMeter
                ? `${formatPrice(applied.subService.pricePerMeter, 'تومان')}/${unitLabel}`
                : undefined
            }
          });
        });
      }

      // Finishing
      if (product.finishingId && product.finishingCost) {
        entries.push({
          key: `finishing-${productIndex}`,
          type: 'finishing',
          productName: productLabel,
          description: product.finishingName || 'فینیشینگ',
          amountLabel: `${formatSquareMeters(product.finishingSquareMeters || product.squareMeters || 0)}`,
          cost: product.finishingCost || 0,
          meta: product.finishingPricePerSquareMeter
            ? {
                rateLabel: `${formatPrice(product.finishingPricePerSquareMeter, 'تومان')}/متر مربع`
              }
            : undefined
        });
      }

      // Layer products
      const isLayerProduct = Boolean((product.meta as any)?.isLayer);
      if (isLayerProduct) {
        const layerMeta = (product.meta as any) || {};
        const descriptionParts: string[] = [];
        if (layerMeta.layer?.numberOfLayersPerStair) {
          const parentPartType = (layerMeta.layer.parentPartType || 'tread') as StairStepperPart;
          descriptionParts.push(`${layerMeta.layer.numberOfLayersPerStair} لایه برای ${getPartDisplayLabel(parentPartType)}`);
        }
        if (layerMeta.layer?.layerTypeName) {
          descriptionParts.push(`نوع لایه: ${layerMeta.layer.layerTypeName}`);
        }
        if (product.layerUseDifferentStone && product.layerStoneName) {
          descriptionParts.push(`سنگ: ${product.layerStoneName}`);
        }
        entries.push({
          key: `layer-${productIndex}`,
          type: 'layer',
          productName: productLabel,
          description: descriptionParts.length ? descriptionParts.join(' | ') : 'لایه',
          amountLabel: `${formatDisplayNumber(product.quantity || 0)} عدد | ${formatSquareMeters(product.squareMeters || 0)}`,
          cost: typeof product.totalPrice === 'number' ? product.totalPrice : parseFloat(String(product.totalPrice || '0')) || 0,
          meta: product.layerUseDifferentStone && product.layerStonePricePerSquareMeter
            ? {
                rateLabel: `${formatPrice(product.layerStonePricePerSquareMeter, 'تومان')}/متر مربع${
                  product.layerUseMandatory && product.layerMandatoryPercentage
                    ? ` (حکمی ${formatDisplayNumber(product.layerMandatoryPercentage)}%)`
                    : ''
                }`
              }
            : undefined
        });
      }

      // Cutting costs
      if (product.isCut && (product.cuttingBreakdown?.length || product.cuttingCost)) {
        const breakdown = product.cuttingBreakdown && product.cuttingBreakdown.length > 0
          ? product.cuttingBreakdown
          : [{
              type: product.cutType || 'longitudinal',
              meters: (product.lengthUnit === 'm' ? product.length : (product.length || 0) / 100) * (product.quantity || 1),
              rate: product.cuttingCostPerMeter || 0,
              cost: product.cuttingCost || 0
            }];

        // Count cross cuts to determine if we should use "?? ?? ?"
        const crossCuts = breakdown.filter(cut => cut.type === 'cross');
        const hasOnlyOneCrossCut = crossCuts.length === 1 && breakdown.length === 1;

        breakdown.forEach((cut, cutIndex) => {
          const metersLabel = `${formatDisplayNumber(cut.meters || 0)} متر`;
          // Use singular label if there is only one cross cut.
          const cutDescription = cut.type === 'cross'
            ? (hasOnlyOneCrossCut ? 'برش عرضی' : 'برش‌های عرضی')
            : 'برش طولی';
          entries.push({
            key: `cut-${productIndex}-${cutIndex}`,
            type: 'cut',
            productName: productLabel,
            description: cutDescription,
            amountLabel: metersLabel,
            cost: cut.cost || 0,
            meta: {
              rateLabel: cut.rate ? `${formatPrice(cut.rate, 'تومان')}/متر` : undefined
            }
          });
        });
      }

      // Partition cuts from remaining stones
      const partitionCuts = (product.usedRemainingStones || []).filter(rs =>
        rs.position && rs.id.startsWith('partition_remaining_') && rs.cuttingCost && rs.cuttingCost > 0
      );
      partitionCuts.forEach((partition, partitionIndex) => {
        entries.push({
          key: `cut-partition-${productIndex}-${partitionIndex}`,
          type: 'cut',
          productName: `${productLabel} (باقی‌مانده)`,
          description: partition.cutType === 'cross' ? 'برش عرضی باقی‌مانده' : 'برش طولی باقی‌مانده',
          amountLabel: `${formatDisplayNumber(partition.length * (partition.quantity || 1))} متر`,
          cost: partition.cuttingCost || 0,
          meta: {
            rateLabel: partition.cuttingCostPerMeter ? `${formatPrice(partition.cuttingCostPerMeter, 'تومان')}/متر` : undefined
          }
        });
      });
    });
    return entries;
  }, [products]);

  // Calculate service totals
  const serviceTotals = useMemo<ServiceTotals>(() => {
    return serviceEntries.reduce((acc, entry) => {
      acc.total += entry.cost || 0;
      acc.counts[entry.type] = (acc.counts[entry.type] || 0) + 1;
      acc.amounts[entry.type] = (acc.amounts[entry.type] || 0) + (entry.cost || 0);
      return acc;
    }, {
      total: 0,
      counts: { tool: 0, layer: 0, cut: 0, finishing: 0 } as Record<'tool' | 'layer' | 'cut' | 'finishing', number>,
      amounts: { tool: 0, layer: 0, cut: 0, finishing: 0 } as Record<'tool' | 'layer' | 'cut' | 'finishing', number>
    });
  }, [serviceEntries]);

  // Generate product price entries
  const productPriceEntries = useMemo<ProductPriceEntry[]>(() => {
    return products.map((product, index) => {
      const isLayer = Boolean((product.meta as any)?.isLayer);
      let partLabel =
        product.productType === 'stair'
          ? (isLayer
              ? `لایه ${getPartDisplayLabel(product.stairPartType as StairStepperPart)}`
              : getPartDisplayLabel(product.stairPartType as StairStepperPart))
          : (product.productType === 'longitudinal'
              ? 'طولی'
              : product.productType === 'slab'
                ? 'اسلب'
                : 'نامشخص');

      // Append "/حکمی" if mandatory option is activated.
      if (product.isMandatory && product.mandatoryPercentage && product.mandatoryPercentage > 0) {
        partLabel = `${partLabel}/حکمی`;
      }
      const pricePerSqmValue = product.pricePerSquareMeter || null;
      const totalPriceValue = typeof product.totalPrice === 'number'
        ? product.totalPrice
        : parseFloat(String(product.totalPrice || '0')) || 0;
      // For layer products, get stone area used from meta
      const layerMeta = isLayer ? (product.meta as any) : null;
      const stoneAreaUsedSqm = layerMeta?.stoneAreaUsedSqm;
      return {
        key: `product-price-${index}-${product.productId}`,
        name: product.stoneName || product.product?.namePersian || product.product?.name || `محصول ${index + 1}`,
        partLabel,
        quantity: product.quantity || 0,
        squareMeters: product.squareMeters || 0,
        stoneAreaUsedSqm: stoneAreaUsedSqm || null,
        isLayer,
        pricePerSquareMeter: pricePerSqmValue,
        totalPrice: totalPriceValue
      };
    });
  }, [products]);

  // Calculate grand total
  const contractGrandTotal = productsSummary.totalPrice;

  return {
    productsSummary,
    serviceEntries,
    serviceTotals,
    productPriceEntries,
    contractGrandTotal
  };
};

