"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  dispatchDocumentsAccessDenied,
  DispatchDocumentsOutcomeUnknownError,
  type DispatchDocumentReceipt,
  type DispatchDocumentsClient,
} from "./dispatchDocumentsClient";
import {
  buildDispatchDocumentView,
  type DispatchDocumentCase,
  type DispatchDocumentFilter,
  type DispatchDocumentWorkspace,
} from "./dispatchDocumentsViewModel";

type CommandIntent = {
  action: 'ACCEPT' | 'REJECT' | 'REPLACE';
  candidateId: string;
  loadingId: string;
  waybillId?: string;
  reason: string;
  idempotencyKey: string;
};
type SavedView = { filter: DispatchDocumentFilter; rejectionReason: string; scrollTop: number; intent?: CommandIntent };
type Notice = { kind: 'success' | 'error'; text: string };
const emptyWorkspace: DispatchDocumentWorkspace = { permission: 'VIEW', cases: [], retrievedAt: '' };
const emptyView: SavedView = { filter: 'READY', rejectionReason: '', scrollTop: 0 };
const readIntent = (value?: CommandIntent) => {
  if (!value || typeof value.candidateId !== 'string' || !value.candidateId ||
    typeof value.loadingId !== 'string' || !value.loadingId || typeof value.reason !== 'string' ||
    typeof value.idempotencyKey !== 'string' || !value.idempotencyKey) return;
  if (value.action === 'ACCEPT' || value.action === 'REJECT' ||
    (value.action === 'REPLACE' && typeof value.waybillId === 'string' && value.waybillId)) return value;
};
const numberOf = (workspace: DispatchDocumentWorkspace, filter: DispatchDocumentFilter) =>
  workspace.counts?.[filter] ?? workspace.cases.filter(item => item.state === filter).length;
const receiptNotice = (receipt: DispatchDocumentReceipt): Notice => {
  if (receipt.status === 'BLOCKED') return { kind: 'error', text: 'پرونده برای بررسی شواهد ثبت شد و سندی صادر نشد.' };
  if (receipt.status === 'REJECTED') return { kind: 'success', text: 'پرونده برای اصلاح به بخش مالک بازگردانده شد.' };
  return { kind: 'success', text: receipt.status === 'ISSUED'
    ? `بارنامه ${receipt.number} صادر شد.`
    : `بارنامه جایگزین ${receipt.number} صادر و نسخه قبلی در سابقه حفظ شد.` };
};

export function useAccountingDispatchDocuments(client: DispatchDocumentsClient, actorId: string) {
  const storageKey = `accounting:dispatch-documents:preferences:v2:${actorId}`;
  const savedAtStart = useMemo((): SavedView => {
    if (typeof window === 'undefined') return emptyView;
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || '{}') as Partial<SavedView>;
      return {
        filter: saved.filter === 'BLOCKED' || saved.filter === 'ISSUED' ? saved.filter : emptyView.filter,
        rejectionReason: typeof saved.rejectionReason === 'string' ? saved.rejectionReason : '',
        scrollTop: Number(saved.scrollTop) || 0,
        intent: readIntent(saved.intent),
      };
    } catch { return emptyView; }
  }, [storageKey]);
  const savedView = useRef(savedAtStart);
  const queueRef = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const pendingPage = useRef<{ filter: DispatchDocumentFilter; page: number; response: Promise<DispatchDocumentWorkspace> }>();
  const active = useRef(true);
  const mutationLock = useRef(false);
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [filter, setFilter] = useState(savedAtStart.filter);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ summary: DispatchDocumentCase; item: DispatchDocumentCase }>();
  const [detailStatus, setDetailStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [rejectionReason, setRejectionReason] = useState(savedAtStart.rejectionReason);
  const [replacementReason, setReplacementReason] = useState('');
  const [intent, setIntent] = useState(savedAtStart.intent);
  const [groupErrors, setGroupErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [errorDetail, setErrorDetail] = useState('');
  const view = useMemo(() => buildDispatchDocumentView(workspace, filter, selectedId), [workspace, filter, selectedId]);
  const selectedSummary = view.selectedCase;
  const selected = detail?.summary === selectedSummary ? detail?.item : undefined;
  const groupError = groupErrors.find(id => id === selectedSummary?.loadingId) ?? groupErrors[0];

  const persist = useCallback((patch: Partial<SavedView>) => {
    const next = { ...savedView.current, ...patch };
    savedView.current = next;
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)); }
    catch { /* The mounted command remains safe if browser storage is unavailable. */ }
  }, [storageKey]);

  const revokeVisibleEvidence = useCallback(() => {
    request.current++;
    setWorkspace({ permission: 'UNAUTHORIZED', cases: [], retrievedAt: new Date().toISOString() });
    setSelectedId(null);
    setDetail(undefined);
    setRejectionReason('');
    setReplacementReason('');
    setGroupErrors([]);
    setLoading(false);
    setStale(false);
    setNotice(null);
    setErrorDetail('');
    // Keep only the actor-owned identity of an unresolved command for later recovery.
    persist({ ...emptyView, intent: savedView.current.intent });
  }, [persist]);

  const load = useCallback(async () => {
    const attempt = ++request.current;
    setLoading(true);
    setNotice(null);
    try {
      if (pendingPage.current?.filter !== filter || pendingPage.current.page !== page) {
        const response = client.load(filter, page);
        pendingPage.current = { filter, page, response };
        const clear = () => {
          if (pendingPage.current?.response === response) pendingPage.current = undefined;
        };
        void response.then(clear, clear);
      }
      const next = await pendingPage.current.response;
      if (!active.current || request.current !== attempt) return;
      if (next.permission === 'UNAUTHORIZED') {
        revokeVisibleEvidence();
        return;
      }
      setWorkspace(next);
      setStale(false);
      setGroupErrors([]);
    } catch (error) {
      if (!active.current || request.current !== attempt) return;
      if (dispatchDocumentsAccessDenied(error)) {
        revokeVisibleEvidence();
        return;
      }
      setErrorDetail(error instanceof Error ? error.message : '');
      setStale(true);
      setNotice({ kind: 'error', text: 'به‌روزرسانی انجام نشد؛ آخرین نمایش موفق حفظ شده است.' });
    } finally {
      if (active.current && request.current === attempt) setLoading(false);
    }
  }, [client, filter, page, revokeVisibleEvidence]);

  useEffect(() => {
    active.current = true;
    void load();
    return () => { active.current = false; request.current++; };
  }, [load]);
  useEffect(() => {
    try { sessionStorage.removeItem('accounting:dispatch-documents:last-success:v1'); }
    catch { /* A cached snapshot is never read. */ }
  }, []);
  useEffect(() => { persist({ filter, rejectionReason }); }, [filter, persist, rejectionReason]);
  useEffect(() => {
    if (queueRef.current) queueRef.current.scrollTop = savedAtStart.scrollTop;
  }, [savedAtStart.scrollTop, view.visibleCases.length]);

  useEffect(() => {
    setDetail(undefined);
    setDetailStatus('idle');
    if (!selectedSummary) return;
    let current = true;
    setDetailStatus('loading');
    void client.read(selectedSummary).then(item => {
      if (!current) return;
      setDetail({ summary: selectedSummary, item });
      setDetailStatus('idle');
    }).catch(error => {
      if (!current) return;
      if (dispatchDocumentsAccessDenied(error)) revokeVisibleEvidence();
      else setDetailStatus('error');
    });
    return () => { current = false; };
  }, [client, detailAttempt, revokeVisibleEvidence, selectedSummary]);

  const refreshGroup = useCallback(async (loadingId: string) => {
    const attempt = request.current;
    try {
      const group = await client.loadGroup(loadingId);
      if (!active.current || attempt !== request.current) return;
      if (group.permission === 'UNAUTHORIZED') {
        revokeVisibleEvidence();
        return;
      }
      setWorkspace(previous => {
        const allPrevious = [...previous.cases, ...(previous.relatedCases ?? [])];
        const oldGroup = allPrevious.filter(row => row.loadingId === loadingId);
        // A reloaded queue already includes a recovered command's current
        // global counts even when the affected group is outside this page.
        if (!oldGroup.length) return { ...previous, permission: group.permission };
        const currentIds = new Set(previous.cases.map(row => row.id));
        const remaining = group.cases.filter(row => currentIds.has(row.id) && row.state === filter);
        const currentById = new Map(remaining.map(row => [row.id, row]));
        const cases = previous.cases.flatMap(row => {
          if (row.loadingId !== loadingId) return [row];
          const updated = currentById.get(row.id);
          return updated ? [updated] : [];
        });
        const relatedCases = [...(previous.relatedCases ?? []).filter(row => row.loadingId !== loadingId),
          ...group.cases.filter(row => !currentById.has(row.id))];
        const counts = { ...previous.counts } as NonNullable<DispatchDocumentWorkspace['counts']>;
        for (const state of ['READY', 'BLOCKED', 'ISSUED'] as const) {
          counts[state] = Math.max(0, numberOf(previous, state) - oldGroup.filter(row => row.state === state).length
            + group.cases.filter(row => row.state === state).length);
        }
        return { ...previous, permission: group.permission, cases, relatedCases, counts };
      });
      setGroupErrors(previous => previous.filter(id => id !== loadingId));
    } catch (error) {
      if (!active.current || attempt !== request.current) return;
      if (dispatchDocumentsAccessDenied(error)) revokeVisibleEvidence();
      else setGroupErrors(previous => previous.includes(loadingId) ? previous : [...previous, loadingId]);
    }
  }, [client, filter, revokeVisibleEvidence]);

  const executeIntent = async (command: CommandIntent, onReceipt?: () => void) => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setIntent(command);
    persist({ intent: command });
    setPending(true);
    setNotice(null);
    try {
      const receipt = command.action === 'REPLACE'
        ? await client.replace(command.candidateId, { reason: command.reason, idempotencyKey: command.idempotencyKey, waybillId: command.waybillId })
        : await client.decide(command.candidateId, { action: command.action, reason: command.reason, idempotencyKey: command.idempotencyKey });
      if (!active.current) return;
      setIntent(undefined);
      persist({ intent: undefined });
      setNotice(receiptNotice(receipt));
      onReceipt?.();
      await refreshGroup(command.loadingId);
    } catch (error) {
      if (!active.current) return;
      if (dispatchDocumentsAccessDenied(error)) {
        revokeVisibleEvidence();
        return;
      }
      if (error instanceof DispatchDocumentsOutcomeUnknownError) return;
      setIntent(undefined);
      persist({ intent: undefined });
      const message = error instanceof Error ? error.message : 'فرمان انجام نشد.';
      setErrorDetail(message);
      setNotice({ kind: 'error', text: message });
    } finally {
      mutationLock.current = false;
      if (active.current) setPending(false);
    }
  };

  const runDecision = (action: CommandIntent['action'], reason: string, after?: () => void) => {
    if (!selected?.loadingId || intent || loading || pending || stale || groupErrors.includes(selected.loadingId)) return;
    if (action === 'REPLACE' && !selected.bundle?.id) return;
    void executeIntent({ action, reason, candidateId: selected.id, loadingId: selected.loadingId,
      ...(action === 'REPLACE' ? { waybillId: selected.bundle?.id } : {}), idempotencyKey: crypto.randomUUID() }, after);
  };
  const recoverIntent = () => { if (intent) void executeIntent(intent); };

  const runHandoff = async (handoff: () => Promise<unknown>, success: string) => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setPending(true);
    setNotice(null);
    try {
      await handoff();
      if (!active.current) return;
      setNotice({ kind: 'success', text: success });
      setDetailAttempt(current => current + 1);
    } catch (error) {
      if (!active.current) return;
      if (dispatchDocumentsAccessDenied(error)) {
        revokeVisibleEvidence();
        return;
      }
      const message = error instanceof Error ? error.message : 'تحویل سند ممکن نشد.';
      setErrorDetail(message);
      setNotice({ kind: 'error', text: message });
    } finally {
      mutationLock.current = false;
      if (active.current) setPending(false);
    }
  };

  const selectPage = (next: number) => {
    if (pending) return;
    setSelectedId(null);
    setPage(next);
  };
  const selectFilter = (next: DispatchDocumentFilter) => {
    if (pending || next === filter) return;
    setSelectedId(null);
    setPage(1);
    setFilter(next);
  };
  return {
    workspace, filter, page: workspace.page ?? page, selectPage, selectFilter,
    selectedId, setSelectedId, rejectionReason, setRejectionReason, replacementReason, setReplacementReason,
    loading, stale, pending, notice, errorDetail, queueRef, persist, load, view,
    selected,
    detailStatus, retryDetail: () => setDetailAttempt(current => current + 1),
    groupError, retryGroup: () => { if (groupError) void refreshGroup(groupError); },
    intent, recoverIntent, runDecision, runHandoff,
  };
}
