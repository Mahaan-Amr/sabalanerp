import { useCallback, useEffect, useRef, useState } from 'react';
import { salesAPI } from '@/lib/api';
import {
  createContractRecoveryEnvelope,
  getContractRecoveryStorageKey,
  parseContractRecoveryEnvelope,
  selectNewestContractRecovery,
  type ContractRecoveryEnvelope,
  type ContractRecoveryScope
} from '../utils/contractRecoveryJournal';

const BROWSER_SESSION_STORAGE_KEY = 'sabalan-contract-browser-session-id';
const CHECKPOINT_DELAY_MS = 250;

const createStableClientId = (prefix: string): string => {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomId}`;
};

export const getOrCreateContractBrowserSessionId = (): string => {
  if (typeof window === 'undefined') return 'server-render';
  const existing = window.sessionStorage.getItem(BROWSER_SESSION_STORAGE_KEY);
  const navigation = typeof performance !== 'undefined'
    ? performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    : undefined;
  // sessionStorage survives refresh (which is required for silent recovery), but
  // browsers also copy it when a tab is duplicated. A duplicated/new navigation
  // must receive a new editor identity so it cannot share the original lease.
  if (existing && (navigation?.type === 'reload' || navigation?.type === 'back_forward')) {
    return existing;
  }
  const created = createStableClientId('browser');
  window.sessionStorage.setItem(BROWSER_SESSION_STORAGE_KEY, created);
  return created;
};

export const getOrCreateContractDraftId = (
  userId: string,
  contractId?: string | null
): string => {
  if (contractId) return `contract-${contractId}`;
  if (typeof window === 'undefined') return `draft-${userId}`;
  const key = `sabalan-contract-active-draft:${userId}`;
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = createStableClientId('draft');
  window.localStorage.setItem(key, created);
  return created;
};

interface UseContractEditRecoveryInput<Payload> {
  scope: ContractRecoveryScope | null;
  contractId?: string | null;
  onRestore: (payload: Payload) => void;
}

export const useContractEditRecovery = <Payload>({
  scope,
  contractId,
  onRestore
}: UseContractEditRecoveryInput<Payload>) => {
  const [browserSessionId] = useState(getOrCreateContractBrowserSessionId);
  const [leaseToken, setLeaseToken] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [ready, setReady] = useState(false);
  const [checkpointError, setCheckpointError] = useState(false);
  const sequenceRef = useRef(0);
  const pendingRef = useRef<ContractRecoveryEnvelope<Payload> | null>(null);
  const checkpointTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredScopeRef = useRef<string | null>(null);
  const onRestoreRef = useRef(onRestore);

  useEffect(() => {
    onRestoreRef.current = onRestore;
  }, [onRestore]);

  const scopeKey = scope ? getContractRecoveryStorageKey(scope) : null;

  const applyNewestRecovery = useCallback((
    local: ContractRecoveryEnvelope<Payload> | null,
    serverValue: unknown
  ) => {
    if (!scope) return;
    const server = serverValue && typeof serverValue === 'object'
      ? parseContractRecoveryEnvelope<Payload>(JSON.stringify(serverValue), scope)
      : null;
    const newest = selectNewestContractRecovery(local, server);
    if (!newest) return;
    sequenceRef.current = Math.max(sequenceRef.current, newest.sequence);
    const restoreKey = `${scopeKey}:${newest.sequence}:${newest.updatedAt}`;
    if (restoredScopeRef.current === restoreKey) return;
    restoredScopeRef.current = restoreKey;
    onRestoreRef.current(newest.payload);
  }, [scope, scopeKey]);

  const acquire = useCallback(async (takeover: boolean) => {
    if (!scope || !scopeKey) return;
    const local = parseContractRecoveryEnvelope<Payload>(
      window.localStorage.getItem(scopeKey),
      scope
    );
    try {
      const response = await salesAPI.acquireContractEditSession(scope.draftId, {
        contractId,
        browserSessionId,
        schemaVersion: scope.schemaVersion,
        baseRevision: scope.baseRevision,
        takeover
      });
      const result = response.data.data;
      applyNewestRecovery(local, result.recovery);
      setLeaseToken(result.session.leaseToken);
      setBlocked(false);
      setReady(true);
    } catch (error: any) {
      if (error?.response?.status === 409) {
        const conflict = error.response.data?.data;
        applyNewestRecovery(local, conflict?.recovery);
        setLeaseToken(null);
        setBlocked(true);
        setReady(true);
        return;
      }
      // Offline startup keeps the local recovery visible and retries on reconnect.
      applyNewestRecovery(local, null);
      setReady(true);
      setCheckpointError(true);
    }
  }, [applyNewestRecovery, browserSessionId, contractId, scope, scopeKey]);

  useEffect(() => {
    if (!scope || !scopeKey) return;
    setReady(false);
    setLeaseToken(null);
    setBlocked(false);
    // Restore the local journal synchronously before waiting for the network.
    // The lease response can still replace it with a newer server checkpoint.
    const local = parseContractRecoveryEnvelope<Payload>(
      window.localStorage.getItem(scopeKey),
      scope
    );
    applyNewestRecovery(local, null);
    void acquire(false);
  }, [acquire, applyNewestRecovery, scope, scopeKey]);

  const flushCheckpoint = useCallback(async () => {
    if (!scope || !leaseToken || blocked || !pendingRef.current) return;
    const envelope = pendingRef.current;
    try {
      await salesAPI.checkpointContractRecovery(scope.draftId, {
        browserSessionId,
        leaseToken,
        schemaVersion: scope.schemaVersion,
        baseRevision: scope.baseRevision,
        recovery: envelope
      });
      if (pendingRef.current === envelope) pendingRef.current = null;
      setCheckpointError(false);
    } catch (error: any) {
      if (error?.response?.status === 409) {
        setLeaseToken(null);
        setBlocked(true);
      }
      setCheckpointError(true);
    }
  }, [blocked, browserSessionId, leaseToken, scope]);

  const queueRecovery = useCallback((payload: Payload) => {
    if (!scope || !scopeKey || blocked) return;
    const envelope = createContractRecoveryEnvelope({
      scope,
      sequence: sequenceRef.current + 1,
      payload
    });
    sequenceRef.current = envelope.sequence;
    pendingRef.current = envelope;
    window.localStorage.setItem(scopeKey, JSON.stringify(envelope));
    if (checkpointTimerRef.current) clearTimeout(checkpointTimerRef.current);
    checkpointTimerRef.current = setTimeout(() => {
      checkpointTimerRef.current = null;
      void flushCheckpoint();
    }, CHECKPOINT_DELAY_MS);
  }, [blocked, flushCheckpoint, scope, scopeKey]);

  useEffect(() => {
    const handleOnline = () => {
      if (!leaseToken) {
        void acquire(false);
      } else {
        void flushCheckpoint();
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [acquire, flushCheckpoint, leaseToken]);

  useEffect(() => () => {
    if (checkpointTimerRef.current) clearTimeout(checkpointTimerRef.current);
  }, []);

  const takeover = useCallback(async () => {
    await acquire(true);
  }, [acquire]);

  const clearLocalRecovery = useCallback(() => {
    if (scopeKey) window.localStorage.removeItem(scopeKey);
    pendingRef.current = null;
  }, [scopeKey]);

  const release = useCallback(async () => {
    if (!scope || !leaseToken) {
      clearLocalRecovery();
      return;
    }
    await salesAPI.releaseContractEditSession(scope.draftId, {
      browserSessionId,
      leaseToken,
      baseRevision: scope.baseRevision
    });
    clearLocalRecovery();
    setLeaseToken(null);
  }, [browserSessionId, clearLocalRecovery, leaseToken, scope]);

  return {
    ready,
    blocked,
    checkpointError,
    browserSessionId,
    leaseToken,
    takeover,
    queueRecovery,
    clearLocalRecovery,
    release
  };
};
