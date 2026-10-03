'use client';

import { useCallback, useEffect, useState } from 'react';
import { ErpButton, ErpDisclosure, ErpFieldView, ErpInlineState, ErpLoading, ErpWorkspacePage } from '@/components/erp';
import api from '@/lib/api';

type Transfer = { id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'; match: { displayName: string }; requestReason: string; requestedAt: string; decisionReason?: string };
export function CustomerTransferTracking() {
  const [items, setItems] = useState<Transfer[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const load = useCallback(async (next?: string) => {
    setPending(true); setError(false);
    try {
      const response = await api.get('/crm/partner/customer-transfers/mine', { params: next ? { cursor: next } : {} });
      const data = response.data.data as { items: Transfer[]; nextCursor?: string };
      setItems(previous => next ? [...previous, ...data.items] : data.items); setCursor(data.nextCursor);
    } catch { setError(true); } finally { setPending(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <ErpWorkspacePage title="درخواست‌های انتقال مشتری من">
    <div className="space-y-3">
      <ErpButton label="تازه‌سازی درخواست‌ها" variant="outline" disabled={pending} onClick={() => void load()} />
      {pending && <ErpLoading />}
      {error && <ErpInlineState kind="error" title="دریافت درخواست‌ها انجام نشد؛ دوباره تلاش کنید." />}
      {!pending && !error && items.length === 0 && <ErpInlineState kind="empty" title="درخواستی ثبت نشده است." />}
      {items.map(item => <ErpDisclosure key={item.id} title={item.match.displayName}>
        <div className="space-y-3">
        <ErpFieldView label="وضعیت" value={{ PENDING: 'در انتظار بررسی', APPROVED: 'تأییدشده', REJECTED: 'ردشده', CANCELLED: 'لغوشده' }[item.status]} />
        <ErpFieldView label="دلیل درخواست" value={item.requestReason} />
        <ErpFieldView label="زمان درخواست" value={new Date(item.requestedAt).toLocaleString('fa-IR')} />
        {item.decisionReason && <ErpFieldView label="دلیل تصمیم" value={item.decisionReason} />}
        {item.status === 'APPROVED' && <ErpInlineState kind="stale" title="انتقال، مشتری را خودکار به قرارداد متصل نمی‌کند؛ مشتری باید صریحاً در قرارداد انتخاب شود." />}
        </div>
      </ErpDisclosure>)}
      {cursor && <ErpButton label="نمایش درخواست‌های بیشتر" disabled={pending} onClick={() => void load(cursor)} />}
    </div>
  </ErpWorkspacePage>;
}
