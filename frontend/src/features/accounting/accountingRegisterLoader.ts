import { isPrivateClientScopeFailure } from '../../lib/privateClientScope';
import { createAccountingContractsLoader } from './accountingContractsLoader';

export type AccountingRegisterState<T> =
  | { status: 'loading'; data: null }
  | { status: 'denied'; data: null; reason: 'actor' | 'permission' }
  | { status: 'refreshing' | 'ready'; data: T }
  | { status: 'error'; data: T | null; message: string };

export function isCurrentAccountingRegisterRow<T>(rows: T[] | undefined, target: T, key: (row: T) => string) {
  const current = rows?.find(row => key(row) === key(target));
  return current !== undefined && JSON.stringify(current) === JSON.stringify(target);
}

export function createAccountingRegisterLoader<T>({ read, publish, failureMessage }: {
  read: (signal: AbortSignal) => Promise<T>;
  publish: (state: AccountingRegisterState<T>) => void;
  failureMessage: (error: unknown) => string;
}) {
  let state: AccountingRegisterState<T> = { status: 'loading', data: null };
  const show = (next: AccountingRegisterState<T>) => {
    state = next;
    publish(next);
  };
  const deny = (error: unknown) => {
    const failure = error as { response?: { status?: number }; code?: string };
    const reason = failure?.code === 'AUTH_CONTEXT_CHANGED' || failure?.response?.status === 401 ? 'actor' : 'permission';
    show({ status: 'denied', data: null, reason });
  };
  const loader = createAccountingContractsLoader<void, T>({
    read: (_, signal) => read(signal),
    start: () => show(state.data === null ? { status: 'loading', data: null } : { status: 'refreshing', data: state.data }),
    success: data => show({ status: 'ready', data }),
    failure: error => {
      if (isPrivateClientScopeFailure(error)) deny(error);
      else show({ status: 'error', data: state.data, message: failureMessage(error) });
    },
    settled: () => {},
  });
  return {
    load: loader.load,
    cancel() {
      loader.cancel();
      state = { status: 'loading', data: null };
    },
    current: () => state,
    clearOnDenial(error: unknown) {
      if (!isPrivateClientScopeFailure(error)) return false;
      loader.cancel();
      deny(error);
      return true;
    },
  };
}
