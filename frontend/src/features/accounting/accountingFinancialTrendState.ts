export type FinancialTrendRange = '1m' | '3m' | '6m' | '1y';

export type FinancialTrendPoint = {
  periodKey: string;
  monthKey: string;
  label: string;
  marker: boolean;
  startsAt: string;
  endsAt: string;
  invoicedRial: number;
  receivedRial: number;
  outstandingRial: number;
  confidence: 'authoritative' | 'legacy-fallback';
  destinations: { invoiced: string; received: string; outstanding: string };
};
export type FinancialTrendData = {
  range: FinancialTrendRange;
  currency: 'RIAL';
  hasLegacyFallback: boolean;
  points: FinancialTrendPoint[];
  partnerSeries?: Array<{ currency: string; points: Array<{
    periodKey: string; label: string; startsAt: string; endsAt: string;
    invoiced: string; received: string; outstanding: string;
  }> }>;
};

export type FinancialTrendState = {
  status: 'loading' | 'available' | 'stale' | 'error';
  data: FinancialTrendData | null;
};

export const pendingFinancialTrend = (
  previous?: FinancialTrendState,
  requestedRange?: FinancialTrendRange,
): FinancialTrendState => ({
  status: 'loading',
  data: previous?.data && !previous.data.partnerSeries?.length &&
    (!requestedRange || previous.data.range === requestedRange) ? previous.data : null,
});

export const resolveFinancialTrend = (
  _previous: FinancialTrendState,
  data: FinancialTrendData,
): FinancialTrendState => ({ status: 'available', data });

export const failFinancialTrend = (previous: FinancialTrendState): FinancialTrendState => ({
  status: previous.data && !previous.data.partnerSeries?.length ? 'stale' : 'error',
  data: previous.data?.partnerSeries?.length ? null : previous.data,
});

export const financialTrendToman = (rial: number) => rial / 10;
