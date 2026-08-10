export type DestinationDutyLoadState<T> = {
  data: T | null;
  loading: boolean;
  stale: boolean;
  error: string | null;
};

export const initialDestinationDutyState: DestinationDutyLoadState<any> = {
  data: null,
  loading: true,
  stale: false,
  error: null,
};

export type DestinationDutyLoadAction<T> =
  | { type: 'start' }
  | { type: 'success'; data: T }
  | { type: 'failure'; message: string };

export const reduceDestinationDutyState = <T>(
  state: DestinationDutyLoadState<T>,
  action: DestinationDutyLoadAction<T>,
): DestinationDutyLoadState<T> => {
  if (action.type === 'start') return { ...state, loading: true, stale: false, error: null };
  if (action.type === 'success') return { data: action.data, loading: false, stale: false, error: null };
  if (state.data) return { ...state, loading: false, stale: true, error: action.message };
  return { data: null, loading: false, stale: false, error: action.message };
};
