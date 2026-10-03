'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ErpButton, ErpFieldView, ErpInlineState, ErpLoading, ErpWorkspacePage } from '@/components/erp';
import api, { dashboardAPI } from '@/lib/api';

type Transfer = { status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'; requestReason: string; decisionReason?: string; requestedAt: string; match: { snapshot: { displayName: string } } };
export default function TransferStatusPage() {
  const params = useParams();
  const id = String(params.id);
  const [transfer, setTransfer] = useState<Transfer>();
  const [error, setError] = useState(false);
  const [canDecide, setCanDecide] = useState(false);
  useEffect(() => {
    let active = true;
    api.get(`/crm/partner/customer-transfers/${encodeURIComponent(id)}/status`).then(response => { if (active) setTransfer(response.data.data); }).catch(() => { if (active) setError(true); });
    dashboardAPI.getRouteAvailability('/dashboard/sales/partners').then(response => { if (active) setCanDecide(response.data.data.allowed === true); }).catch(() => undefined);
    return () => { active = false; };
  }, [id]);
  return <ErpWorkspacePage title="پیگیری انتقال مشتری">
    {error ? <ErpInlineState kind="error" title="این درخواست در دسترس شما نیست یا دریافت آن انجام نشد." /> : !transfer ? <ErpLoading /> : <div className="space-y-4">
      <ErpFieldView label="مشتری" value={transfer.match.snapshot.displayName} />
      <ErpFieldView label="وضعیت" value={{ PENDING: 'در انتظار بررسی', APPROVED: 'تأییدشده', REJECTED: 'ردشده', CANCELLED: 'لغوشده' }[transfer.status]} />
      <ErpFieldView label="دلیل درخواست" value={transfer.requestReason} />
      {transfer.decisionReason && <ErpFieldView label="دلیل تصمیم" value={transfer.decisionReason} />}
      {canDecide && <ErpButton label="بررسی در مدیریت همکاران" href={`/dashboard/sales/partners?transferId=${encodeURIComponent(id)}`} />}
      {transfer.status === 'APPROVED' && <ErpInlineState kind="stale" title="انتقال، مشتری را خودکار به قرارداد متصل نمی‌کند؛ مشتری باید صریحاً در قرارداد انتخاب شود." />}
    </div>}
  </ErpWorkspacePage>;
}
