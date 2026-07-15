'use client';

import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer,
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

export function RtlTrendChart({ data, onSelect }: { data: any[]; onSelect?: (row: any) => void }) {
  return (
    <div dir="rtl" className="h-[300px] w-full" role="img" aria-label="روند زمانی؛ قدیمی‌ترین بازه در سمت راست و جدیدترین بازه در سمت چپ است">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 18, right: 18, left: 18, bottom: 30 }} onClick={(state: any) => state?.activePayload?.[0]?.payload && onSelect?.(state.activePayload[0].payload)}>
          <CartesianGrid stroke="#dbe4ea" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#475569' }} interval="preserveStartEnd" height={54} />
          <YAxis orientation="right" tickFormatter={faNumber} tick={{ fontSize: 10, fill: '#475569' }} width={82} />
          <Tooltip contentStyle={tooltipStyle} labelStyle={{ textAlign: 'right', fontWeight: 800 }} formatter={(value: any, name: any) => [faNumber(value), name]} />
          <Legend align="right" verticalAlign="top" wrapperStyle={{ direction: 'rtl', textAlign: 'right' }} />
          <Line type="monotone" dataKey="net" name="فروش قطعی خالص" stroke="#0f766e" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 6, cursor: 'pointer' }} />
          <Line type="monotone" dataKey="pipeline" name="پایپ‌لاین" stroke="#f59e0b" strokeWidth={2} strokeDasharray="7 5" dot={{ r: 2 }} />
          <Line type="monotone" dataKey="adjustments" name="تعدیلات" stroke="#7c3aed" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
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
  return (
    <div dir="rtl" className="w-full" style={{ height }} role="img" aria-label={`${valueLabel} بر اساس ${labelKey}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 12, right: 8, left: 28, bottom: 18 }}>
          <CartesianGrid stroke="#dbe4ea" horizontal={false} />
          <XAxis type="number" reversed tickFormatter={faNumber} tick={{ fontSize: 10, fill: '#475569' }} />
          <YAxis type="category" dataKey={labelKey} orientation="right" width={150} tick={{ fontSize: 11, fill: '#334155' }} />
          <Tooltip contentStyle={tooltipStyle} formatter={(value: any) => [faNumber(value), valueLabel]} />
          <Bar dataKey={valueKey} name={valueLabel} fill="#0f766e" radius={[7, 0, 0, 7]} cursor={onSelect ? 'pointer' : 'default'} onClick={(row: any) => onSelect?.(row?.payload || row)} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
