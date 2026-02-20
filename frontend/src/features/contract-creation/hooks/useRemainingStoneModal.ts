// useRemainingStoneModal Hook
// Manages remaining stone modal state and handlers

import { useState, useCallback } from 'react';
import type {
  RemainingStone,
  ContractProduct,
  StonePartition,
  ContractWizardData
} from '../types/contract.types';
import { calculateRemainingAreasAfterPartitions } from '../services/stoneCuttingService';
import { recalculateUsedRemainingDimensions } from '../utils/dimensionUtils';
import {
  isUsableRemainingStone,
  mergeRemainingStoneCollection,
  normalizeRemainingStoneCollection,
  sanitizeRemainingStoneEntry
} from '../utils/remainingStoneGuards';

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
  const [showRemainingStoneCAD, setShowRemainingStoneCAD] = useState(false);

  // Selected remaining stone
  const [selectedRemainingStone, setSelectedRemainingStone] = useState<RemainingStone | null>(null);
  const [selectedRemainingStoneSourceProduct, setSelectedRemainingStoneSourceProduct] = useState<ContractProduct | null>(null);

  // Remaining stone config
  const [remainingStoneConfig, setRemainingStoneConfig] = useState<Partial<ContractProduct>>({});
  const [remainingStoneLengthUnit, setRemainingStoneLengthUnit] = useState<'cm' | 'm'>('m');
  const [remainingStoneWidthUnit, setRemainingStoneWidthUnit] = useState<'cm' | 'm'>('cm');
  const [remainingStoneIsMandatory, setRemainingStoneIsMandatory] = useState(false);
  const [remainingStoneMandatoryPercentage, setRemainingStoneMandatoryPercentage] = useState(20);

  // Partition state
  const [partitions, setPartitions] = useState<StonePartition[]>([]);
  const [partitionLengthUnit, setPartitionLengthUnit] = useState<'cm' | 'm'>('m');
  const [partitionWidthUnit, setPartitionWidthUnit] = useState<'cm' | 'm'>('cm');
  const [partitionValidationErrors, setPartitionValidationErrors] = useState<Map<string, string>>(new Map());

  const normalizeRemainingStock = useCallback((remainingStone: RemainingStone) => {
    const sanitized = sanitizeRemainingStoneEntry(remainingStone);
    const pieceArea = (sanitized.width * sanitized.length) / 100;
    const quantity = isUsableRemainingStone(sanitized) ? Math.max(1, Math.floor(Number(sanitized.quantity) || 1)) : 0;
    const totalSquareMeters =
      quantity > 0
        ? pieceArea * quantity
        : 0;
    return {
      sanitized,
      quantity,
      pieceArea,
      totalSquareMeters
    };
  }, []);

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
    const stockInfo = normalizeRemainingStock(remainingStone);
    const rowErrors = new Map<string, string>();

    if (!isUsableRemainingStone(stockInfo.sanitized)) {
      rows.forEach(row => {
        rowErrors.set(row.id, 'این سنگ باقی‌مانده قابل استفاده نیست یا موجودی آن به پایان رسیده است.');
      });
      return {
        stockInfo,
        rowErrors,
        summaryError: 'سنگ باقی‌مانده انتخاب‌شده قابل استفاده نیست.'
      };
    }

    rows.forEach(row => {
      if (row.width > stockInfo.sanitized.width) {
        rowErrors.set(row.id, `عرض (${row.width}) از عرض باقی‌مانده (${stockInfo.sanitized.width}) بیشتر است.`);
      } else if (row.length > stockInfo.sanitized.length) {
        rowErrors.set(row.id, `طول (${row.length}) از طول باقی‌مانده (${stockInfo.sanitized.length}) بیشتر است.`);
      }
    });

    const totalRequestedPieces = rows.reduce((sum, row) => sum + row.quantity, 0);
    const totalRequestedSquareMeters = rows.reduce((sum, row) => sum + row.squareMeters, 0);

    if (totalRequestedPieces > stockInfo.quantity) {
      rows.forEach(row => {
        if (!rowErrors.has(row.id)) {
          rowErrors.set(
            row.id,
            `تعداد درخواستی از موجودی سنگ باقی‌مانده بیشتر است (درخواست: ${totalRequestedPieces}، موجودی: ${stockInfo.quantity}).`
          );
        }
      });
    }

    if (totalRequestedSquareMeters > stockInfo.totalSquareMeters + 0.0001) {
      rows.forEach(row => {
        if (!rowErrors.has(row.id)) {
          rowErrors.set(
            row.id,
            `مجموع متر مربع پارتیشن‌ها (${totalRequestedSquareMeters.toFixed(3)}) از ظرفیت باقی‌مانده (${stockInfo.totalSquareMeters.toFixed(3)}) بیشتر است.`
          );
        }
      });
    }

    return {
      stockInfo,
      rowErrors,
      summaryError: rowErrors.size > 0
        ? `${rowErrors.size} پارتیشن دارای مشکل است. لطفاً ابعاد را بررسی و اصلاح کنید.`
        : ''
    };
  }, [normalizeRemainingStock]);

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

    const sourceProductIndex = wizardData.products.findIndex(p =>
      p.stoneCode === sourceProduct.stoneCode &&
      p.productId === sourceProduct.productId &&
      p.productType === sourceProduct.productType
    );

    if (sourceProductIndex < 0) {
      setErrors({ products: 'محصول منبع برای بروزرسانی پیدا نشد.' });
      return;
    }

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
    const totalRequestedPieces = normalizedRows.reduce((sum, row) => sum + row.quantity, 0);

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

    const remainingAreasRaw: RemainingStone[] = normalizedRows.flatMap((row, index) => {
      const perPieceRemaining = calculateRemainingAreasAfterPartitions(
        [{
          id: `${row.id}_single`,
          width: row.width,
            length: row.length,
            quantity: 1,
            squareMeters: row.perPieceSquareMeters
          }],
        stockInfo.sanitized.width,
        stockInfo.sanitized.length
      );

      return perPieceRemaining.map((piece, pieceIndex) => ({
        ...piece,
        id: `remaining_child_${Date.now()}_${index}_${pieceIndex}`,
        quantity: row.quantity,
        squareMeters: piece.squareMeters * row.quantity
      }));
    });

    const remainingAreas = mergeRemainingStoneCollection(
      remainingAreasRaw.filter(piece => piece.width > 0 && piece.length > 0 && (piece.quantity || 0) > 0)
    );

    const cuttingCostPerMeter = sourceProduct.cuttingCostPerMeter || getCuttingTypePricePerMeter('LONG') || 0;
    const hasAnyCut = normalizedRows.some(row =>
      row.width < stockInfo.sanitized.width || row.length < stockInfo.sanitized.length
    );

    const seed = Date.now();
    const childProducts: ContractProduct[] = normalizedRows.map((row, index) => {
      const widthCut = row.width < stockInfo.sanitized.width;
      const lengthCut = row.length < stockInfo.sanitized.length;
      const cutMetersPerPiece = (widthCut ? row.length : 0) + (lengthCut ? row.width / 100 : 0);
      const totalCuttingMeters = cutMetersPerPiece * row.quantity;
      const cuttingCost = cuttingCostPerMeter > 0 ? totalCuttingMeters * cuttingCostPerMeter : 0;
      const cutType: 'longitudinal' | 'cross' | null = lengthCut ? 'cross' : (widthCut ? 'longitudinal' : null);

      return {
        productId: sourceProduct.productId,
        product: sourceProduct.product,
        productType: sourceProduct.productType,
        stoneCode: `${sourceProduct.stoneCode}-R${selectedRemainingStone.id.slice(-4)}-${index + 1}`,
        stoneName: `${sourceProduct.stoneName} (از سنگ باقی‌مانده)`,
        diameterOrWidth: row.width,
        length: row.length,
        width: row.width,
        quantity: row.quantity,
        squareMeters: row.squareMeters,
        pricePerSquareMeter: 0,
        unitPrice: 0,
        totalPrice: cuttingCost,
        description: `ایجاد شده از سنگ باقی‌مانده • پارتیشن ${index + 1}`,
        currency: sourceProduct.currency,
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
        appliedSubServices: [],
        totalSubServiceCost: 0,
        usedLengthForSubServices: 0,
        usedSquareMetersForSubServices: 0,
        meta: {
          ...(sourceProduct.meta || {}),
          remainingSource: {
            sourceProductIndex,
            sourceRemainingStoneId: selectedRemainingStone.id,
            partitionId: row.id,
            allocatedQuantity: row.quantity
          },
          pricing: {
            materialCost: 0,
            cuttingCost,
            totalPrice: cuttingCost
          }
        }
      };
    });

    const consumedFromRemaining: RemainingStone[] = normalizedRows.map((row, index) => {
      const widthCut = row.width < stockInfo.sanitized.width;
      const lengthCut = row.length < stockInfo.sanitized.length;
      return {
        id: `used_partition_${seed}_${row.id}`,
        width: row.width,
        length: row.length,
        squareMeters: row.squareMeters,
        isAvailable: false,
        sourceCutId: stockInfo.sanitized.sourceCutId,
        quantity: row.quantity,
        cutType: lengthCut ? 'cross' : (widthCut ? 'longitudinal' : null),
        cuttingCostPerMeter,
        cuttingCost: childProducts[index]?.cuttingCost || 0
      };
    });

    const updatedProducts = wizardData.products.map((product, idx) => {
      if (idx !== sourceProductIndex) return product;

      const currentRemaining = (product.remainingStones || []).filter(rs => rs.id !== selectedRemainingStone.id);
      const remainingQuantityAfterUse = Math.max(0, stockInfo.quantity - totalRequestedPieces);
      const retainedSourceStone: RemainingStone[] = remainingQuantityAfterUse > 0
        ? [{
            ...stockInfo.sanitized,
            quantity: remainingQuantityAfterUse,
            squareMeters: stockInfo.pieceArea > 0
              ? stockInfo.pieceArea * remainingQuantityAfterUse
              : stockInfo.sanitized.squareMeters
          }]
        : [];
      const updatedUsedStones = [
        ...(product.usedRemainingStones || []),
        ...consumedFromRemaining
      ];
      const recalculated = recalculateUsedRemainingDimensions(updatedUsedStones);

      return {
        ...product,
        usedRemainingStones: updatedUsedStones,
        remainingStones: normalizeRemainingStoneCollection([
          ...currentRemaining,
          ...retainedSourceStone,
          ...remainingAreas.map(area => ({
            ...area,
            sourceCutId: stockInfo.sanitized.sourceCutId
          }))
        ]),
        totalUsedRemainingWidth: recalculated.totalUsedWidth,
        totalUsedRemainingLength: recalculated.totalUsedLength
      };
    });

    const warningMessage = hasAnyCut && cuttingCostPerMeter <= 0
      ? 'برش هندسی شناسایی شد اما نرخ برش در دسترس نیست؛ هزینه برش با صفر ثبت شد.'
      : undefined;

    updateWizardData({
      products: [...updatedProducts, ...childProducts]
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
  }, [
    selectedRemainingStone,
    partitions,
    partitionWidthUnit,
    partitionLengthUnit,
    updateWizardData,
    getCuttingTypePricePerMeter,
    setErrors,
    validateRowsAgainstStock,
    resolveSourceProduct
  ]);

  return {
    // Modal state
    showRemainingStoneModal,
    setShowRemainingStoneModal,
    showRemainingStoneCAD,
    setShowRemainingStoneCAD,

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
