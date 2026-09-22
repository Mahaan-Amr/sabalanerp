'use client';

import React, { useState } from 'react';
import { ErpInput, ErpPressable } from '@/components/erp';
import { formatDisplayNumber, formatSquareMeters, parseFormattedNumber } from '@/lib/numberFormat';

export function RemainingInventorySelector({ quantity, lengthMeters, widthMeters, pieceSquareMeters,
  totalSquareMeters, onUse }: { quantity: number; lengthMeters: number; widthMeters: number;
  pieceSquareMeters: number; totalSquareMeters: number; onUse: (quantity: number) => void }) {
  const [requestedQuantity, setRequestedQuantity] = useState(1);
  const safeQuantity = Math.min(quantity, Math.max(1, Math.trunc(Number(requestedQuantity) || 1)));
  return <div className="rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] p-2.5">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div><div className="sds-text-primary font-medium">{formatDisplayNumber(quantity)} قطعه × ({formatDisplayNumber(lengthMeters)}m × {formatDisplayNumber(widthMeters)}cm)</div>
        <div className="sds-text-muted mt-0.5">هر قطعه {formatSquareMeters(pieceSquareMeters)} · مجموع {formatSquareMeters(totalSquareMeters)}</div></div>
      <div className="flex items-end gap-2"><label className="sds-text-muted text-[11px]">تعداد استفاده
        <ErpInput type="text" inputMode="numeric" value={formatDisplayNumber(safeQuantity)}
          onChange={event => { const value = Math.trunc(parseFormattedNumber(event.target.value));
            setRequestedQuantity(Math.min(quantity, Math.max(1, value || 1))); }}
          className="mt-1 block w-24 px-2 text-center" aria-label="تعداد قطعات باقی‌مانده برای استفاده" />
      </label><ErpPressable type="button" onClick={() => onUse(safeQuantity)} tone="primary" variant="solid"
        className="px-3 text-xs font-semibold">استفاده</ErpPressable></div>
    </div>
  </div>;
}
