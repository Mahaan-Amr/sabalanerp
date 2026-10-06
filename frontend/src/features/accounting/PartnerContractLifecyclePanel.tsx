'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { accountingAPI } from '@/lib/api';
import { ErpButton, ErpInlineState, ErpLoading, ErpSection } from '@/components/erp';
import { FaTrashAlt } from 'react-icons/fa';
import AccountingActionModal from './AccountingActionModal';
type Action = 'DELETE' | 'DEACTIVATE' | 'REACTIVATE';
type Preview = { contract: { status: string; isInactive: boolean; inactiveReason?: string | null };
  permissions: { canDeactivate: boolean; canReactivate: boolean; canDelete: boolean };
  deleteEligibility: { blockers: Array<{ code: string; label: string; count: number }> };
  deactivationEligibility: { blockers: Array<{ code: string; label: string; count: number }> };
  pendingRequests: Array<{ id: string; kind: Action; reason: string; status: string }> };
const names: Record<Action, string> = { DELETE: 'حذف دائمی', DEACTIVATE: 'غیرفعال‌سازی', REACTIVATE: 'فعال‌سازی مجدد' };
export default function PartnerContractLifecyclePanel({ caseId, onChanged }: { caseId: string; onChanged: () => Promise<void> }) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [target, setTarget] = useState<{ action: Action; direct: boolean }>();
  const endpoint = `/accounting/contracts/partner/${encodeURIComponent(caseId)}`;
  const load = useCallback(async () => {
    try { const response = await api.get(`${endpoint}/lifecycle`); setPreview(response.data.data); setError(undefined); }
    catch { setError('دریافت وضعیت مدیریت قرارداد انجام نشد.'); }
  }, [endpoint]);
  useEffect(() => { void load(); }, [load]);
  const failureMessage = (failure: unknown) => {
    const data = (failure as { response?: { data?: { blockers?: Array<{ label: string; count: number }> } } }).response?.data;
    return data?.blockers?.length ? `اقدام متوقف شد: ${data.blockers.map(item => `${item.label}: ${item.count.toLocaleString('fa-IR')}`).join('، ')}` : 'اقدام مدیریت وضعیت قرارداد انجام نشد؛ وضعیت و مجوز را دوباره بررسی کنید.';
  };
  const submit = async (values: Record<string, string | number>) => {
    if (!target || pending) return;
    setPending(true); setError(undefined);
    try {
      await api.post(`${endpoint}/${target.direct ? 'lifecycle-actions' : 'lifecycle-requests'}`, {
        [target.direct ? 'action' : 'kind']: target.action, reason: String(values.reason || '').trim(),
      });
      if (target.direct && target.action === 'DELETE') { router.push('/dashboard/accounting/contracts'); return; }
      setTarget(undefined); await load(); await onChanged();
    } catch (failure) { setError(failureMessage(failure)); }
    finally { setPending(false); }
  };
  const decide = async (id: string, decision: 'APPROVE' | 'REJECT') => {
    if (pending) return; setPending(true); setError(undefined);
    try {
      const selected = preview?.pendingRequests.find(item => item.id === id);
      await accountingAPI.decideContractLifecycleRequest(id, { decision, ...(decision === 'REJECT' ? { reason: 'درخواست مدیریت وضعیت رد شد' } : {}) });
      if (selected?.kind === 'DELETE' && decision === 'APPROVE') { router.push('/dashboard/accounting/contracts'); return; }
      await load(); await onChanged();
    } catch (failure) { setError(failureMessage(failure)); }
    finally { setPending(false); }
  };
  const open = (action: Action, direct: boolean) => { setError(undefined); setTarget({ action, direct }); };
  if (!preview) return <ErpSection title="مدیریت وضعیت قرارداد">{error ? <ErpInlineState kind="error" title={error} action={{ label: 'تلاش دوباره', onClick: () => void load() }} /> : <ErpLoading />}</ErpSection>;
  const deletableStatus = ['DRAFT', 'CANCELLED'].includes(preview.contract.status);
  const blockers = [...(!preview.contract.isInactive ? preview.deactivationEligibility.blockers : []), ...(deletableStatus ? preview.deleteEligibility.blockers : [])];
  return <ErpSection title="مدیریت وضعیت قرارداد">
    {preview.contract.isInactive && <ErpInlineState kind="stale" title={`قرارداد غیرفعال است${preview.contract.inactiveReason ? ` — ${preview.contract.inactiveReason}` : ''}`} />}
    <div className="flex flex-wrap gap-2">
      {preview.contract.isInactive ? <ErpButton label={preview.permissions.canReactivate ? 'فعال‌سازی مجدد' : 'درخواست فعال‌سازی مجدد'} tone="success" variant="outline" disabled={pending} onClick={() => open('REACTIVATE', preview.permissions.canReactivate)} />
        : <ErpButton label={preview.permissions.canDeactivate ? 'غیرفعال‌سازی' : 'درخواست غیرفعال‌سازی'} tone="warning" variant="outline" disabled={pending} onClick={() => open('DEACTIVATE', preview.permissions.canDeactivate)} />}
      <ErpButton label={preview.permissions.canDelete ? 'حذف دائمی' : 'درخواست حذف دائمی'} icon={FaTrashAlt} tone="danger" variant="outline" disabled={pending || !deletableStatus}
        title={!deletableStatus ? 'حذف فقط برای قرارداد یادداشت یا لغوشده امکان‌پذیر است.' : undefined} onClick={() => open('DELETE', preview.permissions.canDelete)} />
    </div>
    {!deletableStatus && <ErpInlineState kind="permission" title="حذف دائمی فقط برای قرارداد یادداشت یا لغوشده و بدون وابستگی مالی یا فیزیکی امکان‌پذیر است." />}
    {blockers.map(blocker => <ErpInlineState key={blocker.code} kind="stale" title={`${blocker.label}: ${blocker.count.toLocaleString('fa-IR')}`} />)}
    {error && !target && <ErpInlineState kind="error" title={error} />}
    {preview.pendingRequests.map(request => {
      const canDecide = request.kind === 'DEACTIVATE' ? preview.permissions.canDeactivate : request.kind === 'DELETE' ? preview.permissions.canDelete : preview.permissions.canReactivate;
      return <div key={request.id} className="mt-3 space-y-2"><p className="sds-text-primary font-semibold">درخواست {names[request.kind]}</p><p className="sds-text-secondary">{request.reason}</p>
        {canDecide && <div className="flex gap-2"><ErpButton label="تأیید درخواست" disabled={pending} onClick={() => void decide(request.id, 'APPROVE')} /><ErpButton label="رد درخواست" variant="outline" tone="danger" disabled={pending} onClick={() => void decide(request.id, 'REJECT')} /></div>}</div>;
    })}
    <AccountingActionModal open={Boolean(target)} title={target ? `${target.direct ? '' : 'درخواست '}${names[target.action]} قرارداد` : ''}
      description={target?.action === 'DELETE' ? 'حذف قرارداد برگشت‌پذیر نیست؛ فقط در نبود وابستگی مسدودکننده انجام می‌شود و تاریخچهٔ حسابرسی باقی می‌ماند.' : undefined}
      fields={[{ id: 'reason', label: 'دلیل', type: 'textarea', required: true }]} submitLabel={target?.direct ? target.action === 'DELETE' ? 'حذف دائمی' : 'ثبت اقدام' : 'ثبت درخواست'}
      busy={pending} error={error} onClose={() => { if (!pending) setTarget(undefined); }} onSubmit={submit} />
  </ErpSection>;
}
