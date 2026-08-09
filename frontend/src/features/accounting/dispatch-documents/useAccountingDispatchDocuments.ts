'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DispatchDocumentsAuthorizationError, type DispatchDocumentsClient } from './dispatchDocumentsClient';
import { buildDispatchDocumentView, type DispatchDocumentFilter, type DispatchDocumentWorkspace } from './dispatchDocumentsViewModel';

type SavedView = { filter: DispatchDocumentFilter; selectedId: string | null; rejectionReason: string; scrollTop: number; workspace?: DispatchDocumentWorkspace };
const storageKey = 'accounting:dispatch-documents:last-success:v1';
const emptyWorkspace: DispatchDocumentWorkspace = { permission: 'VIEW', cases: [], retrievedAt: '' };

const readSavedView = (): SavedView => {
  if (typeof window === 'undefined') return { filter: 'READY', selectedId: null, rejectionReason: '', scrollTop: 0 };
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || '{}');
    return { filter: saved.filter || 'READY', selectedId: saved.selectedId || null, rejectionReason: saved.rejectionReason || '', scrollTop: Number(saved.scrollTop) || 0, workspace: saved.workspace };
  } catch {
    return { filter: 'READY', selectedId: null, rejectionReason: '', scrollTop: 0 };
  }
};

export function useAccountingDispatchDocuments(client: DispatchDocumentsClient) {
  const savedAtStart = useMemo(readSavedView, []);
  const [workspace, setWorkspace] = useState<DispatchDocumentWorkspace>(savedAtStart.workspace || emptyWorkspace);
  const [filter, setFilter] = useState<DispatchDocumentFilter>(savedAtStart.filter);
  const [selectedId, setSelectedId] = useState<string | null>(savedAtStart.selectedId);
  const [rejectionReason, setRejectionReason] = useState(savedAtStart.rejectionReason);
  const [replacementReason, setReplacementReason] = useState('');
  const [loading, setLoading] = useState(!savedAtStart.workspace);
  const [stale, setStale] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [errorDetail, setErrorDetail] = useState('');
  const queueRef = useRef<HTMLDivElement>(null);
  const savedViewRef = useRef<SavedView>(savedAtStart);
  const view = useMemo(() => buildDispatchDocumentView(workspace, filter, selectedId), [filter, selectedId, workspace]);

  const persist = useCallback((patch: Partial<SavedView>) => {
    try {
      const current = savedViewRef.current;
      const next = { ...current, scrollTop: queueRef.current?.scrollTop || current.scrollTop, ...patch };
      savedViewRef.current = next;
      sessionStorage.setItem(storageKey, JSON.stringify(next));
    } catch { /* Browser storage is optional; command safety does not depend on it. */ }
  }, []);

  const revokeVisibleEvidence = useCallback(() => {
    try { sessionStorage.removeItem(storageKey); } catch { /* never preserve authorized evidence */ }
    setWorkspace({ permission: 'UNAUTHORIZED', cases: [], retrievedAt: new Date().toISOString() });
    setSelectedId(null); setStale(false); setNotice(null); setErrorDetail('');
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setNotice(null);
    try {
      const next = await client.load();
      if (next.permission === 'UNAUTHORIZED') {
        revokeVisibleEvidence();
      } else {
        setWorkspace(next); setStale(false); persist({ workspace: next });
      }
    } catch (error) {
      if (error instanceof DispatchDocumentsAuthorizationError) {
        revokeVisibleEvidence();
        return;
      }
      const message = error instanceof Error ? error.message : 'خطای ناشناخته در بازیابی صف';
      setErrorDetail(message); setStale(true);
      setNotice({ kind: 'error', text: 'به‌روزرسانی انجام نشد؛ آخرین نمایش موفق حفظ شده است.' });
    } finally { setLoading(false); }
  }, [client, persist, revokeVisibleEvidence]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { persist({ filter, selectedId, rejectionReason }); }, [filter, persist, rejectionReason, selectedId]);
  useEffect(() => { if (queueRef.current) queueRef.current.scrollTop = savedAtStart.scrollTop; }, [savedAtStart.scrollTop, view.visibleCases.length]);

  const runCommand = useCallback(async (command: () => Promise<unknown>, success: string, after?: () => void) => {
    setPending(true); setNotice(null);
    try {
      await command(); await load(); after?.(); setNotice({ kind: 'success', text: success });
    } catch (error) {
      if (error instanceof DispatchDocumentsAuthorizationError) { revokeVisibleEvidence(); return; }
      const message = error instanceof Error ? error.message : 'فرمان انجام نشد.';
      setErrorDetail(message); setNotice({ kind: 'error', text: message });
    } finally { setPending(false); }
  }, [load, revokeVisibleEvidence]);

  const selectFilter = useCallback((next: DispatchDocumentFilter) => { setFilter(next); setSelectedId(null); }, []);

  return {
    workspace, filter, selectFilter, selectedId, setSelectedId, rejectionReason, setRejectionReason,
    replacementReason, setReplacementReason, loading, stale, pending, notice, errorDetail,
    queueRef, persist, load, runCommand, view, selected: view.selectedCase,
  };
}
