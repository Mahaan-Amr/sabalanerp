'use client';

import React from 'react';
import { FaChartLine } from 'react-icons/fa';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ErpCard, ErpInlineState, ErpSegmentedControl, ErpSkeleton } from '@/components/erp';
import {
  financialTrendToman,
  type FinancialTrendRange,
  type FinancialTrendState,
} from './accountingFinancialTrendState';

const ranges: Array<{ value: FinancialTrendRange; label: string }> = [
  { value: '1m', label: '۱ ماه' },
  { value: '3m', label: '۳ ماه' },
  { value: '6m', label: '۶ ماه' },
  { value: '1y', label: '۱ سال' },
];

const compactToman = new Intl.NumberFormat('fa-IR', { notation: 'compact', maximumFractionDigits: 1 });
const formatToman = (value: number) => `${compactToman.format(value)} تومان`;

type SeriesKey = 'invoiced' | 'received' | 'outstanding';
const seriesLabels: Record<SeriesKey, string> = {
  invoiced: 'فاکتور‌شده',
  received: 'دریافت‌شده',
  outstanding: 'مانده مطالبات',
};

function DrilldownDot({ cx, cy, payload, series, stroke }: {
  cx?: number;
  cy?: number;
  payload?: any;
  series: SeriesKey;
  stroke: string;
}) {
  if (!payload || typeof cx !== 'number' || typeof cy !== 'number') return null;
  const href = payload.destinations[series];
  const amount = payload[series];
  return (
    <a href={href} aria-label={`${seriesLabels[series]} ${payload.label}: ${formatToman(amount)}`}>
      <circle cx={cx} cy={cy} r={22} fill="transparent" pointerEvents="all" />
      <circle cx={cx} cy={cy} r={payload.marker ? 4 : 2.5} fill="var(--sds-surface-raised)" stroke={stroke} strokeWidth={2.5} pointerEvents="none" />
    </a>
  );
}

export function AccountingFinancialTrend({
  range,
  state,
  onRangeChange,
  onRetry,
  compact = false,
}: {
  range: FinancialTrendRange;
  state: FinancialTrendState;
  onRangeChange: (range: FinancialTrendRange) => void;
  onRetry: () => void;
  compact?: boolean;
}) {
  const source = state.data;
  const chartData = (source?.points || []).map((point) => ({
    ...point,
    invoiced: financialTrendToman(point.invoicedRial),
    received: financialTrendToman(point.receivedRial),
    outstanding: financialTrendToman(point.outstandingRial),
  }));
  const empty = source && chartData.every((point) => (
    point.invoiced === 0 && point.received === 0 && point.outstanding === 0
  ));

  return (
    <section aria-labelledby="accounting-financial-trend-title" className="h-full">
    <ErpCard className="h-full overflow-hidden">
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="accounting-financial-trend-title" className="sds-text-primary text-base font-semibold">روند مالی قراردادها</h2>
            <p className="sds-text-muted mt-1 text-sm">
              {range === '1m' ? 'حرکت روزانه ماه جاری' : 'حرکت ماهانه'} · نمایش فشرده تومان از مبالغ منبع ریالی
            </p>
          </div>
          <span className="sds-neumorphic-icon sds-tone-primary inline-flex h-11 w-11 shrink-0 items-center justify-center" aria-hidden="true">
            <FaChartLine className="h-4 w-4" />
          </span>
        </div>
        <div role="group" aria-label="بازه زمانی نمودار روند مالی">
          <ErpSegmentedControl options={ranges} value={range} onChange={onRangeChange} />
        </div>
      </div>

      {state.status === 'stale' && (
        <ErpInlineState kind="stale" title="آخرین نمایش موفق نشان داده می‌شود؛ به‌روزرسانی روند ناموفق بود." action={{ label: 'تلاش دوباره', onClick: onRetry }} />
      )}
      {source?.hasLegacyFallback && (
        <ErpInlineState kind="stale" title="بخشی از تاریخ‌ها با شواهد قدیمی و اطمینان کمتر نسبت داده شده‌اند." />
      )}
      {state.status === 'error' && !source && (
        <ErpInlineState kind="error" title="روند مالی در دسترس نیست." action={{ label: 'تلاش دوباره', onClick: onRetry }} />
      )}
      {state.status === 'loading' && !source && <ErpSkeleton label="در حال بارگذاری روند مالی" lines={4} className="m-4" />}
      {empty && <ErpInlineState kind="empty" title="هنوز رویداد مالی معناداری برای این بازه ثبت نشده است." />}

      {source && !empty && (
        <div className="px-2 pb-4 sm:px-4" aria-busy={state.status === 'loading'}>
          <div className={compact ? 'h-52' : 'h-72'} dir="ltr">
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: compact ? 208 : 288 }}>
              <AreaChart data={chartData} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="financial-trend-invoiced-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--sds-accent)" stopOpacity={0.24} />
                    <stop offset="95%" stopColor="var(--sds-accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--sds-border-subtle)" strokeDasharray="3 5" vertical={false} />
                <XAxis dataKey="label" interval={source.range === '1m' ? 0 : 'preserveStartEnd'} tickFormatter={(label, index) => source.range !== '1m' || chartData[index]?.marker ? label : ''} minTickGap={12} tick={{ fill: 'var(--sds-text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(value) => compactToman.format(value)} tick={{ fill: 'var(--sds-text-muted)', fontSize: 11 }} tickMargin={8} axisLine={false} tickLine={false} width="auto" />
                <Tooltip formatter={(value) => formatToman(Number(value))} contentStyle={{ background: 'var(--sds-surface-overlay)', border: '1px solid var(--sds-border-default)', borderRadius: 'var(--sds-radius-card)', color: 'var(--sds-text-primary)' }} />
                <Legend wrapperStyle={{ color: 'var(--sds-text-secondary)', fontSize: 11 }} />
                <Area name={seriesLabels.invoiced} dataKey="invoiced" type="monotone" stroke="var(--sds-accent)" fill="url(#financial-trend-invoiced-fill)" strokeWidth={2.5} dot={(props) => <DrilldownDot {...props} series="invoiced" stroke="var(--sds-accent)" />} />
                <Area name={seriesLabels.received} dataKey="received" type="monotone" stroke="var(--sds-success)" fill="transparent" strokeWidth={2.5} dot={(props) => <DrilldownDot {...props} series="received" stroke="var(--sds-success)" />} />
                <Area name={seriesLabels.outstanding} dataKey="outstanding" type="monotone" stroke="var(--sds-warning)" fill="transparent" strokeWidth={2.5} dot={(props) => <DrilldownDot {...props} series="outstanding" stroke="var(--sds-warning)" />} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="sr-only" aria-label="پیوندهای نقاط روند مالی">
            {chartData.flatMap((point) => (Object.keys(seriesLabels) as SeriesKey[]).map((series) => (
              <a key={`${point.periodKey}-${series}`} href={point.destinations[series]}>
                {seriesLabels[series]} {point.label}: {formatToman(point[series])}
              </a>
            )))}
          </div>
        </div>
      )}
    </ErpCard>
    </section>
  );
}
