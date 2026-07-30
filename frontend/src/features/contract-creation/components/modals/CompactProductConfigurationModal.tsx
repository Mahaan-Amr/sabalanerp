'use client';

import React from 'react';
import { ErpInput } from '@/components/erp';
import {
  calculateLongitudinalProduct,
  calculateProductOperations,
  calculateSlab,
  createNewLongitudinalProductInput,
  parseCanonicalDecimal,
  parseStableIdentity,
  refreshProductOperationsGeometry,
  type LongitudinalProductInput,
  type ProductOperationsInput,
  type SlabPolicyInput
} from '@sabalanerp/contract-product-graph';
import type {
  ContractProduct,
  ContractUsageType,
  Product,
  StoneFinishing,
  SubService
} from '../../types/contract.types';
import { productSupportsContractType } from '../../utils/productUtils';
import {
  AutoGrowingDescription,
  CentralProductModalShell,
  CompactSegmentedControl,
  LongitudinalProductSection,
  OperationCollectionsSection,
  PreparedProductSection,
  SlabProductSection
} from '../product-modal-system';
import {
  createEmptySlabDraft,
  createSlabSourceRow
} from '../product-modal-system/slabProductState';
import { longitudinalCutRateSnapshot } from '../product-modal-system/productModalState';
import {
  useLongitudinalCalculationWorker,
  useSlabCalculationWorker
} from '../../hooks/useCanonicalProductCalculationWorker';

const POLICY_VERSION = {
  calculationPolicyVersion: 'calculation-v1',
  packingPolicyVersion: 'packing-v1',
  pricingPolicyVersion: 'pricing-v1',
  roundingPolicyVersion: 'rounding-v1'
} as const;

const centimetersToMeters = (value: number) =>
  parseCanonicalDecimal(String(value / 100));

const catalogFacts = (product: Product) => {
  const motherLength = Number(product.motherLengthValue);
  const motherWidth = Number(product.widthValue);
  const motherFacts = [
    motherLength > 0 ? `${motherLength}m` : null,
    motherWidth > 0 ? `${motherWidth}cm` : null
  ].filter(Boolean).join(' × ');
  return [
    product.namePersian,
    motherFacts ? `مادر ${motherFacts}` : null,
    Number(product.thicknessValue) > 0
      ? `ضخامت ${product.thicknessValue}cm`
      : null
  ].filter(Boolean).join(' · ');
};

const numberInUnit = (meters: string, unit: 'cm' | 'm') =>
  Number(meters) * (unit === 'cm' ? 100 : 1);

const sourceBatchId = (productId: string) =>
  parseStableIdentity('source-batch', `catalog:${productId}`);

const operationsForGeometry = ({
  current,
  productRowId,
  lengthMeters,
  widthMeters,
  quantity
}: {
  current?: ProductOperationsInput;
  productRowId: string;
  lengthMeters: string;
  widthMeters: string;
  quantity?: number;
}): ProductOperationsInput => {
  const nextLength = parseCanonicalDecimal(lengthMeters);
  const nextWidth = parseCanonicalDecimal(widthMeters);
  if (current) {
    return refreshProductOperationsGeometry({
      input: current,
      lengthMeters: nextLength,
      widthMeters: nextWidth,
      quantity
    });
  }
  return {
    policyVersion: 'calculation-v1',
    pricingPolicyVersion: 'pricing-v1',
    roundingPolicyVersion: 'rounding-v1',
    productRowId: parseStableIdentity('product-row', productRowId),
    lengthMeters: nextLength,
    widthMeters: nextWidth,
    ...(quantity === undefined ? {} : { quantity }),
    groups: [],
    tools: [],
    finishings: []
  };
};

const operationCatalogFromTools = (
  tools: readonly SubService[]
) => tools.map(tool => ({
  catalogItemId: tool.id,
  catalogSnapshotVersion: String((tool as SubService & { updatedAt?: string }).updatedAt || 'current'),
  name: tool.namePersian || tool.name || tool.code || 'ابزار',
  unit: tool.calculationBase === 'squareMeters' ? 'squareMeter' as const : 'meter' as const,
  rateToman: tool.pricePerMeter === null || tool.pricePerMeter === undefined
    ? null
    : String(tool.pricePerMeter)
}));

const operationCatalogFromFinishings = (
  finishings: readonly StoneFinishing[]
) => finishings.map(finishing => ({
  catalogItemId: finishing.id,
  catalogSnapshotVersion: String((finishing as StoneFinishing & { updatedAt?: string }).updatedAt || 'current'),
  name: finishing.namePersian || finishing.name || finishing.code || 'پرداخت',
  unit: finishing.calculationBase === 'length' ? 'meter' as const : 'squareMeter' as const,
  rateToman: (() => {
    const rate = (finishing as StoneFinishing & {
      pricePerMeter?: number | null;
      pricePerSquareMeter?: number | null;
    }).calculationBase === 'length'
      ? (finishing as StoneFinishing & { pricePerMeter?: number | null }).pricePerMeter
      : (finishing as StoneFinishing & { pricePerSquareMeter?: number | null }).pricePerSquareMeter;
    return rate === null || rate === undefined ? null : String(rate);
  })()
}));

export interface CompactProductConfigurationModalProps {
  readonly selectedProduct: Product;
  readonly currentProductType: Exclude<ContractUsageType, 'volumetric'>;
  readonly productConfig: Partial<ContractProduct>;
  readonly setProductConfig: React.Dispatch<React.SetStateAction<Partial<ContractProduct>>>;
  readonly setLengthUnit: React.Dispatch<React.SetStateAction<'cm' | 'm'>>;
  readonly setWidthUnit: React.Dispatch<React.SetStateAction<'cm' | 'm'>>;
  readonly setIsMandatory: React.Dispatch<React.SetStateAction<boolean>>;
  readonly setMandatoryPercentage: React.Dispatch<React.SetStateAction<number>>;
  readonly isEditMode: boolean;
  readonly onProductTypeChange?: (
    type: ContractUsageType,
    selectedProduct: Product | null
  ) => void;
  readonly onClose: () => void;
  readonly onSave: () => void;
  readonly getCuttingTypePricePerMeter: (code: string) => number | null;
  readonly subServices: readonly SubService[];
  readonly stoneFinishings: readonly StoneFinishing[];
  readonly error?: string;
}

export function CompactProductConfigurationModal({
  selectedProduct,
  currentProductType,
  productConfig,
  setProductConfig,
  setLengthUnit,
  setWidthUnit,
  setIsMandatory,
  setMandatoryPercentage,
  isEditMode,
  onProductTypeChange,
  onClose,
  onSave,
  getCuttingTypePricePerMeter,
  subServices,
  stoneFinishings,
  error
}: CompactProductConfigurationModalProps) {
  const [pending, setPending] = React.useState(false);
  const pendingRef = React.useRef(false);
  const [showValidation, setShowValidation] = React.useState(false);
  React.useEffect(() => {
    const root = document.documentElement;
    const scrollPosition = window.scrollY;
    const previousRootOverflow = root.style.overflow;
    const previousRootOverscrollBehavior = root.style.overscrollBehavior;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyOverscrollBehavior = document.body.style.overscrollBehavior;
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyWidth = document.body.style.width;
    root.style.overflow = 'hidden';
    root.style.overscrollBehavior = 'contain';
    document.body.style.overflow = 'hidden';
    document.body.style.overscrollBehavior = 'contain';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollPosition}px`;
    document.body.style.width = '100%';
    return () => {
      root.style.overflow = previousRootOverflow;
      root.style.overscrollBehavior = previousRootOverscrollBehavior;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.overscrollBehavior = previousBodyOverscrollBehavior;
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.width = previousBodyWidth;
      window.scrollTo(0, scrollPosition);
    };
  }, []);
  const currentOperations = productConfig.operationPolicyInput ?? operationsForGeometry({
    productRowId: productConfig.rowId || `draft:${selectedProduct.id}`,
    lengthMeters: '0',
    widthMeters: '0'
  });
  const longitudinalWorker = useLongitudinalCalculationWorker(
    currentProductType === 'longitudinal'
      ? productConfig.longitudinalPolicyInput
      : undefined
  );
  const slabWorker = useSlabCalculationWorker(
    currentProductType === 'slab'
      ? productConfig.slabPolicyInput
      : undefined
  );

  React.useEffect(() => {
    if (
      currentProductType === 'longitudinal' &&
      !productConfig.longitudinalPolicyInput
    ) {
      const longitudinalCutRate = getCuttingTypePricePerMeter('LONG');
      const empty = createNewLongitudinalProductInput({
        ...POLICY_VERSION,
        sourceBatchId: sourceBatchId(selectedProduct.id),
        motherWidthMeters: centimetersToMeters(Number(selectedProduct.widthValue) || 0),
        defaultMandatoryPercentage: parseCanonicalDecimal(
          String(productConfig.mandatoryPercentage || 20)
        ),
        sawKerfMeters: parseCanonicalDecimal('0.003'),
        ...longitudinalCutRateSnapshot(longitudinalCutRate)
      });
      const existingLengthMeters = Number(productConfig.length) > 0
        ? parseCanonicalDecimal(String(
            (productConfig.lengthUnit || 'm') === 'cm'
              ? Number(productConfig.length) / 100
              : Number(productConfig.length)
          ))
        : undefined;
      const existingWidthMeters = Number(productConfig.width) > 0
        ? parseCanonicalDecimal(String(
            (productConfig.widthUnit || 'cm') === 'cm'
              ? Number(productConfig.width) / 100
              : Number(productConfig.width)
          ))
        : undefined;
      const next: LongitudinalProductInput = isEditMode
        ? {
            ...empty,
            ...(existingLengthMeters ? { lengthMeters: existingLengthMeters } : {}),
            ...(existingWidthMeters ? { widthMeters: existingWidthMeters } : {}),
            ...(Number(productConfig.squareMeters) > 0
              ? {
                  requestedAreaSquareMeters: parseCanonicalDecimal(
                    String(productConfig.squareMeters)
                  )
                }
              : {}),
            ...(Number(productConfig.quantity) > 0
              ? { quantity: Math.trunc(Number(productConfig.quantity)) }
              : {}),
            ...(Number(productConfig.pricePerSquareMeter) > 0
              ? {
                  baseRateToman: parseCanonicalDecimal(
                    String(productConfig.pricePerSquareMeter)
                  )
                }
              : {}),
            lengthDisplayUnit: productConfig.lengthUnit || 'm',
            widthDisplayUnit: productConfig.widthUnit || 'cm',
            mandatoryEnabled: Boolean(productConfig.isMandatory),
            mandatoryPercentage: parseCanonicalDecimal(
              String(productConfig.mandatoryPercentage || 20)
            ),
            rememberedMandatoryPercentage: parseCanonicalDecimal(
              String(productConfig.mandatoryPercentage || 20)
            ),
            sawKerfEnabled: Boolean(productConfig.sawKerfEnabled),
            calibrationEnabled: Boolean(productConfig.calibrationCutEnabled),
            calibrationSelection: 'manual'
          }
        : empty;
      setProductConfig(previous => ({
        ...previous,
        ...(!isEditMode
          ? {
              width: Number(selectedProduct.widthValue) || undefined,
              widthUnit: 'cm' as const,
              lengthUnit: 'm' as const,
              pricePerSquareMeter: undefined
            }
          : {}),
        longitudinalPolicyInput: next
      }));
    }
    if (currentProductType === 'slab' && !productConfig.slabPolicyInput) {
      const longitudinalRate = getCuttingTypePricePerMeter('LONG');
      const crossRate = getCuttingTypePricePerMeter('CROSS');
      const next = createEmptySlabDraft({
        ...POLICY_VERSION,
        sourceBatchId: sourceBatchId(selectedProduct.id),
        kerfMeters: parseCanonicalDecimal(
          isEditMode && productConfig.sawKerfEnabled ? '0.003' : '0'
        )
      });
      const sourceRows = (productConfig.slabStandardDimensions || []).map(
        (row, index) => ({
          ...createSlabSourceRow({
            sourceRowId: parseStableIdentity(
              'slab-source-row',
              row.id || `legacy:${selectedProduct.id}:${index}`
            )
          }),
          lengthMeters: centimetersToMeters(Number(row.standardLengthCm) || 0),
          widthMeters: centimetersToMeters(Number(row.standardWidthCm) || 0),
          quantity: Number(row.quantity) || 0
        })
      );
      const editSlab: SlabPolicyInput = {
        ...next,
        ...(isEditMode && Number(productConfig.length) > 0
          ? {
              lengthMeters: parseCanonicalDecimal(String(
                (productConfig.lengthUnit || 'm') === 'cm'
                  ? Number(productConfig.length) / 100
                  : Number(productConfig.length)
              ))
            }
          : {}),
        ...(isEditMode && Number(productConfig.width) > 0
          ? {
              widthMeters: parseCanonicalDecimal(String(
                (productConfig.widthUnit || 'cm') === 'cm'
                  ? Number(productConfig.width) / 100
                  : Number(productConfig.width)
              ))
            }
          : {}),
        ...(isEditMode && Number(productConfig.squareMeters) > 0
          ? {
              areaSquareMeters: parseCanonicalDecimal(
                String(productConfig.squareMeters)
              )
            }
          : {}),
        ...(isEditMode && Number(productConfig.quantity) > 0
          ? { quantity: Math.trunc(Number(productConfig.quantity)) }
          : {}),
        ...(isEditMode && Number(productConfig.pricePerSquareMeter) > 0
          ? {
              baseMaterialRateToman: parseCanonicalDecimal(
                String(productConfig.pricePerSquareMeter)
              )
            }
          : {}),
        lengthDisplayUnit: productConfig.lengthUnit || 'm',
        widthDisplayUnit: productConfig.widthUnit || 'm',
        sourceRows,
        cuttingPricingMethod:
          productConfig.slabCuttingMode === 'perSquareMeter'
            ? 'squareMeter'
            : 'lineBased',
        ...(Number(productConfig.slabCuttingPricePerSquareMeter) > 0
          ? {
              squareMeterCutRateToman: parseCanonicalDecimal(
                String(productConfig.slabCuttingPricePerSquareMeter)
              )
            }
          : {})
      };
      setProductConfig(previous => ({
        ...previous,
        ...(!isEditMode
          ? {
              length: undefined,
              width: undefined,
              quantity: undefined,
              squareMeters: undefined,
              pricePerSquareMeter: undefined
            }
          : {}),
        slabPolicyInput: {
          ...editSlab,
          ...(longitudinalRate === null
            ? {}
            : { longitudinalCutRateToman: parseCanonicalDecimal(String(longitudinalRate)) }),
          ...(crossRate === null
            ? {}
            : { crossCutRateToman: parseCanonicalDecimal(String(crossRate)) })
        }
      }));
    }
  }, [
    currentProductType,
    getCuttingTypePricePerMeter,
    productConfig.longitudinalPolicyInput,
    productConfig.mandatoryPercentage,
    productConfig.slabPolicyInput,
    productConfig.slabStandardDimensions,
    productConfig.length,
    productConfig.width,
    productConfig.quantity,
    productConfig.squareMeters,
    productConfig.pricePerSquareMeter,
    productConfig.lengthUnit,
    productConfig.widthUnit,
    productConfig.isMandatory,
    productConfig.sawKerfEnabled,
    productConfig.calibrationCutEnabled,
    productConfig.slabCuttingMode,
    productConfig.slabCuttingPricePerSquareMeter,
    isEditMode,
    selectedProduct.id,
    selectedProduct.widthValue,
    setProductConfig
  ]);

  React.useEffect(() => {
    if (currentProductType !== 'longitudinal') return;
    const input = productConfig.longitudinalPolicyInput;
    if (!input) return;
    if (
      input.longitudinalCutRateToman !== undefined &&
      input.calibrationCutRateToman !== undefined
    ) return;
    const snapshot = input.longitudinalCutRateToman === undefined
      ? longitudinalCutRateSnapshot(getCuttingTypePricePerMeter('LONG'))
      : {
          longitudinalCutRateToman: input.longitudinalCutRateToman,
          calibrationCutRateToman: input.longitudinalCutRateToman
        };
    if (snapshot.longitudinalCutRateToman === undefined) return;
    setProductConfig(previous => {
      const current = previous.longitudinalPolicyInput;
      if (!current) return previous;
      if (
        current.longitudinalCutRateToman !== undefined &&
        current.calibrationCutRateToman !== undefined
      ) return previous;
      return {
        ...previous,
        longitudinalPolicyInput: {
          ...current,
          ...snapshot
        }
      };
    });
  }, [
    currentProductType,
    getCuttingTypePricePerMeter,
    productConfig.longitudinalPolicyInput,
    setProductConfig
  ]);

  const updateLongitudinal = (input: LongitudinalProductInput) => {
    setLengthUnit(input.lengthDisplayUnit);
    setWidthUnit(input.widthDisplayUnit);
    setIsMandatory(input.mandatoryEnabled);
    setMandatoryPercentage(Number(input.mandatoryPercentage));
    setProductConfig(previous => ({
      ...previous,
      longitudinalPolicyInput: input,
      lengthUnit: input.lengthDisplayUnit,
      widthUnit: input.widthDisplayUnit,
      width: input.widthMeters === undefined
        ? undefined
        : numberInUnit(input.widthMeters, input.widthDisplayUnit),
      length: input.lengthMeters === undefined
        ? undefined
        : numberInUnit(input.lengthMeters, input.lengthDisplayUnit),
      quantity: input.quantity,
      squareMeters: input.requestedAreaSquareMeters === undefined
        ? undefined
        : Number(input.requestedAreaSquareMeters),
      pricePerSquareMeter: input.baseRateToman === undefined
        ? undefined
        : Number(input.baseRateToman),
      isMandatory: input.mandatoryEnabled,
      mandatoryPercentage: Number(input.mandatoryPercentage),
      sawKerfEnabled: input.sawKerfEnabled,
      sawKerfCm: input.sawKerfEnabled ? Number(input.sawKerfMeters) * 100 : null,
      calibrationCutEnabled: input.calibrationEnabled
    }));
  };

  const updateSlab = (input: SlabPolicyInput) => {
    setLengthUnit(input.lengthDisplayUnit);
    setWidthUnit(input.widthDisplayUnit);
    setProductConfig(previous => ({
      ...previous,
      slabPolicyInput: input,
      lengthUnit: input.lengthDisplayUnit,
      widthUnit: input.widthDisplayUnit,
      length: input.lengthMeters === undefined
        ? undefined
        : numberInUnit(input.lengthMeters, input.lengthDisplayUnit),
      width: input.widthMeters === undefined
        ? undefined
        : numberInUnit(input.widthMeters, input.widthDisplayUnit),
      quantity: input.quantity,
      squareMeters: input.areaSquareMeters === undefined
        ? undefined
        : Number(input.areaSquareMeters),
      pricePerSquareMeter: input.baseMaterialRateToman === undefined
        ? undefined
        : Number(input.baseMaterialRateToman),
      slabCuttingMode: input.cuttingPricingMethod === 'squareMeter'
        ? 'perSquareMeter'
        : 'lineBased',
      slabCuttingPricePerSquareMeter: input.squareMeterCutRateToman === undefined
        ? undefined
        : Number(input.squareMeterCutRateToman),
      sawKerfEnabled: Number(input.kerfMeters) > 0,
      sawKerfCm: Number(input.kerfMeters) > 0
        ? Number(input.kerfMeters) * 100
        : null,
      slabStandardDimensions: input.sourceRows.map(row => ({
        id: row.sourceRowId,
        standardLengthCm: Number(row.lengthMeters) * 100,
        standardWidthCm: Number(row.widthMeters) * 100,
        quantity: row.quantity
      }))
    }));
  };

  React.useEffect(() => {
    const calculation = longitudinalWorker.calculation;
    const input = productConfig.longitudinalPolicyInput;
    if (!input || !calculation?.ok) return;
    setProductConfig(previous => {
      if (previous.longitudinalPolicyInput !== input) return previous;
      return {
        ...previous,
        length: numberInUnit(
          calculation.result.lengthMeters,
          input.lengthDisplayUnit
        ),
        width: numberInUnit(
          calculation.result.widthMeters,
          input.widthDisplayUnit
        ),
        squareMeters: Number(calculation.result.requestedAreaSquareMeters),
        quantity: calculation.result.quantity,
        calibrationCutEnabled: calculation.result.calibrationEnabled,
        totalPrice: Number(calculation.result.totalAmountToman),
        operationPolicyInput: operationsForGeometry({
          current: previous.operationPolicyInput,
          productRowId: previous.rowId || `draft:${selectedProduct.id}`,
          lengthMeters: calculation.result.lengthMeters,
          widthMeters: calculation.result.widthMeters,
          quantity: calculation.result.quantity
        })
      };
    });
  }, [
    longitudinalWorker.calculation,
    productConfig.longitudinalPolicyInput,
    selectedProduct.id,
    setProductConfig
  ]);

  React.useEffect(() => {
    const calculation = slabWorker.calculation;
    const input = productConfig.slabPolicyInput;
    if (!input || !calculation?.ok) return;
    setProductConfig(previous => {
      if (previous.slabPolicyInput !== input) return previous;
      return {
        ...previous,
        length: numberInUnit(
          calculation.result.lengthMeters,
          input.lengthDisplayUnit
        ),
        width: numberInUnit(
          calculation.result.widthMeters,
          input.widthDisplayUnit
        ),
        quantity: calculation.result.quantity,
        squareMeters: Number(calculation.result.finishedAreaSquareMeters),
        totalPrice: Number(calculation.result.totalAmountToman),
        operationPolicyInput: operationsForGeometry({
          current: previous.operationPolicyInput,
          productRowId: previous.rowId || `draft:${selectedProduct.id}`,
          lengthMeters: calculation.result.lengthMeters,
          widthMeters: calculation.result.widthMeters,
          quantity: calculation.result.quantity
        })
      };
    });
  }, [
    productConfig.slabPolicyInput,
    selectedProduct.id,
    setProductConfig,
    slabWorker.calculation
  ]);

  const updateOperations = (input: ProductOperationsInput) => {
    setProductConfig(previous => ({
      ...previous,
      operationPolicyInput: input
    }));
  };

  const facts = catalogFacts(selectedProduct);
  const title = isEditMode ? 'ویرایش تنظیمات محصول' : 'تنظیمات محصول';
  const focusValidationTarget = (id: string) => {
    requestAnimationFrame(() => {
      const target = document.getElementById(id);
      target?.focus();
      target?.scrollIntoView({
        block: 'center',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth'
      });
    });
  };
  const validateDraft = () => {
    if (
      currentProductType === 'longitudinal' &&
      productConfig.longitudinalPolicyInput
    ) {
      const result = calculateLongitudinalProduct(
        productConfig.longitudinalPolicyInput
      );
      if (!result.ok) {
        setShowValidation(true);
        const missingLongRate = result.conflicts.some(conflict =>
          conflict.code === 'longitudinal-cut-rate-missing' ||
          conflict.code === 'calibration-cut-rate-missing'
        );
        const first = result.conflicts[0]?.field;
        focusValidationTarget(
          missingLongRate
            ? 'longitudinal-cut-rate-error'
            : first === 'baseRateToman'
            ? 'longitudinal-base-rate'
            : first === 'widthMeters'
              ? 'longitudinal-width'
              : 'longitudinal-length'
        );
        return false;
      }
    }
    if (currentProductType === 'slab' && productConfig.slabPolicyInput) {
      const result = calculateSlab(productConfig.slabPolicyInput);
      if (!result.ok) {
        setShowValidation(true);
        const first = result.conflicts[0]?.field;
        focusValidationTarget(
          first === 'quantity'
            ? 'slab-quantity'
            : first === 'baseMaterialRateToman'
              ? 'slab-base-rate'
              : first === 'squareMeterCutRateToman'
                ? 'slab-square-meter-cut-rate'
                : 'slab-length'
        );
        return false;
      }
    }
    if (currentProductType !== 'prepared' && currentOperations) {
      const result = calculateProductOperations(currentOperations);
      if (!result.ok) {
        setShowValidation(true);
        requestAnimationFrame(() => {
          const target =
            document.querySelector<HTMLElement>('[data-operation-conflict="true"]') ||
            document.getElementById('product-operations');
          target?.scrollIntoView({
            block: 'center',
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
              ? 'auto'
              : 'smooth'
          });
          target?.focus({ preventScroll: true });
        });
        return false;
      }
    }
    return true;
  };

  return (
    <CentralProductModalShell
      open
      title={title}
      view="main"
      onClose={onClose}
      primaryLabel={isEditMode ? 'ذخیره تغییرات' : 'افزودن محصول'}
      pendingLabel="در حال ذخیره…"
      pending={pending}
      error={error}
      onPrimary={() => {
        if (pendingRef.current) return;
        if (!validateDraft()) return;
        pendingRef.current = true;
        setPending(true);
        try {
          onSave();
        } finally {
          queueMicrotask(() => {
            pendingRef.current = false;
            setPending(false);
          });
        }
      }}
    >
        <div className="px-0 py-0 sm:px-2">
          <div className="flex min-h-10 items-center justify-between gap-3 border-b border-[var(--sds-border-default)] pb-3 border-[var(--sds-border-subtle)]">
            <span className="text-xs font-semibold text-[var(--sds-text-muted)]">نوع محصول</span>
            {isEditMode ? (
              <strong className="text-sm">
                {currentProductType === 'longitudinal'
                  ? 'طولی'
                  : currentProductType === 'slab'
                    ? 'اسلب'
                    : 'آماده'}
              </strong>
            ) : (
              <CompactSegmentedControl
                label="نوع محصول"
                value={currentProductType}
                options={[
                  { value: 'longitudinal', label: 'طولی' },
                  { value: 'stair', label: 'پله' },
                  { value: 'slab', label: 'اسلب' },
                  { value: 'prepared', label: 'آماده' }
                ].map(option => ({
                  ...option,
                  disabled: !productSupportsContractType(
                    selectedProduct,
                    option.value as ContractUsageType
                  )
                }))}
                onChange={type => onProductTypeChange?.(
                  type as ContractUsageType,
                  selectedProduct
                )}
              />
            )}
          </div>

          {currentProductType === 'prepared' ? (
            <PreparedProductSection
              product={selectedProduct}
              config={productConfig}
              catalogFactLine={facts}
              onChange={setProductConfig}
            />
          ) : (
            <>
              <div className="border-b border-[var(--sds-border-default)] py-3 text-xs text-[var(--sds-text-muted)] border-[var(--sds-border-subtle)]">
                {facts}
              </div>
              <label className="block border-b border-[var(--sds-border-default)] py-3 text-xs font-semibold border-[var(--sds-border-subtle)]">
                عنوان محصول
                <ErpInput
                  value={productConfig.stoneName || selectedProduct.namePersian || ''}
                  onChange={event => setProductConfig(previous => ({
                    ...previous,
                    stoneName: event.target.value
                  }))}
                  className="mt-1 min-h-10 w-full rounded-lg border border-[var(--sds-border-default)] bg-transparent px-3 text-sm font-normal outline-none focus:border-[var(--sds-accent)] border-[var(--sds-border-default)]"
                />
              </label>

              {currentProductType === 'longitudinal' &&
                productConfig.longitudinalPolicyInput && (
                  <LongitudinalProductSection
                    input={productConfig.longitudinalPolicyInput}
                    onChange={updateLongitudinal}
                    showValidation={showValidation}
                    calculation={longitudinalWorker.calculation}
                    calculating={longitudinalWorker.calculating}
                  />
                )}
              {currentProductType === 'slab' && productConfig.slabPolicyInput && (
                <SlabProductSection
                  input={productConfig.slabPolicyInput}
                  onChange={updateSlab}
                  showValidation={showValidation}
                  calculation={slabWorker.calculation}
                  calculating={slabWorker.calculating}
                  createSourceIdentity={() =>
                    parseStableIdentity('slab-source-row', crypto.randomUUID())}
                />
              )}

              <label className="block border-t border-[var(--sds-border-default)] py-3 text-xs font-semibold border-[var(--sds-border-subtle)]">
                توضیحات
                <AutoGrowingDescription
                  value={productConfig.description || ''}
                  onChange={event => setProductConfig(previous => ({
                    ...previous,
                    description: event.target.value
                  }))}
                  className="mt-1"
                />
              </label>

              <div id="product-operations" tabIndex={-1}>
                <OperationCollectionsSection
                  input={currentOperations}
                  onChange={updateOperations}
                  loadTools={async () => operationCatalogFromTools(subServices)}
                  loadFinishings={async () =>
                    operationCatalogFromFinishings(stoneFinishings)}
                />
              </div>
            </>
          )}
        </div>
    </CentralProductModalShell>
  );
}
