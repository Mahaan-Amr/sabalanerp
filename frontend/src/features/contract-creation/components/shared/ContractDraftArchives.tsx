'use client';

import { useEffect, useState } from 'react';
import { ErpInlineState } from '@/components/erp';
import { browserSessionContinuation } from '@/lib/api';
import { readBrowserDraftArchives, type BrowserDraftArchive } from '@/lib/browserDraftArchive';

/** Prior-revision drafts remain inspectable instead of silently overwriting a
 * newer contract. Downloads retain their exact producer/schema/revision. */
export function ContractDraftArchives({ userId, draftId }: { userId: string | null; draftId: string | null }) {
  const [archives, setArchives] = useState<BrowserDraftArchive[]>([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false; setArchives([]); setFailed(false);
    if (userId && draftId) void (async () => {
      const lease = await browserSessionContinuation.acquire();
      if (lease.userId !== userId) throw Error('AUTH_CONTEXT_CHANGED');
      const values = await readBrowserDraftArchives(userId, 'sales-contract', draftId,
        () => browserSessionContinuation.assertCurrent(lease));
      if (!cancelled) setArchives(values);
    })().catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [userId, draftId]);
  const download = async (archive: BrowserDraftArchive) => {
    try {
      const lease = await browserSessionContinuation.acquire();
      if (lease.userId !== archive.userId) throw Error('AUTH_CONTEXT_CHANGED');
      browserSessionContinuation.assertCurrent(lease);
      const url = URL.createObjectURL(new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url;
      link.download = `contract-draft-${archive.id}.json`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch { setFailed(true); }
  };
  return <>
    {failed && <ErpInlineState kind="error" title="کپی‌های پیش از تازه‌سازی قابل خواندن نیستند؛ صفحه را نبندید و بازیابی را با پشتیبانی بررسی کنید." />}
    {archives.map(archive => <ErpInlineState key={archive.id} kind="stale"
      title={`نوشتهٔ پیش از تازه‌سازی (${new Date(archive.capturedAt).toLocaleString('fa-IR')}) محفوظ است؛ به‌صورت خودکار جایگزین نسخهٔ فعلی قرارداد نمی‌شود.`}
      action={{ label: 'دریافت نوشتهٔ محفوظ', onClick: () => void download(archive) }} />)}
  </>;
}
