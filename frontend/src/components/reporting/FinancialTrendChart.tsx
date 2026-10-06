'use client';

import React from 'react';
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export type FinancialTrendSeries = { key: string; label: string; color: string };
const compactAmount = new Intl.NumberFormat('fa-IR', { notation: 'compact', maximumFractionDigits: 1 });

/** Shared financial trend presentation; callers retain currency and source precision. */
type TrendProps<T extends { label: string; marker?: boolean }> = {
  points: T[]; series: FinancialTrendSeries[]; compact?: boolean; daily?: boolean;
  formatValue: (value: number, key: string, point: T) => string; onSelect?: (point: T) => void;
};
export function FinancialTrendChart<T extends { label: string; marker?: boolean }>(props: TrendProps<T>) {
  const gradientId = React.useId().replace(/:/g, '');
  return <FinancialTrendPlot {...props} gradientId={gradientId} />;
}

export function FinancialTrendPlot<T extends { label: string; marker?: boolean }>({
  points, series, compact = false, daily = false, formatValue, onSelect, gradientId,
}: TrendProps<T> & { gradientId: string }) {
  return <div className={compact ? 'h-52' : 'h-72'} dir="ltr">
    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: compact ? 208 : 288 }}>
      <AreaChart data={points} margin={{ top: 10, right: 8, bottom: 0, left: 0 }} onClick={state => {
        if (state.activeTooltipIndex == null) return;
        const index = Number(state.activeTooltipIndex);
        if (Number.isSafeInteger(index) && points[index]) onSelect?.(points[index]);
      }}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor={series[0]?.color} stopOpacity={0.24} />
          <stop offset="95%" stopColor={series[0]?.color} stopOpacity={0} />
        </linearGradient></defs>
        <CartesianGrid stroke="var(--sds-border-subtle)" strokeDasharray="3 5" vertical={false} />
        <XAxis dataKey="label" interval={daily ? 0 : 'preserveStartEnd'}
          tickFormatter={(label, index) => !daily || points[index]?.marker ? label : ''}
          minTickGap={12} tick={{ fill: 'var(--sds-text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={value => compactAmount.format(value)} tick={{ fill: 'var(--sds-text-muted)', fontSize: 11 }}
          tickMargin={8} axisLine={false} tickLine={false} width="auto" />
        <Tooltip formatter={(value, _name, item) => formatValue(Number(value), String(item.dataKey), item.payload as T)}
          contentStyle={{ background: 'var(--sds-surface-overlay)', border: '1px solid var(--sds-border-default)',
            borderRadius: 'var(--sds-radius-card)', color: 'var(--sds-text-primary)' }} />
        <Legend wrapperStyle={{ color: 'var(--sds-text-secondary)', fontSize: 11 }} />
        {series.map((item, index) => <Area key={item.key} name={item.label} dataKey={item.key} type="monotone"
          stroke={item.color} fill={index === 0 ? `url(#${gradientId})` : 'transparent'} strokeWidth={2.5}
          dot={props => typeof props.cx === 'number' && typeof props.cy === 'number'
            ? <circle cx={props.cx} cy={props.cy} r={props.payload?.marker ? 4 : 2.5}
                fill="var(--sds-surface-raised)" stroke={item.color} strokeWidth={2.5} aria-hidden="true" />
            : <g />} />)}
      </AreaChart>
    </ResponsiveContainer>
  </div>;
}
