'use client';

import React from 'react';
import type {
  CanonicalLayerCalculationRequest
} from '../../services/stairCalculationService';
import {
  formatCanonicalLayerConflict
} from '../../services/stairCalculationService';
import {
  useStairLayerCalculationWorker
} from '../../hooks/useStairLayerCalculationWorker';
import { ReservedRowsSkeleton } from './productModalPrimitives';

const number = (value: string | number) =>
  new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 6 }).format(
    Number(value)
  );

export function CanonicalStairLayerSummary({
  request
}: {
  request: CanonicalLayerCalculationRequest | undefined;
}) {
  const state = useStairLayerCalculationWorker(request);
  const calculation = state.calculation;

  return (
    <section
      id="stair-layer-calculation-summary"
      tabIndex={-1}
      aria-busy={state.calculating}
      className="divide-y divide-slate-200 border-y border-slate-200 text-xs dark:divide-slate-700 dark:border-slate-700"
    >
      <div className="py-2 font-semibold">خلاصه محاسبه لایه</div>
      {state.calculating ? (
        <ReservedRowsSkeleton rows={6} />
      ) : state.error ? (
        <div className="py-2 text-red-600 dark:text-red-400">
          محاسبات نیاز به به‌روزرسانی دارد
        </div>
      ) : calculation && !calculation.ok ? (
        <div className="py-2 text-red-600 dark:text-red-400">
          {formatCanonicalLayerConflict(calculation.conflicts[0])}
        </div>
      ) : calculation?.ok ? (
        <>
          <div className="flex justify-between gap-3 py-1.5">
            <span>لایه</span>
            <strong>{number(calculation.result.commercialLayerSets)} مجموعه</strong>
          </div>
          <div className="flex justify-between gap-3 py-1.5">
            <span>قطعات تولید</span>
            <strong>
              {calculation.result.physicalStrips.map(strip =>
                `${strip.side} ${number(strip.quantity)} × ${number(strip.lengthMeters)}m`
              ).join(' · ')}
            </strong>
          </div>
          <div className="flex justify-between gap-3 py-1.5">
            <span>منبع مصرفی</span>
            <strong>
              {number(calculation.result.packingPlan.consumedSources.length)} قطعه
            </strong>
          </div>
          <div className="flex justify-between gap-3 py-1.5">
            <span>باقی‌مانده پرداخت‌شده</span>
            <strong>
              {number(calculation.result.materialSourceSplit.paidSourceCount)} قطعه
              {' · '}
              {number(calculation.result.materialSourceSplit.paidMaterialSquareMeters)} m²
              {' · '}
              {number(calculation.result.materialSourceSplit.paidMaterialAmountToman)} تومان
            </strong>
          </div>
          <div className="flex justify-between gap-3 py-1.5">
            <span>سنگ تازه برای کسری</span>
            <strong>
              {number(calculation.result.materialSourceSplit.newSourceCount)} قطعه
              {' · '}
              {number(calculation.result.materialSourceSplit.newMaterialSquareMeters)} m²
              {' · '}
              {number(calculation.result.materialSourceSplit.newMaterialAmountToman)} تومان
            </strong>
          </div>
          <div className="flex justify-between gap-3 py-1.5">
            <span>برش</span>
            <strong>
              طولی {number(calculation.result.packingPlan.longitudinalCutMeters)}m ·
              عرضی {number(calculation.result.packingPlan.crossCutMeters)}m ·
              کالیبر {number(calculation.result.packingPlan.calibrationMeters)}m
            </strong>
          </div>
          {calculation.result.cuttingPricingLines.map(line => {
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
                  {number(line.quantity)}m × {number(line.rateToman)} تومان
                  {' = '}
                  {number(line.amountToman)} تومان
                </strong>
              </div>
            );
          })}
          <div className="flex justify-between gap-3 py-1.5">
            <span>باقی‌مانده</span>
            <strong>
              {number(calculation.result.generatedRemainders.length)} قطعه
            </strong>
          </div>
          <div className="flex justify-between gap-3 py-1.5">
            <span>جمع</span>
            <strong>{number(calculation.result.totalAmountToman)} تومان</strong>
          </div>
        </>
      ) : (
        <div className="py-2 text-slate-500">—</div>
      )}
    </section>
  );
}
