'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { browserSessionContinuation } from '@/lib/api';
import { createAccountingRegisterLoader, type AccountingRegisterState } from './accountingRegisterLoader';
import { accountingFailureMessage } from './accountingUi';

export type AccountingRegisterRequest = {
  signal: AbortSignal;
  headers: { 'x-sabalan-expected-user': string };
};

const initialState = { status: 'loading', data: null } as const;
const deniedActorState = { status: 'denied', data: null, reason: 'actor' } as const;
const serverSessionSnapshot = () => null;

export function useAccountingRegister<T>(
  read: (request: AccountingRegisterRequest) => Promise<T>,
  failureMessage: string,
  enabled = true,
) {
  const { user } = useAuth();
  const blockedOwner = useSyncExternalStore(browserSessionContinuation.subscribe, browserSessionContinuation.snapshot, serverSessionSnapshot);
  const owner = enabled && !blockedOwner ? user?.id : undefined;
  const [published, setPublished] = useState<{ key: object; state: AccountingRegisterState<T> }>();
  const scope = useMemo(() => {
    const key = {};
    return { key, loader: createAccountingRegisterLoader({
      read: signal => {
        if (!owner) throw Object.assign(new Error('Accounting actor unavailable'), { code: 'AUTH_CONTEXT_CHANGED' });
        return read({ signal, headers: { 'x-sabalan-expected-user': owner } });
      },
      publish: state => setPublished({ key, state }),
      failureMessage: error => accountingFailureMessage(error, failureMessage),
    }) };
  }, [owner, read, failureMessage]);
  const active = useRef<typeof scope | null>(null);

  useLayoutEffect(() => {
    setPublished(undefined);
    if (!owner) return;
    active.current = scope;
    return () => {
      active.current = null;
      scope.loader.cancel();
    };
  }, [owner, scope]);

  const load = useCallback(() => active.current?.loader.load(), []);
  useEffect(() => {
    if (active.current === scope) void scope.loader.load();
  }, [scope]);

  useEffect(() => {
    const refreshVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const status = active.current?.loader.current().status;
      if (status && status !== 'loading' && status !== 'refreshing') void load();
    };
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [load]);

  const state = blockedOwner ? deniedActorState : published?.key === scope.key ? published.state : initialState;
  const isActive = useCallback(() => active.current === scope && scope.loader.current().status !== 'denied', [scope]);
  const clearOnDenial = useCallback((error: unknown) => active.current === scope && scope.loader.clearOnDenial(error), [scope]);

  return {
    state,
    load,
    isActive,
    canAct: () => isActive() && scope.loader.current().status === 'ready',
    clearOnDenial,
    mutationRequest: owner ? { headers: { 'x-sabalan-expected-user': owner } } : undefined,
  };
}
