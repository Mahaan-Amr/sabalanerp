'use client';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ErpButton, ErpCard, ErpDisclosure, ErpField, ErpInlineState, ErpSheet, ErpTextarea } from '@/components/erp';
import PersianCalendarComponent from '@/components/PersianCalendar';
import { dispatchCreditApi, type DispatchAuthority, type DispatchCreditView } from './dispatchCreditApi';
import { userFacingError } from '@/features/dispatch/userFacingError';

const labels: Record<string, string> = { MANAGER: 'مجوز مدیریتی', CREDIT: 'ضمانت فروشنده', DATE: 'تغییر وعده پرداخت', TRANSFER: 'انتقال ضمانت',
  PENDING: 'در انتظار تصمیم', APPROVED: 'تأییدشده', REJECTED: 'ردشده', REVOKED: 'لغوشده', WITHDRAWN: 'پس‌گرفته‌شده', SUPERSEDED: 'جایگزین‌شده' };
type Operation = { kind: 'MANAGER' | 'DATE' | 'TRANSFER' | 'ACTION'; authority?: DispatchAuthority; action?: string };
const formatDate = (value: string) => new Date(value).toLocaleDateString('fa-IR', { timeZone: 'UTC' });
export default function ContractDispatchCreditPanel({ contractId, refreshKey, children, onChanged }: {
  contractId: string; refreshKey?: string; children?: ReactNode; onChanged?: () => void;
}) {
  const [view, setView] = useState<DispatchCreditView | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setView(await dispatchCreditApi.contract(contractId)); }
    catch (failure) { setError(userFacingError(failure, 'وضعیت مجوز ارسال دریافت نشد.')); }
  }, [contractId]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  const open = (next: Operation) => { setReason(''); setDate(next.authority?.promisedDate.slice(0, 10) ?? ''); setError(null); setOperation(next); };
  const save = async () => {
    if (!operation || pending) return;
    setPending(true); setError(null);
    try {
      if (operation.kind === 'ACTION') await dispatchCreditApi.act(operation.authority!.id, operation.action!, reason);
      else await dispatchCreditApi.request(contractId, { kind: operation.kind, promisedDate: date, reason,
        targetAuthorityId: operation.authority?.id, targetSellerId: operation.kind === 'TRANSFER' ? view?.responsibleSeller.id : undefined });
      setOperation(null); await load(); onChanged?.();
    } catch (failure) { setError(userFacingError(failure, 'درخواست ثبت نشد.')); }
    finally { setPending(false); }
  };
  const actions = (row: DispatchAuthority) => <div className="flex flex-wrap gap-2">
    {row.status === 'PENDING' && ((view?.access.manage && row.kind !== 'TRANSFER') || row.targetSellerId === view?.actorId) && <>
      <ErpButton label="تأیید" tone="success" onClick={() => open({ kind: 'ACTION', authority: row, action: 'APPROVE' })} />
      <ErpButton label="رد درخواست" tone="danger" variant="outline" onClick={() => open({ kind: 'ACTION', authority: row, action: 'DECLINE' })} />
    </>}
    {row.status === 'PENDING' && (view?.access.manage || row.requestedBy === view?.actorId) &&
      <ErpButton label="پس‌گرفتن درخواست" variant="outline" onClick={() => open({ kind: 'ACTION', authority: row, action: 'WITHDRAW' })} />}
    {row.status === 'APPROVED' && ['MANAGER','CREDIT'].includes(row.kind) && (view?.access.request || view?.access.seller || view?.access.manage) &&
      <ErpButton label="درخواست تغییر موعد" variant="outline" onClick={() => open({ kind: 'DATE', authority: row })} />}
    {row.id === view?.activeManagerId && view.access.manage &&
      <ErpButton label="لغو مجوز ارسال" tone="danger" variant="outline" onClick={() => open({ kind: 'ACTION', authority: row, action: 'REVOKE' })} />}
    {row.kind === 'CREDIT' && row.status === 'APPROVED' && view?.access.manage && row.sellerId !== view.responsibleSeller.id &&
      <ErpButton label={`انتقال ضمانت به ${view.responsibleSeller.displayName}`} variant="outline" onClick={() => open({ kind: 'TRANSFER', authority: row })} />}
  </div>;
  const renderRow = (row: DispatchAuthority) => <ErpCard key={row.id} className="space-y-2 p-3">
    <p>{labels[row.kind]} — {labels[row.status]}</p>
    <p className="text-sm sds-text-secondary">وعده پرداخت: {formatDate(row.promisedDate)}{row.kind === 'CREDIT' ? ` — ${BigInt(row.amountRials).toLocaleString('fa-IR')} ریال` : ''}
      {row.sellerName ? ` — ضامن: ${row.sellerName}` : ''}</p>
    {row.reason && <p className="text-sm sds-text-muted">{row.reason}</p>}{actions(row)}
  </ErpCard>;
  const needsReason = operation && (operation.kind === 'DATE' || operation.kind === 'TRANSFER' || ['DECLINE','REVOKE'].includes(operation.action ?? ''));
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2">{children}
      {(view?.access.request || view?.access.manage) && <ErpButton label="درخواست تأیید مدیریتی" variant="outline" tone="primary"
        disabled={pending || !view.canRequestManager || !!view.activeManagerId || view.authorities.some(row => row.kind === 'MANAGER' && row.status === 'PENDING')}
        onClick={() => open({ kind: 'MANAGER' })} />}
    </div>
    {error && !operation && <ErpInlineState kind="error" title={error} action={{ label: 'تلاش دوباره', onClick: () => void load() }} />}
    {view && <>
      <p className="text-sm sds-text-secondary">{view.eligible ? 'شرط مالی ارسال برقرار است.' : 'شرط ارسال با تأیید مالی، مجوز مدیر یا پوشش دریافت و اعتبار هنوز برقرار نیست.'}</p>
      {view.authorities.filter(row => ['PENDING','APPROVED'].includes(row.status) && ['MANAGER','CREDIT','TRANSFER','DATE'].includes(row.kind)).map(renderRow)}
      {view.authorities.some(row => !['PENDING','APPROVED'].includes(row.status)) && <ErpDisclosure title="سوابق مجوز و ضمانت">
        <div className="space-y-2">{view.authorities.filter(row => !['PENDING','APPROVED'].includes(row.status)).map(renderRow)}</div>
      </ErpDisclosure>}
    </>}
    <ErpSheet open={!!operation} onClose={() => setOperation(null)} pending={pending} presentation="modal"
      title={operation?.kind === 'ACTION' ? operation.action === 'APPROVE' ? 'تأیید درخواست' : operation.action === 'DECLINE' ? 'رد درخواست' : 'لغو درخواست یا مجوز'
        : labels[operation?.kind ?? 'MANAGER']}
      footer={<ErpButton label="ثبت" disabled={pending || (!operation?.action && !date) || (!!needsReason && !reason.trim())} onClick={() => void save()} />}>
      <div className="space-y-3">
        {operation?.kind !== 'ACTION' && operation?.kind !== 'TRANSFER' && <ErpField label="تاریخ وعده پرداخت مشتری"><PersianCalendarComponent valueFormat="gregorian"
          value={date} onChange={setDate} disablePastDates disabled={pending} /></ErpField>}
        {(needsReason || operation?.kind === 'ACTION') && <ErpField label={needsReason ? 'دلیل (الزامی)' : 'توضیح'}>
          <ErpTextarea value={reason} disabled={pending} onChange={event => setReason(event.target.value)} /></ErpField>}
        {operation?.kind === 'TRANSFER' && <p>فروشنده جدید باید انتقال ضمانت را در وظایف خود بپذیرد.</p>}
        {error && <ErpInlineState kind="error" title={error} />}
      </div>
    </ErpSheet>
  </div>;
}
