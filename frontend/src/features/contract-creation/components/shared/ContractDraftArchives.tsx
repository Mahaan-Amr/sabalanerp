'use client';

import { useEffect, useRef, useState } from 'react';
import { ErpButton, ErpInlineState } from '@/components/erp';
import { browserSessionContinuation } from '@/lib/api';
import { readBrowserDraftArchive, readBrowserDraftArchives, type BrowserDraftArchive, type BrowserDraftArchiveCursor } from '@/lib/browserDraftArchive';

type Summary = Omit<BrowserDraftArchive, 'payloadJson'>;
const summarize = ({ payloadJson: _payloadJson, ...value }: BrowserDraftArchive): Summary => value;

/** Prior-revision drafts remain inspectable instead of silently overwriting a
 * newer contract. Downloads retain their exact producer/schema/revision. */
export function ContractDraftArchives({ userId, draftId }: { userId: string | null; draftId: string | null }) {
  const [archives, setArchives] = useState<Summary[]>([]);
  const scopeKey = JSON.stringify([userId, draftId]);
  const currentScope = useRef(scopeKey); currentScope.current = scopeKey;
  const epoch = useRef(0);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [next, setNext] = useState<BrowserDraftArchiveCursor | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let cancelled = false; epoch.current++;
    setArchives([]); setNext(null); setFailed(false); setPending(false); setLoadedScope(null);
    if (userId && draftId) void (async () => {
      const lease = await browserSessionContinuation.acquire();
      if (lease.userId !== userId) throw Error('AUTH_CONTEXT_CHANGED');
      const values = await readBrowserDraftArchives(userId, 'sales-contract', draftId,
        () => browserSessionContinuation.assertCurrent(lease));
      if (!cancelled) { setArchives(values.archives.map(summarize)); setNext(values.next); setLoadedScope(JSON.stringify([userId, draftId])); }
    })().catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; epoch.current++; };
  }, [userId, draftId]);
  const loadMore = async () => {
    if (!userId || !draftId || !next || pending || loadedScope !== scopeKey) return;
    const visit = epoch.current;
    setPending(true);
    try {
      const lease = await browserSessionContinuation.acquire();
      if (lease.userId !== userId) throw Error('AUTH_CONTEXT_CHANGED');
      const values = await readBrowserDraftArchives(userId, 'sales-contract', draftId,
        () => browserSessionContinuation.assertCurrent(lease), next);
      if (currentScope.current !== scopeKey || epoch.current !== visit) return;
      setArchives(current => [...current, ...values.archives.map(summarize)]); setNext(values.next); setFailed(false);
    } catch { if (currentScope.current === scopeKey && epoch.current === visit) setFailed(true); }
    finally { if (currentScope.current === scopeKey && epoch.current === visit) setPending(false); }
  };
  const download = async (archive: Summary) => {
    const visit = epoch.current;
    try {
      const lease = await browserSessionContinuation.acquire();
      if (lease.userId !== archive.userId) throw Error('AUTH_CONTEXT_CHANGED');
      const verified = await readBrowserDraftArchive(archive.userId, archive.id,
        () => browserSessionContinuation.assertCurrent(lease));
      browserSessionContinuation.assertCurrent(lease);
      if (currentScope.current !== scopeKey || epoch.current !== visit) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(verified, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url;
      link.download = `contract-draft-${archive.id}.json`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch { if (currentScope.current === scopeKey && epoch.current === visit) setFailed(true); }
  };
  return <>
    {failed && <ErpInlineState kind="error" title="کپی‌های پیش از تازه‌سازی قابل خواندن نیستند؛ صفحه را نبندید و بازیابی را با پشتیبانی بررسی کنید." />}
    {archives.filter(archive => archive.userId === userId && archive.draftId === draftId).map(archive => <ErpInlineState key={archive.id} kind="stale"
      title={`نوشتهٔ پیش از تازه‌سازی (${new Date(archive.capturedAt).toLocaleString('fa-IR')}) محفوظ است؛ به‌صورت خودکار جایگزین نسخهٔ فعلی قرارداد نمی‌شود.`}
      action={{ label: 'دریافت نوشتهٔ محفوظ', onClick: () => void download(archive) }} />)}
    {next && loadedScope === scopeKey && <ErpButton label="کپی‌های دیگر" variant="outline" disabled={pending} onClick={() => void loadMore()} />}
  </>;
}
