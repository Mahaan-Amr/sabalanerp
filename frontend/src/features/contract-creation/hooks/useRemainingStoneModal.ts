// useRemainingStoneModal Hook
// Manages remaining stone modal state and handlers

import { useState, useCallback } from 'react';
import {
  calculateProductOperations,
  parseCanonicalDecimal,
  parseStableIdentity,
  type ProductOperationsInput
} from '@sabalanerp/contract-product-graph';
import type {
  RemainingStone,
  ContractProduct,
  StonePartition,
  ContractWizardData
} from '../types/contract.types';
import {
  isUsableRemainingStone,
  mergeRemainingStoneCollection,
  sanitizeRemainingStoneEntry
} from '../utils/remainingStoneGuards';
import { createContractProductRowId, ensureContractProductRowIds } from '../utils/contractProductIdentity';
import { SAW_KERF_CM } from '../utils/sawKerf';
import {
  allocateRemainingStonePartitions
} from '../services/remainingStonePartitionService';
import {
  formatRemainingStoneReplayConflicts,
  replayRemainingStoneAllocations,
  resolveRemainingStoneSourceInventory
} from '../services/remainingStoneAllocationReplayService';
import { calculateRemainingChildCuttingBreakdown } from '../services/remainingStoneCuttingService';

interface UseRemainingStoneModalOptions {
  wizardData: ContractWizardData;
  updateWizardData: (updates: Partial<ContractWizardData>) => void;
  getCuttingTypePricePerMeter: (code: string) => number | null;
  calculatePartitionPositions: (
    partitions: StonePartition[],
    availableWidth: number,
    availableLength: number
  ) => StonePartition[];
  setErrors: (errors: Record<string, string>) => void;
  handleSmartCalculation?: (
    changedField: 'length' | 'width' | 'squareMeters' | 'quantity',
    value: number,
    currentConfig: any,
    lengthUnit: 'cm' | 'm',
    widthUnit: 'cm' | 'm',
    effectiveQuantity?: number
  ) => { length: number; width: number; squareMeters: number };
  getEffectiveQuantity?: () => number;
}

const createEmptyPartition = (): StonePartition => ({
  id: `partition_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  width: 0,
  length: 0,
  quantity: 1,
  squareMeters: 0
});

export const useRemainingStoneModal = (options: UseRemainingStoneModalOptions) => {
  const {
    wizardData,
    updateWizardData,
    getCuttingTypePricePerMeter,
    calculatePartitionPositions,
    setErrors,
    handleSmartCalculation,
    getEffectiveQuantity
  } = options;

  // Modal visibility
  const [showRemainingStoneModal, setShowRemainingStoneModal] = useState(false);

  // Selected remaining stone
  const [selectedRemainingStone, setSelectedRemainingStone] = useState<RemainingStone | null>(null);
  const [selectedRemainingStoneSourceProduct, setSelectedRemainingStoneSourceProduct] = useState<ContractProduct | null>(null);

  // Remaining stone config
  const [remainingStoneConfig, setRemainingStoneConfig] = useState<Partial<ContractProduct>>({});
  const [remainingStoneLengthUnit, setRemainingStoneLengthUnit] = useState<'cm' | 'm'>('m');
  const [remainingStoneWidthUnit, setRemainingStoneWidthUnit] = useState<'cm' | 'm'>('cm');
  const [remainingStoneIsMandatory, setRemainingStoneIsMandatory] = useState(false);
  const [remainingStoneMandatoryPercentage, setRemainingStoneMandatoryPercentage] = useState(20);
  const [remainingStoneSawKerfEnabled, setRemainingStoneSawKerfEnabled] = useState(false);

  // Partition state
  const [partitions, setPartitions] = useState<StonePartition[]>([]);
  const [partitionLengthUnit, setPartitionLengthUnit] = useState<'cm' | 'm'>('m');
  const [partitionWidthUnit, setPartitionWidthUnit] = useState<'cm' | 'm'>('cm');
  const [partitionValidationErrors, setPartitionValidationErrors] = useState<Map<string, string>>(new Map());

  const resolveSourceProduct = useCallback((remainingStone: RemainingStone): ContractProduct | null => {
    return selectedRemainingStoneSourceProduct ||
      wizardData.products.find(p => (p.remainingStones || []).some(rs => rs.id === remainingStone.id)) ||
      null;
  }, [selectedRemainingStoneSourceProduct, wizardData.products]);

  const validateRowsAgainstStock = useCallback((rows: Array<{
    id: string;
    width: number;
    length: number;
    quantity: number;
    squareMeters: number;
  }>, remainingStone: RemainingStone) => {
    return allocateRemainingStonePartitions(rows, remainingStone, {
      sawKerfEnabled: remainingStoneSawKerfEnabled,
      sawKerfCm: SAW_KERF_CM
    });
  }, [remainingStoneSawKerfEnabled]);

  // Handle unit conversion for remaining stone length
  const handleRemainingStoneLengthUnitChange = useCallback((newUnit: 'cm' | 'm') => {
    if (!remainingStoneConfig.length) return;

    const currentLength = remainingStoneConfig.length;
    let convertedLength = currentLength;

    if (remainingStoneLengthUnit === 'cm' && newUnit === 'm') {
      convertedLength = currentLength / 100;
    } else if (remainingStoneLengthUnit === 'm' && newUnit === 'cm') {
      convertedLength = currentLength * 100;
    }

    setRemainingStoneLengthUnit(newUnit);
    setRemainingStoneConfig(prev => {
      const updatedConfig = { ...prev, length: convertedLength, width: selectedRemainingStone?.width || 0 };
      if (handleSmartCalculation && getEffectiveQuantity) {
        const smartResult = handleSmartCalculation('length', convertedLength, updatedConfig, newUnit, 'cm', getEffectiveQuantity());
        return {
          ...updatedConfig,
          squareMeters: smartResult.squareMeters
        };
      }
      return updatedConfig;
    });
  }, [remainingStoneConfig.length, remainingStoneLengthUnit, selectedRemainingStone, handleSmartCalculation, getEffectiveQuantity]);

  // Handle unit conversion for remaining stone width
  const handleRemainingStoneWidthUnitChange = useCallback((newUnit: 'cm' | 'm') => {
    if (!remainingStoneConfig.width) return;

    const currentWidth = remainingStoneConfig.width;
    let convertedWidth = currentWidth;

    if (remainingStoneWidthUnit === 'cm' && newUnit === 'm') {
      convertedWidth = currentWidth / 100;
    } else if (remainingStoneWidthUnit === 'm' && newUnit === 'cm') {
      convertedWidth = currentWidth * 100;
    }

    setRemainingStoneWidthUnit(newUnit);
    setRemainingStoneConfig(prev => {
      const updatedConfig = { ...prev, width: convertedWidth, length: remainingStoneConfig.length || 0 };
      if (handleSmartCalculation && getEffectiveQuantity) {
        const smartResult = handleSmartCalculation('width', convertedWidth, updatedConfig, remainingStoneLengthUnit, newUnit, getEffectiveQuantity());
        return {
          ...updatedConfig,
          length: smartResult.length,
          squareMeters: smartResult.squareMeters
        };
      }
      return updatedConfig;
    });
  }, [remainingStoneConfig.width, remainingStoneWidthUnit, remainingStoneLengthUnit, handleSmartCalculation, getEffectiveQuantity]);

  // Partition management handlers
  const handleAddPartition = useCallback(() => {
    setPartitions(prev => [...prev, createEmptyPartition()]);
  }, []);

  const handleRemovePartition = useCallback((partitionId: string) => {
    setPartitions(prev => prev.filter(p => p.id !== partitionId));
    setPartitionValidationErrors(prev => {
      const next = new Map(prev);
      next.delete(partitionId);
      return next;
    });
  }, []);

  const handleUpdatePartition = useCallback((partitionId: string, field: 'width' | 'length' | 'quantity', value: number) => {
    setPartitions(prev => {
      const updated = prev.map(p => {
        if (p.id !== partitionId) return p;

        const safeQuantity = field === 'quantity'
          ? Math.max(1, Math.floor(value || 1))
          : Math.max(1, Math.floor(p.quantity || 1));
        const updatedPartition = {
          ...p,
          [field]: field === 'quantity' ? safeQuantity : value,
          quantity: safeQuantity,
          validationError: undefined
        };

        if (updatedPartition.width > 0 && updatedPartition.length > 0) {
          const widthInCm = partitionWidthUnit === 'm' ? updatedPartition.width * 100 : updatedPartition.width;
          const lengthInMeters = partitionLengthUnit === 'm' ? updatedPartition.length : (updatedPartition.length / 100);
          updatedPartition.squareMeters = (widthInCm * lengthInMeters * safeQuantity) / 100;
        } else {
          updatedPartition.squareMeters = 0;
        }

        return updatedPartition;
      });

      if (selectedRemainingStone) {
        const validPartitions = updated
          .filter(p => p.width > 0 && p.length > 0)
          .map(p => {
            const safeQuantity = Math.max(1, Math.floor(p.quantity || 1));
            const widthCm = partitionWidthUnit === 'm' ? p.width * 100 : p.width;
            const lengthM = partitionLengthUnit === 'm' ? p.length : p.length / 100;
            return {
              ...p,
              quantity: safeQuantity,
              width: widthCm,
              length: lengthM,
              squareMeters: (widthCm * lengthM * safeQuantity) / 100
            };
          });

        if (validPartitions.length > 0) {
          const validation = validateRowsAgainstStock(validPartitions, selectedRemainingStone);
          const updatedWithErrors = updated.map(p => {
            const error = validation.rowErrors.get(p.id);
            return error ? { ...p, validationError: error } : { ...p, validationError: undefined };
          });

          setPartitionValidationErrors(validation.rowErrors);
          return updatedWithErrors;
        }

        setPartitionValidationErrors(new Map());
      }

      return updated;
    });
  }, [selectedRemainingStone, partitionWidthUnit, partitionLengthUnit, validateRowsAgainstStock]);

  // Handle adding remaining stone product to contract (with partitions)
  const handleAddRemainingStoneToContract = useCallback(() => {
    if (!selectedRemainingStone) {
      setErrors({ products: 'سنگ باقی‌مانده انتخاب نشده است.' });
      return;
    }

    const sourceProduct = resolveSourceProduct(selectedRemainingStone);

    if (!sourceProduct) {
      setErrors({ products: 'محصول منبع برای سنگ باقی‌مانده پیدا نشد.' });
      return;
    }

    const productsWithRowIds = ensureContractProductRowIds(wizardData.products);
    const sourceProductIndex = productsWithRowIds.findIndex((product, index) =>
      (!!sourceProduct.rowId && product.rowId === sourceProduct.rowId) ||
      wizardData.products[index] === sourceProduct ||
      (product.remainingStones || []).some((stone) => stone.id === selectedRemainingStone.id)
    );

    if (sourceProductIndex < 0) {
      setErrors({ products: 'محصول منبع برای بروزرسانی پیدا نشد.' });
      return;
    }

    const canonicalSourceProduct = productsWithRowIds[sourceProductIndex];
    const sourceProductRowId = canonicalSourceProduct.rowId as string;
    const existingAllocationOrders = productsWithRowIds
      .filter((product) => product.parentProductRowId === sourceProductRowId)
      .map((product, index) => Number(product.remainingStoneAllocationOrder ?? product.meta?.remainingSource?.allocationOrder ?? index));
    const nextAllocationOrder = existingAllocationOrders.length > 0
      ? Math.max(...existingAllocationOrders) + 1
      : 0;

    const normalizedRows = partitions
      .filter(p => p.width > 0 && p.length > 0)
      .map(p => {
        const widthCm = partitionWidthUnit === 'm' ? p.width * 100 : p.width;
        const lengthM = partitionLengthUnit === 'm' ? p.length : p.length / 100;
        const quantity = Math.max(1, Math.floor(p.quantity || 1));
        const perPieceSquareMeters = (widthCm * lengthM) / 100;
        return {
          ...p,
          width: widthCm,
          length: lengthM,
          quantity,
          perPieceSquareMeters,
          squareMeters: perPieceSquareMeters * quantity
        };
      });

    if (normalizedRows.length === 0) {
      setErrors({ products: 'حداقل یک پارتیشن معتبر تعریف کنید.' });
      return;
    }

    const validation = validateRowsAgainstStock(normalizedRows, selectedRemainingStone);
    const rowErrors = validation.rowErrors;
    const stockInfo = validation.stockInfo;

    if (rowErrors.size > 0) {
      setPartitionValidationErrors(rowErrors);
      setPartitions(prev => prev.map(row => ({
        ...row,
        validationError: rowErrors.get(row.id)
      })));
      setErrors({ products: validation.summaryError || `${rowErrors.size} پارتیشن دارای مشکل است. لطفاً ابعاد را بررسی و اصلاح کنید.` });
      return;
    }

    setPartitionValidationErrors(new Map());
    setPartitions(prev => prev.map(row => ({ ...row, validationError: undefined })));

    const remainingAreas = mergeRemainingStoneCollection(
      validation.remainingAreas.filter(piece => piece.width > 0 && piece.length > 0 && (piece.quantity || 0) > 0)
    );
    const childRowIds = normalizedRows.map(() => createContractProductRowId());
    const operationCalculations = normalizedRows.map((row, index) => {
      const stored = remainingStoneConfig.operationPolicyInput;
      if (!stored) return null;
      const input: ProductOperationsInput = {
        ...stored,
        productRowId: parseStableIdentity('product-row', childRowIds[index]),
        lengthMeters: parseCanonicalDecimal(String(row.length)),
        widthMeters: parseCanonicalDecimal(String(row.width / 100)),
        quantity: row.quantity
      };
      return {
        input,
        calculation: calculateProductOperations(input)
      };
    });
    const invalidOperation = operationCalculations.find(
      item => item && !item.calculation.ok
    );
    if (invalidOperation && !invalidOperation.calculation.ok) {
      setErrors({
        products:
          invalidOperation.calculation.conflicts[0]?.message ||
          'عملیات محصول نیاز به اصلاح دارد'
      });
      return;
    }

    const cuttingCostPerMeter = sourceProduct.cuttingCostPerMeter || getCuttingTypePricePerMeter('LONG') || 0;
    const hasAnyCut = normalizedRows.some(row =>
      row.width < stockInfo.sanitized.width || row.length < stockInfo.sanitized.length
    );

    const childProducts: ContractProduct[] = normalizedRows.map((row, index) => {
      const operation = operationCalculations[index];
      const operationResult = operation?.calculation.ok
        ? operation.calculation.result
        : null;
      const operationsAmount = Number(operationResult?.totalAmountToman || 0);
      const physicalPieces = validation.physicalPiecesByRow.get(row.id) || [];
      const splitCount = physicalPieces.length;
      const wasSplit = splitCount > row.quantity;
      const widthCut = row.width < stockInfo.sanitized.width;
      const lengthCut = row.length < stockInfo.sanitized.length;
      const cuttingBreakdown = calculateRemainingChildCuttingBreakdown({
        row,
        stock: stockInfo.sanitized,
        rate: cuttingCostPerMeter
      });
      const cuttingCost = cuttingBreakdown.reduce((total, entry) => total + entry.cost, 0);
      const cutType: 'longitudinal' | 'cross' | null = lengthCut ? 'cross' : (widthCut ? 'longitudinal' : null);

      return {
        rowId: childRowIds[index],
        productId: sourceProduct.productId,
        product: sourceProduct.product,
        productType: sourceProduct.productType,
        stoneCode: `${sourceProduct.stoneCode}-R${selectedRemainingStone.id.slice(-4)}-${index + 1}`,
        stoneName:
          remainingStoneConfig.stoneName ||
          `${sourceProduct.stoneName} (از سنگ باقی‌مانده)`,
        diameterOrWidth: row.width,
        length: row.length,
        width: row.width,
        quantity: row.quantity,
        squareMeters: row.squareMeters,
        pricePerSquareMeter: 0,
        unitPrice: 0,
        totalPrice: cuttingCost + operationsAmount,
        description:
          remainingStoneConfig.description ||
          `ایجاد شده از سنگ باقی‌مانده • پارتیشن ${index + 1}${wasSplit ? ` • تقسیم فیزیکی: ${splitCount} قطعه` : ''}`,
        currency: sourceProduct.currency,
        sawKerfEnabled: remainingStoneSawKerfEnabled,
        sawKerfCm: remainingStoneSawKerfEnabled ? SAW_KERF_CM : null,
        lengthUnit: 'm',
        widthUnit: 'cm',
        isMandatory: false,
        mandatoryPercentage: 0,
        originalTotalPrice: 0,
        isCut: widthCut || lengthCut,
        cutType,
        originalWidth: stockInfo.sanitized.width,
        originalLength: stockInfo.sanitized.length,
        cuttingCost,
        physicalCuttingCost: cuttingCost,
        cuttingBreakdown,
        cuttingCostPerMeter,
        cutDescription: widthCut || lengthCut
          ? 'هزینه برش بر اساس پارتیشن سنگ باقی‌مانده محاسبه شد.'
          : 'بدون برش',
        remainingStones: [],
        cutDetails: [],
        usedRemainingStones: [],
        totalUsedRemainingWidth: 0,
        totalUsedRemainingLength: 0,
        parentProductIndex: sourceProductIndex,
        parentProductRowId: sourceProductRowId,
        remainingStoneAllocationOrder: nextAllocationOrder + index,
        operationPolicyInput: operation?.input,
        appliedSubServices: operationResult?.tools.map(tool => ({
          id: tool.toolSelectionId,
          subServiceId: tool.catalogItemId,
          subService: {
            id: tool.catalogItemId,
            code: tool.catalogItemId,
            namePersian: tool.name,
            pricePerMeter: Number(tool.rateToman),
            calculationBase: tool.unit === 'meter' ? 'length' : 'squareMeters',
            isActive: false
          },
          meter: Number(tool.finalQuantity),
          cost: Number(tool.amountToman),
          calculationBase: tool.unit === 'meter' ? 'length' : 'squareMeters',
          edges: Object.fromEntries(
            (tool.edges || []).map(edge => [edge, true])
          )
        })) || [],
        totalSubServiceCost: operationResult?.tools.reduce(
          (sum, tool) => sum + Number(tool.amountToman),
          0
        ) || 0,
        usedLengthForSubServices: operationResult?.tools
          .filter(tool => tool.unit === 'meter')
          .reduce((sum, tool) => sum + Number(tool.finalQuantity), 0) || 0,
        usedSquareMetersForSubServices: operationResult?.tools
          .filter(tool => tool.unit === 'squareMeter')
          .reduce((sum, tool) => sum + Number(tool.finalQuantity), 0) || 0,
        finishings: operationResult?.finishings.map(finishing => ({
          selectionId: finishing.finishingSelectionId,
          finishingId: finishing.catalogItemId,
          name: finishing.name,
          calculationBase:
            finishing.unit === 'meter' ? 'length' : 'squareMeters',
          unitPrice: Number(finishing.rateToman),
          automaticQuantity: Number(finishing.automaticQuantity),
          quantity: Number(finishing.finalQuantity),
          quantityMode: finishing.quantityOverride ? 'manual' : 'auto',
          overrideStatus: 'current',
          cost: Number(finishing.amountToman)
        })) || [],
        meta: {
          remainingSource: {
            sourceProductRowId,
            sourceProductIndex,
            sourceRemainingStoneId: selectedRemainingStone.id,
            sourceRemainingStone: stockInfo.sanitized,
            partitionId: row.id,
            allocationId: row.id,
            allocationOrder: nextAllocationOrder + index,
            allocatedQuantity: row.quantity,
            generatedRemainingStoneIds: remainingAreas.map(area => area.id),
            physicalPieces: physicalPieces.map(piece => ({
              width: piece.width,
              length: piece.length,
              quantity: piece.quantity,
              squareMeters: piece.squareMeters
            }))
          },
          pricing: {
            materialCost: 0,
            cuttingCost,
            operationsCost: operationsAmount,
            totalPrice: cuttingCost + operationsAmount,
            materialPricingReason: 'calculated-in-source-product'
          },
          sawKerf: remainingStoneSawKerfEnabled
            ? {
                enabled: true,
                cm: SAW_KERF_CM
              }
            : undefined
        }
      };
    });

    const sourceInventory = resolveRemainingStoneSourceInventory(canonicalSourceProduct);
    const productsForReplay = [
      ...productsWithRowIds.map((product, index) => index === sourceProductIndex
        ? { ...product, remainingStoneSourceInventory: sourceInventory }
        : product),
      ...childProducts
    ];
    const replay = replayRemainingStoneAllocations({
      products: productsForReplay,
      sourceRowId: sourceProductRowId,
      sourceInventory
    });

    if (!replay.ok) {
      setErrors({ products: formatRemainingStoneReplayConflicts(replay.conflicts) });
      return;
    }

    const warningMessage = hasAnyCut && cuttingCostPerMeter <= 0
      ? 'برش هندسی شناسایی شد اما نرخ برش در دسترس نیست؛ هزینه برش با صفر ثبت شد.'
      : undefined;

    updateWizardData({
      products: replay.products
    });

    if (warningMessage) {
      setErrors({ products: warningMessage });
    } else {
      setErrors({});
    }

    // Close modal and reset state
    setShowRemainingStoneModal(false);
    setSelectedRemainingStone(null);
    setSelectedRemainingStoneSourceProduct(null);
    setRemainingStoneConfig({});
    setPartitions([createEmptyPartition()]);
    setRemainingStoneLengthUnit('cm');
    setRemainingStoneWidthUnit('cm');
    setPartitionLengthUnit('m');
    setPartitionWidthUnit('cm');
    setRemainingStoneIsMandatory(false);
    setRemainingStoneMandatoryPercentage(20);
    setRemainingStoneSawKerfEnabled(false);
  }, [
    selectedRemainingStone,
    partitions,
    partitionWidthUnit,
    partitionLengthUnit,
    updateWizardData,
    getCuttingTypePricePerMeter,
    setErrors,
    validateRowsAgainstStock,
    resolveSourceProduct,
    remainingStoneSawKerfEnabled,
    remainingStoneConfig,
    wizardData.products
  ]);

  return {
    // Modal state
    showRemainingStoneModal,
    setShowRemainingStoneModal,

    // Selected remaining stone
    selectedRemainingStone,
    setSelectedRemainingStone,
    selectedRemainingStoneSourceProduct,
    setSelectedRemainingStoneSourceProduct,

    // Remaining stone config
    remainingStoneConfig,
    setRemainingStoneConfig,
    remainingStoneLengthUnit,
    setRemainingStoneLengthUnit,
    remainingStoneWidthUnit,
    setRemainingStoneWidthUnit,
    remainingStoneIsMandatory,
    setRemainingStoneIsMandatory,
    remainingStoneMandatoryPercentage,
    setRemainingStoneMandatoryPercentage,
    remainingStoneSawKerfEnabled,
    setRemainingStoneSawKerfEnabled,

    // Partition state
    partitions,
    setPartitions,
    partitionLengthUnit,
    setPartitionLengthUnit,
    partitionWidthUnit,
    setPartitionWidthUnit,
    partitionValidationErrors,
    setPartitionValidationErrors,

    // Handlers
    handleRemainingStoneLengthUnitChange,
    handleRemainingStoneWidthUnitChange,
    handleAddPartition,
    handleRemovePartition,
    handleUpdatePartition,
    handleAddRemainingStoneToContract
  };
};
