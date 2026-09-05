'use client';

import React from 'react';
import { useProductPricingVisibility } from './productPricingVisibility';
import type {
  CanonicalLayerCalculationRequest
} from '../../services/stairCalculationService';
import {
  formatCanonicalLayerConflict
} from '../../services/stairCalculationService';
import {
  useStairLayerCalculationWorker
} from '../../hooks/useStairLayerCalculationWorker';
import {
  getPersianOperationEdgeLabel
} from '../../services/operationCollectionPresentation';
import { ReservedRowsSkeleton } from './productModalPrimitives';
import { formatPrice } from '@/lib/numberFormat';
import type { StairLayerTechnicalCalculation } from '@sabalanerp/contract-product-graph';

const number = (value: string | number) =>
  new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 6 }).format(
    Number(value)
  );

export function CanonicalStairLayerSummary({
  request, technical
}: { request: CanonicalLayerCalculationRequest | undefined; technical?: never } | {
  request?: never;
  technical: { inputRevision: number; layerConfigurationId: string;
    calculation: StairLayerTechnicalCalculation | null; calculating: boolean };
}) {
  const pricingVisible = useProductPricingVisibility();
  const showPricing = pricingVisible && !technical;
  const workerState = useStairLayerCalculationWorker(request);
  const candidate = technical?.calculation;
  const matches = candidate && technical &&
    (candidate.ok ? candidate.result.inputRevision : candidate.inputRevision) === technical.inputRevision &&
    (!candidate.result || candidate.result.layerConfigurationId === technical.layerConfigurationId);
  const current = matches ? candidate : null;
  const lastValid = React.useRef<{ id: string; calculation: StairLayerTechnicalCalculation } | null>(null);
  React.useEffect(() => {
    if (technical && current?.ok) lastValid.current = { id: technical.layerConfigurationId, calculation: current };
    else if (!technical || lastValid.current?.id !== technical.layerConfigurationId) lastValid.current = null;
  }, [current, technical]);
  const state = technical ? {
    calculation: current ?? (technical.calculating && lastValid.current?.id === technical.layerConfigurationId
      ? lastValid.current.calculation : null),
    calculating: technical.calculating, error: !technical.calculating && !current,
  } : workerState;
  const calculation = state.calculation;
  const result = calculation && 'result' in calculation ? calculation.result : undefined;
  const pricedResult = !technical && calculation?.ok && 'totalAmountToman' in calculation.result
    ? calculation.result : undefined;

  return (
    <section
      id="stair-layer-calculation-summary"
      tabIndex={-1}
      aria-busy={state.calculating}
      className="divide-y divide-[var(--sds-border-default)] border-y border-[var(--sds-border-default)] text-xs dark:divide-[var(--sds-border-default)] dark:border-[var(--sds-border-default)]"
    >
      <div className="py-2 font-semibold">خلاصه محاسبه لایه</div>
      {technical && calculation && !calculation.ok && result && (
        <div className="py-2 text-[var(--sds-danger)]">
          {formatCanonicalLayerConflict(calculation.conflicts[0])}
        </div>
      )}
      {state.calculating && calculation ? (
        <span className="sr-only" role="status">در حال به‌روزرسانی محاسبات</span>
      ) : null}
      {state.calculating && !calculation ? (
        <ReservedRowsSkeleton rows={6} />
      ) : state.error ? (
        <div className="py-2 text-[var(--sds-danger)] dark:text-[var(--sds-danger)]">
          محاسبات نیاز به به‌روزرسانی دارد
        </div>
      ) : calculation && !calculation.ok && !result ? (
        <div className="py-2 text-[var(--sds-danger)] dark:text-[var(--sds-danger)]">
          {formatCanonicalLayerConflict(calculation.conflicts[0])}
        </div>
      ) : result ? (
        <>
          <div className="flex justify-between gap-3 py-1.5">
            <span>لایه</span>
            <strong>{number(result.commercialLayerSets)} مجموعه</strong>
          </div>
          <div className="flex justify-between gap-3 py-1.5">
            <span>قطعات تولید</span>
            <strong>
              {result.physicalStrips.map(strip =>
                `${getPersianOperationEdgeLabel(strip.side)} ${number(strip.quantity)} × ${number(strip.lengthMeters)}m`
              ).join(' · ')}
            </strong>
          </div>
          <div className="flex justify-between gap-3 py-1.5">
            <span>منبع مصرفی</span>
            <strong>
              {number(result.packingPlan.consumedSources.length)} قطعه
            </strong>
          </div>
          <div className="flex justify-between gap-3 py-1.5">
            <span>باقی‌مانده پرداخت‌شده</span>
            <strong>
              {number(result.materialSourceSplit.paidSourceCount)} قطعه
              {' · '}
              {number(result.materialSourceSplit.paidMaterialSquareMeters)} m²
              {showPricing && pricedResult && <> · {formatPrice(pricedResult.materialSourceSplit.paidMaterialAmountToman)}</>}
            </strong>
          </div>
          <div className="flex justify-between gap-3 py-1.5">
            <span>سنگ تازه برای کسری</span>
            <strong>
              {number(result.materialSourceSplit.newSourceCount)} قطعه
              {' · '}
              {number(result.materialSourceSplit.newMaterialSquareMeters)} m²
              {showPricing && pricedResult && <> · {formatPrice(pricedResult.materialSourceSplit.newMaterialAmountToman)}</>}
            </strong>
          </div>
          <div className="flex justify-between gap-3 py-1.5">
            <span>برش</span>
            <strong>
              طولی {number(result.packingPlan.longitudinalCutMeters)}m ·
              عرضی {number(result.packingPlan.crossCutMeters)}m ·
              کالیبر {number(result.packingPlan.calibrationMeters)}m
            </strong>
          </div>
          {showPricing && pricedResult?.cuttingPricingLines.map(line => {
            const direction = line.lineId.endsWith(':longitudinal')
              ? 'طولی'
              : line.lineId.endsWith(':cross')
                ? 'عرضی'
                : 'کالیبر';
            return (
              <div
                key={line.lineId}
                className="flex justify-between gap-3 py-1.5"
              >
                <span>هزینه برش {direction}</span>
                <strong>
                  {number(line.quantity)}m × {formatPrice(line.rateToman)}
                  {' = '}
                  {formatPrice(line.amountToman)}
                </strong>
              </div>
            );
          })}
          <div className="flex justify-between gap-3 py-1.5">
            <span>باقی‌مانده</span>
            <strong>
              {number(result.generatedRemainders.length)} قطعه
            </strong>
          </div>
          {showPricing && <div className="flex justify-between gap-3 py-1.5">
            <span>جمع</span>
            <strong>{pricedResult && formatPrice(pricedResult.totalAmountToman)}</strong>
          </div>}
        </>
      ) : (
        <div className="py-2 text-[var(--sds-text-muted)]">—</div>
      )}
    </section>
  );
}
