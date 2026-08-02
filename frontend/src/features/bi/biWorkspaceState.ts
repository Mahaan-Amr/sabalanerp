export type BiFilters = {
  period: string;
  departmentId: string;
  sellerId: string;
  from?: string;
  to?: string;
};

export type BiLoadState<T> = {
  data: T | null;
  error: string | null;
  refreshing: boolean;
};

export const applyBiFilters = (_current: BiFilters, draft: BiFilters): BiFilters => ({ ...draft });

const legacyDestinations: Record<string, string> = {
  overview: '/dashboard/bi',
  contracts: '/dashboard/bi/realized-sales',
  sellers: '/dashboard/bi/sellers',
  finance: '/dashboard/bi/collections',
  products: '/dashboard/bi/commercial-mix',
  customers: '/dashboard/bi/commercial-mix',
  delivery: '/dashboard/bi/delivery',
};

export const resolveBiDestination = ({
  pathname,
  legacyTab,
}: {
  pathname: string;
  legacyTab: string | null;
}) => legacyTab ? legacyDestinations[legacyTab] || pathname : pathname;

export const beginBiRefresh = <T>(state: BiLoadState<T>): BiLoadState<T> => ({
  ...state,
  error: null,
  refreshing: true,
});

export const failBiRefresh = <T>(state: BiLoadState<T>, error: string): BiLoadState<T> => ({
  ...state,
  error,
  refreshing: false,
});

export const completeBiRefresh = <T>(state: BiLoadState<T>, data: T): BiLoadState<T> => ({
  ...state,
  data,
  error: null,
  refreshing: false,
});
