'use client';

import {
  Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis
} from 'recharts';

const faNumber = (value: unknown) => Number(value || 0).toLocaleString('fa-IR');

const tooltipStyle = {
  direction: 'rtl' as const,
  textAlign: 'right' as const,
  background: '#ffffff',
  border: '1px solid #cbd5e1',
  borderRadius: 10,
  color: '#0f172a',
  boxShadow: '0 12px 30px rgba(15, 23, 42, .14)'
};

export const chartTickInterval = (length: number, maximumVisibleTicks = 8) =>
  Math.max(0, Math.ceil(length / maximumVisibleTicks) - 1);

export const resolveChartLabel = (row: any, labelKey = 'label') =>
  String(row?.[labelKey] ?? row?.statusLabel ?? row?.status ?? 'نامشخص');

function SeriesLegend({ items }: { items: Array<{ label: string; color: string; dashed?: boolean }> }) {
  return <div dir="rtl" className="mb-3 flex min-h-8 flex-wrap items-center justify-start gap-x-5 gap-y-2 px-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
    {items.map((item) => <span key={item.label} className="inline-flex items-center gap-2"><i className="inline-block w-7 border-t-[3px]" style={{ borderColor: item.color, borderTopStyle: item.dashed ? 'dashed' : 'solid' }} />{item.label}</span>)}
  </div>;
}

export function RtlTrendChart({ data, onSelect }: { data: any[]; onSelect?: (row: any) => void }) {
  return (
    <div dir="rtl" className="w-full" role="img" aria-label="روند زمانی؛ قدیمی‌ترین بازه در سمت راست و جدیدترین بازه در سمت چپ است">
      <SeriesLegend items={[
        { label: 'فروش قطعی خالص', color: '#0f766e' },
        { label: 'پایپ‌لاین', color: '#f59e0b', dashed: true },
        { label: 'تعدیلات', color: '#7c3aed' }
      ]} />
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: 16, bottom: 28 }} onClick={(state: any) => state?.activePayload?.[0]?.payload && onSelect?.(state.activePayload[0].payload)}>
          <CartesianGrid stroke="#dbe4ea" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#475569' }} interval={chartTickInterval(data.length)} minTickGap={24} tickMargin={10} height={50} />
          <YAxis orientation="right" tickFormatter={faNumber} tick={{ fontSize: 10, fill: '#475569' }} tickMargin={8} width={92} />
          <Tooltip contentStyle={tooltipStyle} labelStyle={{ textAlign: 'right', fontWeight: 800 }} formatter={(value: any, name: any) => [faNumber(value), name]} />
          <Line type="monotone" dataKey="net" name="فروش قطعی خالص" stroke="#0f766e" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 6, cursor: 'pointer' }} />
          <Line type="monotone" dataKey="pipeline" name="پایپ‌لاین" stroke="#f59e0b" strokeWidth={2} strokeDasharray="7 5" dot={{ r: 2 }} />
          <Line type="monotone" dataKey="adjustments" name="تعدیلات" stroke="#7c3aed" strokeWidth={2} dot={false} />
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
            <CartesianGrid stroke="#dbe4ea" horizontal={false} />
            <XAxis type="number" reversed tickFormatter={faNumber} tick={{ fontSize: 10, fill: '#475569' }} tickMargin={8} />
            <YAxis type="category" dataKey={labelKey} hide />
            <Tooltip contentStyle={tooltipStyle} labelStyle={{ direction: 'rtl', textAlign: 'right', fontWeight: 800 }} labelFormatter={(_, payload) => resolveChartLabel(payload?.[0]?.payload, labelKey)} formatter={(value: any) => [faNumber(value), valueLabel]} />
            <Bar dataKey={valueKey} name={valueLabel} fill="#0f766e" radius={[7, 0, 0, 7]} cursor={onSelect ? 'pointer' : 'default'} onClick={(row: any) => onSelect?.(row?.payload || row)} />
          </BarChart>
        </ResponsiveContainer>
        <div dir="rtl" className="grid py-3 text-right" style={{ gridTemplateRows: `repeat(${Math.max(normalizedData.length, 1)}, minmax(0, 1fr))`, paddingBottom: 18 }}>
          {normalizedData.map((row, index) => <div key={`${resolveChartLabel(row, labelKey)}-${index}`} title={resolveChartLabel(row, labelKey)} className="flex min-w-0 items-center border-r-2 border-transparent pr-2 text-xs font-semibold leading-5 text-slate-700 dark:text-slate-200"><span className="line-clamp-2">{resolveChartLabel(row, labelKey)}</span></div>)}
        </div>
      </div>
    </div>
  );
}
