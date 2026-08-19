import { useCallback, useEffect, useRef, useState } from 'react';
import { salesAPI } from '@/lib/api';
import {
  createContractRecoveryEnvelope,
  getContractRecoveryStorageKey,
  parseContractRecoveryEnvelope,
  persistContractRecoveryEnvelope,
  selectNewestContractRecovery,
  type ContractRecoveryEnvelope,
  type ContractRecoveryScope
} from '../utils/contractRecoveryJournal';
import {
  classifyContractEditRecoveryFailure,
  getContractEditRecoveryMessage,
  type ContractEditRecoveryBlockReason
} from '../utils/contractEditRecoveryConflictPolicy';
import { shouldRotateUnavailableCreationDraft } from '../services/contractCreationDraftPolicy';

const BROWSER_SESSION_STORAGE_KEY = 'sabalan-contract-browser-session-id';
const CHECKPOINT_DELAY_MS = 250;
const HEARTBEAT_INTERVAL_MS = 25_000;
let activeDocumentBrowserSessionId: string | null = null;

const createStableClientId = (prefix: string): string => {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${randomId}`;
};

const activeDraftStorageKey = (userId: string) =>
  `sabalan-contract-active-draft:${userId}`;

export const decideContractRecoveryDelivery = ({
  mode,
  recoveryKey,
  lastRestoredKey,
}: {
  mode: 'offer' | 'restore';
  recoveryKey: string;
  lastRestoredKey: string | null;
}): 'offer' | 'restore' | 'skip' => {
  if (mode === 'offer') return 'offer';
  return lastRestoredKey === recoveryKey ? 'skip' : 'restore';
};

export const getOrCreateContractBrowserSessionId = (): string => {
  if (typeof window === 'undefined') return 'server-render';
  if (activeDocumentBrowserSessionId) return activeDocumentBrowserSessionId;
  const existing = window.sessionStorage.getItem(BROWSER_SESSION_STORAGE_KEY);
  const navigation = typeof performance !== 'undefined'
    ? performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    : undefined;
  // sessionStorage survives refresh (which is required for silent recovery), but
  // browsers also copy it when a tab is duplicated. A duplicated/new navigation
  // must receive a new editor identity so it cannot share the original lease.
  if (existing && (navigation?.type === 'reload' || navigation?.type === 'back_forward')) {
    activeDocumentBrowserSessionId = existing;
    return activeDocumentBrowserSessionId;
  }
  const created = createStableClientId('browser');
  window.sessionStorage.setItem(BROWSER_SESSION_STORAGE_KEY, created);
  activeDocumentBrowserSessionId = created;
  return activeDocumentBrowserSessionId;
};

export const getOrCreateContractDraftId = (
  userId: string,
  contractId?: string | null
): string => {
  if (contractId) return `contract-${contractId}`;
  if (typeof window === 'undefined') return `draft-${userId}`;
  const key = activeDraftStorageKey(userId);
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  return createStableClientId('draft');
};

export const activateContractDraftId = (userId: string, draftId: string): void => {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(activeDraftStorageKey(userId), draftId);
  }
};

export const createFreshContractDraftId = (userId: string): string => {
  const created = createStableClientId('draft');
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(activeDraftStorageKey(userId));
  }
  return created;
};

interface UseContractEditRecoveryInput<Payload> {
  scope: ContractRecoveryScope | null;
  contractId?: string | null;
  enabled?: boolean;
  discoverCreationDraft?: boolean;
  onDraftDiscovered?: (draftId: string) => void;
  onCreationDraftUnavailable?: () => void;
  onRecoveryAvailable?: (payload: Payload) => void;
  onRestore: (payload: Payload) => void;
}

export const useContractEditRecovery = <Payload>({
  scope,
  contractId,
  enabled = true,
  discoverCreationDraft = false,
  onDraftDiscovered,
  onCreationDraftUnavailable,
  onRecoveryAvailable,
  onRestore
}: UseContractEditRecoveryInput<Payload>) => {
  const [browserSessionId] = useState(getOrCreateContractBrowserSessionId);
  const [leaseToken, setLeaseToken] = useState<string | null>(null);
  const [blockReason, setBlockReason] = useState<ContractEditRecoveryBlockReason | null>(null);
  const [ready, setReady] = useState(false);
  const [checkpointError, setCheckpointError] = useState(false);
  const [takeoverPending, setTakeoverPending] = useState(false);
  const sequenceRef = useRef(0);
  const pendingRef = useRef<ContractRecoveryEnvelope<Payload> | null>(null);
  const checkpointTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredScopeRef = useRef<string | null>(null);
  const onRestoreRef = useRef(onRestore);
  const onRecoveryAvailableRef = useRef(onRecoveryAvailable);
  const onDraftDiscoveredRef = useRef(onDraftDiscovered);
  const onCreationDraftUnavailableRef = useRef(onCreationDraftUnavailable);
  const deactivatedRef = useRef(false);
  const blocked = blockReason !== null;

  useEffect(() => {
    onRestoreRef.current = onRestore;
  }, [onRestore]);

  useEffect(() => {
    onRecoveryAvailableRef.current = onRecoveryAvailable;
  }, [onRecoveryAvailable]);

  useEffect(() => {
    onDraftDiscoveredRef.current = onDraftDiscovered;
  }, [onDraftDiscovered]);

  useEffect(() => {
    onCreationDraftUnavailableRef.current = onCreationDraftUnavailable;
  }, [onCreationDraftUnavailable]);

  const scopeKey = scope ? getContractRecoveryStorageKey(scope) : null;

  const applyNewestRecovery = useCallback((
    local: ContractRecoveryEnvelope<Payload> | null,
    serverValue: unknown,
    mode: 'offer' | 'restore' = 'restore',
    targetScope: ContractRecoveryScope | null = scope,
  ) => {
    if (!targetScope) return;
    const server = serverValue && typeof serverValue === 'object'
      ? parseContractRecoveryEnvelope<Payload>(JSON.stringify(serverValue), targetScope)
      : null;
    const newest = selectNewestContractRecovery(local, server);
    if (!newest) return;
    sequenceRef.current = Math.max(sequenceRef.current, newest.sequence);
    const restoreKey = `${getContractRecoveryStorageKey(targetScope)}:${newest.sequence}:${newest.updatedAt}`;
    const delivery = decideContractRecoveryDelivery({
      mode,
      recoveryKey: restoreKey,
      lastRestoredKey: restoredScopeRef.current,
    });
    if (delivery === 'skip') return;
    if (delivery === 'offer' && onRecoveryAvailableRef.current) {
      onRecoveryAvailableRef.current(newest.payload);
    } else {
      restoredScopeRef.current = restoreKey;
      onRestoreRef.current(newest.payload);
    }
  }, [scope, scopeKey]);

  const acquire = useCallback(async (takeover: boolean): Promise<boolean> => {
    if (!scope || !scopeKey || deactivatedRef.current) return false;
    const local = parseContractRecoveryEnvelope<Payload>(
      window.localStorage.getItem(scopeKey),
      scope
    );
    if (takeover) setTakeoverPending(true);
    try {
      const response = await salesAPI.acquireContractEditSession(scope.draftId, {
        contractId,
        browserSessionId,
        schemaVersion: scope.schemaVersion,
        baseRevision: scope.baseRevision,
        takeover
      });
      const result = response.data.data;
      applyNewestRecovery(local, result.recovery, 'restore');
      setLeaseToken(result.session.leaseToken);
      setBlockReason(null);
      setCheckpointError(false);
      setReady(true);
      return true;
    } catch (error: any) {
      const status = error?.response?.status;
      const conflict = error?.response?.data?.data;
      if (shouldRotateUnavailableCreationDraft({
        status,
        code: conflict?.code,
        contractId,
        takeover,
      })) {
        window.localStorage.removeItem(scopeKey);
        pendingRef.current = null;
        setLeaseToken(null);
        setBlockReason(null);
        setReady(true);
        onCreationDraftUnavailableRef.current?.();
        return false;
      }
      if (status === 409 || status === 403 || takeover) {
        const failure = classifyContractEditRecoveryFailure({
          status,
          code: conflict?.code,
          phase: takeover ? 'takeover' : 'acquire'
        });
        if (failure.applyRecovery) {
          applyNewestRecovery(local, conflict?.recovery);
        }
        setLeaseToken(null);
        setBlockReason(failure.reason);
        setReady(true);
        return false;
      }
      // Offline startup keeps the local recovery visible and retries on reconnect.
      applyNewestRecovery(local, null);
      setReady(true);
      setCheckpointError(true);
      return false;
    } finally {
      if (takeover) setTakeoverPending(false);
    }
  }, [applyNewestRecovery, browserSessionId, contractId, scope, scopeKey]);

  useEffect(() => {
    if (!scope || !scopeKey) return;
    deactivatedRef.current = false;
    setReady(false);
    setLeaseToken(null);
    setBlockReason(null);
    const local = parseContractRecoveryEnvelope<Payload>(
      window.localStorage.getItem(scopeKey),
      scope
    );
    if (!enabled) {
      applyNewestRecovery(local, null, 'offer');
      if (!discoverCreationDraft) {
        setReady(true);
        return;
      }
      void salesAPI.discoverContractCreationDraft(browserSessionId)
        .then(response => {
          const discovered = response.data.data;
          if (!discovered?.draftId || !discovered.recovery) return;
          const discoveredScope: ContractRecoveryScope = {
            ...scope,
            draftId: discovered.draftId
          };
          onDraftDiscoveredRef.current?.(discovered.draftId);
          const discoveredKey = getContractRecoveryStorageKey(discoveredScope);
          const discoveredLocal = parseContractRecoveryEnvelope<Payload>(
            window.localStorage.getItem(discoveredKey),
            discoveredScope
          );
          applyNewestRecovery(discoveredLocal, discovered.recovery, 'offer', discoveredScope);
          setBlockReason(discovered.activeElsewhere ? 'owned-elsewhere' : null);
        })
        .catch(() => {
          setCheckpointError(true);
        })
        .finally(() => setReady(true));
      return;
    }
    applyNewestRecovery(local, null, 'restore');
    void acquire(false);
  }, [
    acquire,
    applyNewestRecovery,
    browserSessionId,
    discoverCreationDraft,
    enabled,
    scope,
    scopeKey
  ]);

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
        const conflict = error.response?.data?.data;
        const failure = classifyContractEditRecoveryFailure({
          status: error.response.status,
          code: conflict?.code,
          phase: 'checkpoint'
        });
        setLeaseToken(null);
        setBlockReason(failure.reason);
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
    const localRecoverySaved = persistContractRecoveryEnvelope(
      window.localStorage,
      scopeKey,
      envelope
    );
    if (!localRecoverySaved) setCheckpointError(true);
    if (checkpointTimerRef.current) clearTimeout(checkpointTimerRef.current);
    checkpointTimerRef.current = setTimeout(() => {
      checkpointTimerRef.current = null;
      void flushCheckpoint();
    }, CHECKPOINT_DELAY_MS);
  }, [blocked, flushCheckpoint, scope, scopeKey]);

  useEffect(() => {
    const handleOnline = () => {
      if (deactivatedRef.current) return;
      if (!leaseToken) {
        void acquire(false);
      } else {
        void flushCheckpoint();
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [acquire, flushCheckpoint, leaseToken]);

  useEffect(() => {
    if (!scope || !leaseToken || blocked) return;
    const heartbeat = () => {
      void salesAPI.heartbeatContractEditSession(scope.draftId, {
        browserSessionId,
        leaseToken,
        baseRevision: scope.baseRevision
      }).catch((error: any) => {
        if (error?.response?.status !== 409) {
          setCheckpointError(true);
          return;
        }
        setLeaseToken(null);
        setBlockReason('ownership-lost');
        setReady(true);
      });
    };
    const timer = window.setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [blocked, browserSessionId, leaseToken, scope]);

  useEffect(() => () => {
    if (checkpointTimerRef.current) clearTimeout(checkpointTimerRef.current);
  }, []);

  const takeover = useCallback(async () => {
    return acquire(true);
  }, [acquire]);

  const activate = useCallback(async () => acquire(false), [acquire]);

  const clearLocalRecovery = useCallback(() => {
    if (scopeKey) window.localStorage.removeItem(scopeKey);
    pendingRef.current = null;
  }, [scopeKey]);

  const release = useCallback(async () => {
    deactivatedRef.current = true;
    if (!scope || !leaseToken) {
      clearLocalRecovery();
      return;
    }
    try {
      await salesAPI.releaseContractEditSession(scope.draftId, {
        browserSessionId,
        leaseToken,
        baseRevision: scope.baseRevision
      });
    } catch (error) {
      console.error('Contract edit session cleanup failed after a successful commit:', error);
    } finally {
      clearLocalRecovery();
      setLeaseToken(null);
      setBlockReason(null);
    }
  }, [browserSessionId, clearLocalRecovery, leaseToken, scope]);

  const discard = useCallback(async () => {
    deactivatedRef.current = true;
    if (!scope) return false;
    try {
      await salesAPI.discardContractCreationDraft(scope.draftId);
      clearLocalRecovery();
      setLeaseToken(null);
      setBlockReason(null);
      return true;
    } catch (error: any) {
      if (error?.response?.status === 404) {
        clearLocalRecovery();
        setLeaseToken(null);
        setBlockReason(null);
        return true;
      }
      setCheckpointError(true);
      return false;
    }
  }, [clearLocalRecovery, scope]);

  const reloadLatestRevision = useCallback(() => {
    clearLocalRecovery();
    window.location.reload();
  }, [clearLocalRecovery]);

  const reportMutationFailure = useCallback((error: any): string | null => {
    const status = error?.response?.status;
    if (status !== 409 && status !== 403) return null;
    const conflict = error?.response?.data?.conflict;
    const failure = classifyContractEditRecoveryFailure({
      status,
      code: conflict?.code,
      phase: 'checkpoint'
    });
    setLeaseToken(null);
    setBlockReason(failure.reason);
    setReady(true);
    return getContractEditRecoveryMessage(failure.reason);
  }, []);

  return {
    ready,
    blocked,
    blockReason,
    checkpointError,
    takeoverPending,
    browserSessionId,
    leaseToken,
    activate,
    takeover,
    reloadLatestRevision,
    reportMutationFailure,
    queueRecovery,
    clearLocalRecovery,
    discard,
    release
  };
};
