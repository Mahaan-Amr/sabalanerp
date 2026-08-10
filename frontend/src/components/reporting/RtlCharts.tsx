'use client';
import React from 'react';
import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis
} from 'recharts';

const faNumber = (value: unknown) => Number(value || 0).toLocaleString('fa-IR');

const tooltipStyle = {
  direction: 'rtl' as const,
  textAlign: 'right' as const,
  background: 'var(--sds-surface-raised)',
  border: '1px solid var(--sds-border-default)',
  borderRadius: 10,
  color: 'var(--sds-text-primary)',
  boxShadow: 'var(--sds-shadow-raised)'
};

export const chartTickInterval = (length: number, maximumVisibleTicks = 8) =>
  Math.max(0, Math.ceil(length / maximumVisibleTicks) - 1);

export const resolveChartLabel = (row: any, labelKey = 'label') =>
  String(row?.[labelKey] ?? row?.statusLabel ?? row?.status ?? 'نامشخص');

function SeriesLegend({ items }: { items: Array<{ label: string; color: string; dashed?: boolean }> }) {
  return <div dir="rtl" className="mb-3 flex min-h-8 flex-wrap items-center justify-start gap-x-5 gap-y-2 px-2 text-sm font-semibold text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
    {items.map((item) => <span key={item.label} className="inline-flex items-center gap-2"><i className="inline-block w-7 border-t-[3px]" style={{ borderColor: item.color, borderTopStyle: item.dashed ? 'dashed' : 'solid' }} />{item.label}</span>)}
  </div>;
}

export function RtlTrendChart({ data, onSelect, valueAxisSide = 'right' }: {
  data: any[];
  onSelect?: (row: any) => void;
  valueAxisSide?: 'left' | 'right';
}) {
  return (
    <div dir="rtl" className="min-w-0 w-full overflow-hidden" role="img" aria-label="روند زمانی؛ قدیمی‌ترین بازه در سمت راست و جدیدترین بازه در سمت چپ است">
      <SeriesLegend items={[
        { label: 'فروش قطعی خالص', color: 'var(--sds-accent)' },
        { label: 'پایپ‌لاین', color: 'var(--sds-warning)', dashed: true },
        { label: 'تعدیلات', color: 'var(--sds-purple)' }
      ]} />
      <div className="h-[300px] min-w-0 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: 16, bottom: 28 }} onClick={(state: any) => state?.activePayload?.[0]?.payload && onSelect?.(state.activePayload[0].payload)}>
          <CartesianGrid stroke="var(--sds-border-subtle)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--sds-text-secondary)' }} interval={chartTickInterval(data.length, 3)} minTickGap={36} tickMargin={10} height={50} />
          <YAxis orientation={valueAxisSide} tickFormatter={faNumber} tick={{ fontSize: 10, fill: 'var(--sds-text-secondary)', textAnchor: valueAxisSide === 'left' ? 'start' : undefined }} tickMargin={8} width={92} />
          <Tooltip contentStyle={tooltipStyle} labelStyle={{ textAlign: 'right', fontWeight: 800 }} formatter={(value: any, name: any) => [faNumber(value), name]} />
          <Line type="monotone" dataKey="net" name="فروش قطعی خالص" stroke="var(--sds-accent)" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 6, cursor: 'pointer' }} />
          <Line type="monotone" dataKey="pipeline" name="پایپ‌لاین" stroke="var(--sds-warning)" strokeWidth={2} strokeDasharray="7 5" dot={{ r: 2 }} />
          <Line type="monotone" dataKey="adjustments" name="تعدیلات" stroke="var(--sds-purple)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function RtlHorizontalBarChart({ data, valueKey = 'value', labelKey = 'label', valueLabel = 'مقدار', onSelect }: {
  data: any[];
  valueKey?: string;
  labelKey?: string;
  valueLabel?: string;
  onSelect?: (row: any) => void;
}) {
  const height = Math.max(260, data.length * 48);
  const normalizedData = data.map((row) => ({ ...row, [labelKey]: resolveChartLabel(row, labelKey) }));
  return (
    <div dir="rtl" className="w-full" style={{ height }} role="img" aria-label={`${valueLabel} بر اساس ${labelKey}`}>
      <div dir="ltr" className="grid h-full gap-3" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(150px, 220px)' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={normalizedData} layout="vertical" margin={{ top: 12, right: 2, left: 22, bottom: 18 }}>
            <CartesianGrid stroke="var(--sds-border-subtle)" horizontal={false} />
            <XAxis type="number" reversed tickFormatter={faNumber} tick={{ fontSize: 10, fill: 'var(--sds-text-secondary)' }} tickMargin={8} />
            <YAxis type="category" dataKey={labelKey} hide />
            <Tooltip contentStyle={tooltipStyle} labelStyle={{ direction: 'rtl', textAlign: 'right', fontWeight: 800 }} labelFormatter={(_, payload) => resolveChartLabel(payload?.[0]?.payload, labelKey)} formatter={(value: any) => [faNumber(value), valueLabel]} />
            <Bar dataKey={valueKey} name={valueLabel} fill="var(--sds-accent)" radius={[7, 0, 0, 7]} cursor={onSelect ? 'pointer' : 'default'} onClick={(row: any) => onSelect?.(row?.payload || row)} />
          </BarChart>
        </ResponsiveContainer>
        <div dir="rtl" className="grid py-3 text-right" style={{ gridTemplateRows: `repeat(${Math.max(normalizedData.length, 1)}, minmax(0, 1fr))`, paddingBottom: 18 }}>
          {normalizedData.map((row, index) => <div key={`${resolveChartLabel(row, labelKey)}-${index}`} title={resolveChartLabel(row, labelKey)} className="flex min-w-0 items-center border-r-2 border-transparent pr-2 text-xs font-semibold leading-5 text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]"><span className="line-clamp-2">{resolveChartLabel(row, labelKey)}</span></div>)}
        </div>
      </div>
    </div>
  );
}
