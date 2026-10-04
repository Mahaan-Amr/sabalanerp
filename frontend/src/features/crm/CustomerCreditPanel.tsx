'use client';
import { useCallback, useEffect, useState } from 'react';
import { ErpBadge, ErpButton, ErpCard, ErpField, ErpInlineState, ErpLoading, ErpRialInput, ErpSelect, ErpSheet, ErpSummaryGrid, ErpTextarea } from '@/components/erp';
import { crmAPI } from '@/lib/api';
import { userFacingError } from '@/features/dispatch/userFacingError';
import { formatCustomerCreditRials as amount } from './customerCreditPresentation';

export type CustomerCreditView = { customerId: string; trustCategory: 'NORMAL' | 'SPECIAL'; policyVersion: number;
  limitRials: string | null; usedRials: string; availableRials: string | null; deficitRials: string; canManage: boolean };
export default function CustomerCreditPanel({ customerId, onChanged }: { customerId: string; onChanged?: () => void }) {
  const [view, setView] = useState<CustomerCreditView | null>(null);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<'NORMAL' | 'SPECIAL'>('NORMAL');
  const [unlimited, setUnlimited] = useState(true);
  const [limit, setLimit] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setView((await crmAPI.getCustomerCredit(customerId)).data.data); setError(null); }
    catch (failure) { setError(userFacingError(failure, 'اعتبار مشتری دریافت نشد.')); }
  }, [customerId]);
  useEffect(() => { setView(null); void load(); }, [load]);
  const edit = () => { if (!view) return; setCategory(view.trustCategory); setUnlimited(view.limitRials === null);
    setLimit(view.limitRials ?? ''); setReason(''); setError(null); setOpen(true); };
  const save = async () => {
    if (!view || pending) return;
    setPending(true);
    try { setView((await crmAPI.updateCustomerCredit(customerId, { trustCategory: category, limitRials: unlimited ? null : limit,
      policyVersion: view.policyVersion, reason })).data.data); setOpen(false); setError(null); onChanged?.(); }
    catch (failure) { setError(userFacingError(failure, 'تنظیم اعتبار ثبت نشد.')); }
    finally { setPending(false); }
  };
  return <ErpCard className="space-y-3 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3>اعتبار مشتری</h3>
      {view?.canManage && <ErpButton label="تنظیم اعتبار" variant="outline" onClick={edit} />}</div>
    {!view && !error && <ErpLoading />}
    {view && <><ErpBadge tone={view.trustCategory === 'SPECIAL' ? 'purple' : 'neutral'}>{view.trustCategory === 'SPECIAL' ? 'مشتری خاص' : 'مشتری عادی'}</ErpBadge>
      <ErpSummaryGrid columns={3} items={[{ label: 'سقف اعتبار', value: amount(view.limitRials) },
        { label: 'اعتبار مصرف‌شده', value: amount(view.usedRials) }, { label: 'اعتبار آزاد', value: amount(view.availableRials) }]} />
      {/[1-9]/.test(view.deficitRials) && <ErpInlineState kind="stale" title={`مصرف بالاتر از سقف: ${amount(view.deficitRials)}؛ اعتبار جدید در دسترس نیست.`} />}</>}
    {error && !open && <ErpInlineState kind="error" title={error} action={{ label: 'تازه‌سازی', onClick: () => void load() }} />}
    <ErpSheet open={open} onClose={() => setOpen(false)} pending={pending} presentation="modal" title="تنظیم اعتبار مشتری"
      footer={<ErpButton label="ثبت" disabled={pending || reason.trim().length < 3 || (!unlimited && !/^\d{1,18}$/.test(limit))} onClick={() => void save()} />}>
      <div className="space-y-3"><ErpField label="دسته مشتری"><ErpSelect value={category} disabled={pending} onChange={event => setCategory(event.target.value as 'NORMAL' | 'SPECIAL')}>
        <option value="NORMAL">مشتری عادی</option><option value="SPECIAL">مشتری خاص</option></ErpSelect></ErpField>
        <ErpField label="نوع سقف"><ErpSelect value={unlimited ? 'UNLIMITED' : 'LIMITED'} disabled={pending} onChange={event => setUnlimited(event.target.value === 'UNLIMITED')}>
          <option value="UNLIMITED">نامحدود</option><option value="LIMITED">محدود</option></ErpSelect></ErpField>
        {!unlimited && <ErpField label="سقف اعتبار (ریال)"><ErpRialInput value={limit} disabled={pending} onValueChange={setLimit} /></ErpField>}
        <ErpField label="دلیل تغییر"><ErpTextarea value={reason} disabled={pending} onChange={event => setReason(event.target.value)} /></ErpField>
        {error && <ErpInlineState kind="error" title={error} />}</div>
    </ErpSheet>
  </ErpCard>;
}
