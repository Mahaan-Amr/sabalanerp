'use client';

import { useCallback, useEffect, useReducer, useState } from 'react';
import { FaCheck, FaForward, FaQuestionCircle, FaReply, FaSync, FaTimes } from 'react-icons/fa';
import {
  ErpBadge,
  ErpButton,
  ErpFieldView,
  ErpField,
  ErpInput,
  ErpInlineState,
  ErpPage,
  ErpSection,
  ErpSelect,
  ErpSheet,
  ErpSkeleton,
  ErpSummaryGrid,
  ErpTextarea,
  ErpRialInput,
} from '@/components/erp';
import { hrDutyApi, type DestinationDuty } from './hrDutyApi';
import { initialDestinationDutyState, reduceDestinationDutyState } from './destinationDutyState';
import { announceCrossWorkspaceDutyChanged } from '@/features/cross-workspace-duties/crossWorkspaceDutyApi';
import { DestinationDutyClaimAction } from './DestinationDutyClaimAction';
import { downloadBlobResponse } from '@/lib/downloadFile';
import { formatNumericInputText } from '@/lib/numberFormat';

const actionPresentation: Record<string, { label: string; icon: typeof FaCheck; tone: 'success' | 'danger' | 'warning' | 'info' }> = {
  APPROVE: { label: 'تأیید', icon: FaCheck, tone: 'success' },
  REJECT: { label: 'رد', icon: FaTimes, tone: 'danger' },
  RETURN: { label: 'بازگرداندن', icon: FaReply, tone: 'warning' },
  REQUEST_CLARIFICATION: { label: 'درخواست توضیح', icon: FaQuestionCircle, tone: 'info' },
  FORWARD_TO_MANAGER: { label: 'ارسال برای تصمیم مدیر', icon: FaForward, tone: 'info' },
  RETURN_TO_SELLER: { label: 'بازگرداندن', icon: FaReply, tone: 'warning' },
  DECLINE: { label: 'رد درخواست', icon: FaTimes, tone: 'danger' },
  VERIFY: { label: 'تأیید اصلاح', icon: FaCheck, tone: 'success' },
};
const fieldLabel: Record<string, string> = { title: 'عنوان', description: 'خلاصه لازم', dueAt: 'مهلت' };
const evidenceLabel: Record<string, string> = {
  DOCUMENT: 'سند مجاز', NOTE: 'یادداشت مجاز', CHECKLIST: 'چک‌لیست مجاز',
  COLLATERAL_SCAN: 'اسکن وثیقه', COLLATERAL_RETURN_PROOF: 'مدرک بازگرداندن اصل وثیقه',
};
const eventLabel: Record<string, string> = {
  ASSIGNED: 'واگذاری وظیفه', UNASSIGNED_TRIAGE: 'ارسال به صف تعیین مسئول',
  REASSIGNED: 'واگذاری مجدد', WAIVED: 'جایگزینی وظیفه', COMPLETED: 'تکمیل وظیفه',
  CANCELLED: 'لغو وظیفه', OVERDUE: 'عبور از مهلت', MANAGER_ESCALATION: 'ارجاع به مدیر',
};
const systemReasonLabel: Record<string, string> = {
  SOURCE_CHANGED: 'تغییر وضعیت منبع', RESPONSIBILITY_CHANGED: 'تغییر مسئولیت سازمانی',
  ASSIGNEE_CHANGED: 'تغییر مسئول وظیفه', ENVELOPE_CHANGED: 'تغییر نسخه پاکت وظیفه',
  SOURCE_COMPLETED: 'تکمیل فرایند مبدأ', SOURCE_CANCELLED: 'لغو فرایند مبدأ',
};
const displayHistoryReason = (reason: string | null) => {
  if (!reason) return undefined;
  if (systemReasonLabel[reason]) return systemReasonLabel[reason];
  return /^[A-Z][A-Z0-9_]+$/.test(reason) ? 'تغییر سیستمی وظیفه' : reason;
};
const failureMessage = (error: any) => {
  const code = String(error?.response?.data?.error || '');
  if (code.includes('ASSIGNEE') || code.includes('ASSIGNMENT')) return 'این وظیفه دیگر به شما محول نیست.';
  if (code.includes('SOURCE')) return 'وضعیت منبع تغییر کرده است. فهرست را به‌روزرسانی کنید.';
  if (code.includes('ENVELOPE')) return 'نسخه وظیفه تغییر کرده است. فهرست را به‌روزرسانی کنید.';
  if (error?.response?.status === 403) return 'دسترسی شما به این وظیفه معتبر نیست.';
  if (error?.response?.status === 404) return 'این وظیفه در این فضای کاری در دسترس نیست.';
  return 'ارتباط برقرار نشد. آخرین نمایش موفق حفظ شده است.';
};

export function DestinationDutyDetail({ workspace, dutyId }: { workspace: string; dutyId: string }) {
  const [state, dispatch] = useReducer(
    reduceDestinationDutyState<DestinationDuty>,
    initialDestinationDutyState as typeof initialDestinationDutyState & { data: DestinationDuty | null },
  );
  const [reason, setReason] = useState('');
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [overrideAction, setOverrideAction] = useState<string | null>(null);
  const [eligibleAssignees, setEligibleAssignees] = useState<Array<{ id: string; displayName: string; username: string }>>([]);
  const [reassignmentTarget, setReassignmentTarget] = useState('');
  const [reassignmentReason, setReassignmentReason] = useState('');
  const [financeContext, setFinanceContext] = useState<any>(null);
  const [receipt, setReceipt] = useState({ amountRials: '', identifier: '', issuerOrGuarantor: '', custodyLocation: '', receivedAt: '', file: null as File | null });
  const [originalReturn, setOriginalReturn] = useState({ returnedTo: '', evidenceNote: '', file: null as File | null });
  const load = useCallback(async () => {
    dispatch({ type: 'start' });
    try {
      const response = await hrDutyApi.detail(workspace, dutyId);
      dispatch({ type: 'success', data: response.data.data });
      if (response.data.data.sourceActionCode.startsWith('HIRING_COLLATERAL_')) {
        const context = await hrDutyApi.hiringFinanceContext(dutyId);
        setFinanceContext(context.data.data);
        setReceipt((current) => ({ ...current, amountRials: context.data.data.amountRials || '' }));
      } else setFinanceContext(null);
      if (response.data.data.canReassign) {
        const eligible = await hrDutyApi.eligibleAssignees(workspace, dutyId);
        setEligibleAssignees(eligible.data.data);
      } else {
        setEligibleAssignees([]);
      }
    } catch (error) {
      dispatch({ type: 'failure', message: failureMessage(error) });
    }
  }, [dutyId, workspace]);
  useEffect(() => { void load(); }, [load]);

  const submitResponse = async (actionCode: string) => {
    if (!state.data || pendingAction) return;
    setPendingAction(actionCode);
    setActionError(null);
    setReasonError(null);
    try {
      await hrDutyApi.respond(state.data, actionCode, reason.trim() || null);
      announceCrossWorkspaceDutyChanged();
      setReason('');
      setOverrideAction(null);
      await load();
    } catch (error) {
      setActionError(failureMessage(error));
      await load();
    } finally {
      setPendingAction(null);
    }
  };

  const respond = (actionCode: string) => {
    if (!state.data || pendingAction) return;
    if ((state.data.responseRequiresReason || !['APPROVE', 'FORWARD_TO_MANAGER'].includes(actionCode)) && reason.trim().length < 3) {
      setReasonError('برای این اقدام، دلیل کوتاه و روشن وارد کنید.');
      return;
    }
    setReasonError(null);
    if (state.data.responseRequiresReason) {
      setOverrideAction(actionCode);
      return;
    }
    void submitResponse(actionCode);
  };

  const reassign = async () => {
    if (!state.data || pendingAction) return;
    if (!reassignmentTarget || reassignmentReason.trim().length < 3) {
      setActionError('کاربر مقصد و دلیل واگذاری مجدد را مشخص کنید.');
      return;
    }
    setPendingAction('REASSIGN');
    setActionError(null);
    try {
      await hrDutyApi.reassign(state.data, reassignmentTarget, reassignmentReason.trim());
      announceCrossWorkspaceDutyChanged();
      setReassignmentTarget('');
      setReassignmentReason('');
      await load();
    } catch (error) {
      setActionError(failureMessage(error));
      await load();
    } finally {
      setPendingAction(null);
    }
  };
  const recordReceipt = async () => {
    if (!state.data || !receipt.file || !receipt.receivedAt || !receipt.custodyLocation.trim()) return;
    setPendingAction('RECORD_RECEIPT');
    setActionError(null);
    const body = new FormData();
    Object.entries(receipt).forEach(([key, value]) => { if (value) body.append(key, value); });
    try {
      await hrDutyApi.recordHiringCollateralReceipt(state.data.id, body);
      announceCrossWorkspaceDutyChanged();
      await load();
    } catch (error) { setActionError(failureMessage(error)); }
    finally { setPendingAction(null); }
  };
  const recordOriginalReturn = async () => {
    if (!state.data || !originalReturn.file || !originalReturn.returnedTo.trim() || !originalReturn.evidenceNote.trim()) return;
    setPendingAction('RECORD_RETURN'); setActionError(null);
    const body = new FormData();
    body.append('returnedTo', originalReturn.returnedTo); body.append('evidenceNote', originalReturn.evidenceNote); body.append('file', originalReturn.file);
    try { await hrDutyApi.recordHiringCollateralReturn(state.data.id, body); announceCrossWorkspaceDutyChanged(); await load(); }
    catch (error) { setActionError(failureMessage(error)); }
    finally { setPendingAction(null); }
  };
  const downloadFinanceEvidence = async () => {
    if (!state.data || pendingAction) return;
    setPendingAction('DOWNLOAD_EVIDENCE'); setActionError(null);
    try {
      const response = await hrDutyApi.downloadHiringFinanceEvidence(state.data.id);
      downloadBlobResponse(response, financeContext?.evidenceOriginalName || financeContext?.originalName || 'finance-evidence');
    } catch (error) { setActionError(failureMessage(error)); }
    finally { setPendingAction(null); }
  };

  if (!state.data && state.loading) {
    return <ErpPage title="وظیفه بین‌واحدی" backHref={`/dashboard/${workspace}/duties`}><ErpSkeleton lines={6} /></ErpPage>;
  }
  if (!state.data) {
    return (
      <ErpPage title="وظیفه بین‌واحدی" backHref={`/dashboard/${workspace}/duties`}>
        <ErpInlineState kind={state.error?.includes('دسترسی') || state.error?.includes('محول') ? 'permission' : 'error'} title={state.error || 'وظیفه در دسترس نیست.'} actions={[
          { label: 'بازگشت به فهرست', href: `/dashboard/${workspace}/duties` },
          { label: 'تلاش دوباره', icon: FaSync, onClick: load },
        ]} />
      </ErpPage>
    );
  }

  const duty = state.data;
  return (
    <ErpPage
      eyebrow="دسترسی محدود به همین وظیفه"
      title={duty.fields.title || 'وظیفه بین‌واحدی'}
      description="این صفحه فقط اطلاعات مجاز و لازم برای همین اقدام را نمایش می‌دهد."
      backHref={`/dashboard/${workspace}/duties`}
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: load, disabled: state.loading || Boolean(pendingAction) }]}
    >
      {state.stale && <ErpInlineState kind="stale" title={state.error || 'آخرین نمایش موفق نشان داده می‌شود.'} action={{ label: 'تلاش دوباره', onClick: load }} />}
      {actionError && <ErpInlineState kind="error" title={actionError} />}
      <ErpSection title="وضعیت وظیفه">
        <ErpSummaryGrid columns={3} items={[
          { label: 'وضعیت', value: <ErpBadge tone={duty.status === 'OPEN' ? 'info' : 'neutral'}>{duty.status === 'OPEN' ? 'باز' : 'بسته'}</ErpBadge> },
          { label: 'مهلت', value: duty.dueAtDisplay, tone: duty.overdue ? 'danger' : 'neutral' },
          { label: 'نسخه', value: `${duty.sourceVersion.toLocaleString('fa-IR')} / ${duty.envelopeVersion.toLocaleString('fa-IR')}` },
        ]} />
      </ErpSection>
      {duty.access === 'AVAILABLE' && (
        <ErpSection title="دریافت مسئولیت" description="پس از دریافت، تصمیم و نتیجه این درخواست به نام شما ثبت می‌شود.">
          <DestinationDutyClaimAction duty={duty} disabled={state.loading || state.stale} onClaimed={load} />
        </ErpSection>
      )}
      <ErpSection title="اطلاعات لازم">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {Object.entries(duty.fields).map(([key, value]) => (
            <ErpFieldView key={key} label={fieldLabel[key] || key} value={key === 'dueAt' ? duty.dueAtDisplay : value || '—'} />
          ))}
        </div>
      </ErpSection>
      {duty.evidence.length > 0 && (
        <ErpSection title="شواهد مجاز" description="فقط نوع شواهدی که پاکت جاری اجازه داده است نمایش داده می‌شود.">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {duty.evidence.map((evidence) => (
              <ErpFieldView key={evidence.kind} label="نوع شاهد" value={evidenceLabel[evidence.kind] || 'شاهد مجاز وظیفه'} />
            ))}
          </div>
        </ErpSection>
      )}
      {['HIRING_COLLATERAL_VERIFY_RECEIPT', 'HIRING_COLLATERAL_VERIFY_ORIGINAL_RETURN'].includes(duty.sourceActionCode) && duty.access === 'ASSIGNEE' && duty.status === 'OPEN' && financeContext && (
        <ErpSection title="جزئیات لازم برای تأیید" description="این اطلاعات فقط در محدوده همین وظیفه حسابداری نمایش داده می‌شود.">
          <ErpSummaryGrid columns={2} items={[
            { label: 'نوع وثیقه', value: financeContext.type || '—' },
            { label: 'مبلغ', value: financeContext.amountRials ? `${formatNumericInputText(String(financeContext.amountRials)).displayText} ریال` : '—' },
            ...(duty.sourceActionCode === 'HIRING_COLLATERAL_VERIFY_RECEIPT' ? [
              { label: 'شناسه یا سریال', value: financeContext.identifier || '—' },
              { label: 'صادرکننده یا ضامن', value: financeContext.issuerOrGuarantor || '—' },
              { label: 'محل نگهداری اصل', value: financeContext.custodyLocation || '—' },
              { label: 'تاریخ دریافت', value: financeContext.receivedAt ? new Date(financeContext.receivedAt).toLocaleDateString('fa-IR') : '—' },
            ] : [
              { label: 'تحویل‌گیرنده اصل', value: financeContext.returnedTo || '—' },
              { label: 'شرح بازگرداندن', value: financeContext.evidenceNote || '—' },
            ]),
          ]} />
          <ErpButton className="mt-4" label="دریافت فایل مدرک" variant="soft" disabled={Boolean(pendingAction)} onClick={() => void downloadFinanceEvidence()} />
        </ErpSection>
      )}
      {duty.sourceActionCode === 'HIRING_COLLATERAL_RECORD_RECEIPT' && duty.access === 'ASSIGNEE' && duty.status === 'OPEN' && financeContext && (
        <ErpSection title="ثبت دریافت وثیقه" description="فقط اطلاعات لازم برای تحویل و نگهداری اصل ثبت می‌شود؛ پرونده منابع انسانی در دسترس شما قرار نمی‌گیرد.">
          <div className="grid gap-3 md:grid-cols-2">
            <ErpField label="نوع وثیقه"><ErpFieldView label="نوع" value={financeContext.type} /></ErpField>
            <ErpField label="مبلغ به ریال"><ErpRialInput value={receipt.amountRials} onValueChange={(amountRials) => setReceipt({ ...receipt, amountRials })} /></ErpField>
            <ErpField label="شناسه یا سریال"><ErpInput value={receipt.identifier} onChange={(event) => setReceipt({ ...receipt, identifier: event.target.value })} /></ErpField>
            <ErpField label="صادرکننده یا ضامن"><ErpInput value={receipt.issuerOrGuarantor} onChange={(event) => setReceipt({ ...receipt, issuerOrGuarantor: event.target.value })} /></ErpField>
            <ErpField label="محل نگهداری اصل" required><ErpInput value={receipt.custodyLocation} onChange={(event) => setReceipt({ ...receipt, custodyLocation: event.target.value })} /></ErpField>
            <ErpField label="تاریخ دریافت" required><ErpInput type="date" value={receipt.receivedAt} onChange={(event) => setReceipt({ ...receipt, receivedAt: event.target.value })} /></ErpField>
            <ErpField label="اسکن مدرک دریافت" required><ErpInput type="file" onChange={(event) => setReceipt({ ...receipt, file: event.target.files?.[0] || null })} /></ErpField>
          </div>
          <ErpButton className="mt-4" label="ثبت دریافت و ارسال برای تأیید" disabled={Boolean(pendingAction) || !receipt.file || !receipt.receivedAt || !receipt.custodyLocation.trim()} onClick={() => void recordReceipt()} />
        </ErpSection>
      )}
      {duty.sourceActionCode === 'HIRING_COLLATERAL_RECORD_ORIGINAL_RETURN' && duty.access === 'ASSIGNEE' && duty.status === 'OPEN' && financeContext && (
        <ErpSection title="ثبت بازگرداندن اصل وثیقه" description="تحویل اصل و فایل مدرک در سابقه نسخه‌شده ثبت می‌شود.">
          <div className="grid gap-3 md:grid-cols-2">
            <ErpField label="اصل وثیقه به چه کسی تحویل شد؟" required><ErpInput value={originalReturn.returnedTo} onChange={(event) => setOriginalReturn({ ...originalReturn, returnedTo: event.target.value })} /></ErpField>
            <ErpField label="شرح بازگرداندن اصل وثیقه" required><ErpTextarea value={originalReturn.evidenceNote} onChange={(event) => setOriginalReturn({ ...originalReturn, evidenceNote: event.target.value })} /></ErpField>
            <ErpField label="فایل مدرک بازگرداندن" required><ErpInput type="file" onChange={(event) => setOriginalReturn({ ...originalReturn, file: event.target.files?.[0] || null })} /></ErpField>
          </div>
          <ErpButton className="mt-4" label="ثبت بازگرداندن و ارسال برای تأیید" disabled={Boolean(pendingAction) || !originalReturn.file || !originalReturn.returnedTo.trim() || !originalReturn.evidenceNote.trim()} onClick={() => void recordOriginalReturn()} />
        </ErpSection>
      )}
      {duty.allowedActionCodes.length > 0 && duty.access === 'ASSIGNEE' && duty.status === 'OPEN' && (
        <ErpSection title="ثبت نتیجه" description="نتیجه مستقیماً و یک‌بار به فرایند مبدأ بازگردانده می‌شود.">
          <label className="sds-text-secondary mb-3 block text-sm font-semibold" htmlFor="duty-reason">دلیل برای رد، بازگرداندن یا درخواست توضیح</label>
          <ErpTextarea
            id="duty-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={Boolean(pendingAction) || state.loading || state.stale}
            aria-invalid={Boolean(reasonError)}
            aria-describedby={reasonError ? 'duty-reason-hint duty-reason-error' : 'duty-reason-hint'}
          />
          <p id="duty-reason-hint" className="sds-text-muted mt-2 text-xs">
            {duty.responseRequiresReason
              ? 'به‌دلیل اقدام مدیر سیستم روی درخواست خودش، ثبت دلیل برای همه نتیجه‌ها الزامی است.'
              : 'برای تأیید اختیاری و برای سایر نتیجه‌ها الزامی است.'}
          </p>
          {reasonError && <p id="duty-reason-error" role="alert" className="mt-2 text-sm font-semibold text-[var(--sds-danger)]">{reasonError}</p>}
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {duty.allowedActionCodes.map((actionCode) => {
              const presentation = actionPresentation[actionCode];
              if (!presentation) return null;
              return (
                <ErpButton
                  key={actionCode}
                  label={pendingAction === actionCode ? 'در حال ثبت…' : presentation.label}
                  icon={presentation.icon}
                  tone={presentation.tone}
                  variant={actionCode === 'APPROVE' ? 'solid' : 'soft'}
                  disabled={Boolean(pendingAction) || state.loading || state.stale}
                  onClick={() => respond(actionCode)}
                />
              );
            })}
          </div>
        </ErpSection>
      )}
      <ErpSheet
        open={Boolean(overrideAction)}
        onClose={() => { if (!pendingAction) setOverrideAction(null); }}
        title="تأیید اقدام مدیر سیستم"
        presentation="modal"
        dismissible={!pendingAction}
        footer={(
          <div className="flex flex-wrap justify-end gap-2">
            <ErpButton label="انصراف" variant="ghost" disabled={Boolean(pendingAction)} onClick={() => setOverrideAction(null)} />
            <ErpButton
              label="تأیید و ثبت تصمیم"
              tone="danger"
              disabled={Boolean(pendingAction)}
              onClick={() => { if (overrideAction) void submitResponse(overrideAction); }}
            />
          </div>
        )}
      >
        <p className="text-sm text-[var(--sds-text-secondary)]">
          شما ایجادکننده این درخواست هستید. تصمیم با دلیل ثبت‌شده و رویداد حسابرسی مستقل به نام مدیر سیستم ذخیره می‌شود.
        </p>
      </ErpSheet>
      {duty.canReassign && (
        <ErpSection title="واگذاری مجدد" description="مهلت و نسخه پرونده تغییر نمی‌کند و این اقدام در تاریخچه ثبت می‌شود.">
          {eligibleAssignees.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="sds-text-secondary mb-2 block text-sm font-semibold" htmlFor="duty-reassignment-target">مسئول جدید</label>
                <ErpSelect
                  id="duty-reassignment-target"
                  value={reassignmentTarget}
                  onChange={(event) => setReassignmentTarget(event.target.value)}
                  disabled={Boolean(pendingAction)}
                >
                  <option value="">انتخاب کنید</option>
                  {eligibleAssignees.map((user) => <option key={user.id} value={user.id}>{user.displayName} · @{user.username}</option>)}
                </ErpSelect>
              </div>
              <div>
                <label className="sds-text-secondary mb-2 block text-sm font-semibold" htmlFor="duty-reassignment-reason">دلیل واگذاری</label>
                <ErpTextarea
                  id="duty-reassignment-reason"
                  value={reassignmentReason}
                  onChange={(event) => setReassignmentReason(event.target.value)}
                  disabled={Boolean(pendingAction)}
                />
              </div>
              <ErpButton
                label={pendingAction === 'REASSIGN' ? 'در حال واگذاری…' : 'واگذاری مجدد'}
                tone="warning"
                variant="solid"
                disabled={Boolean(pendingAction)}
                onClick={() => void reassign()}
              />
            </div>
          ) : <ErpInlineState kind="empty" title="کاربر واجد شرایط دیگری وجود ندارد" />}
        </ErpSection>
      )}
      {duty.history.length > 0 && (
        <ErpSection title="تاریخچه وظیفه">
          <div className="space-y-3">
            {duty.history.map((event) => (
              <ErpFieldView key={event.version} label={eventLabel[event.eventCode] || 'رویداد وظیفه'} value={new Date(event.createdAt).toLocaleString('fa-IR')} hint={displayHistoryReason(event.reason)} />
            ))}
          </div>
        </ErpSection>
      )}
    </ErpPage>
  );
}
