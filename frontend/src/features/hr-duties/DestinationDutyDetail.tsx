'use client';

import { useCallback, useEffect, useReducer, useState } from 'react';
import { FaCheck, FaQuestionCircle, FaReply, FaSync, FaTimes } from 'react-icons/fa';
import {
  ErpBadge,
  ErpButton,
  ErpFieldView,
  ErpInlineState,
  ErpPage,
  ErpSection,
  ErpSkeleton,
  ErpSummaryGrid,
  ErpTextarea,
} from '@/components/erp';
import { hrDutyApi, type DestinationDuty } from './hrDutyApi';
import { initialDestinationDutyState, reduceDestinationDutyState } from './destinationDutyState';

const actionPresentation: Record<string, { label: string; icon: typeof FaCheck; tone: 'success' | 'danger' | 'warning' | 'info' }> = {
  APPROVE: { label: 'تأیید', icon: FaCheck, tone: 'success' },
  REJECT: { label: 'رد', icon: FaTimes, tone: 'danger' },
  RETURN: { label: 'بازگرداندن', icon: FaReply, tone: 'warning' },
  REQUEST_CLARIFICATION: { label: 'درخواست توضیح', icon: FaQuestionCircle, tone: 'info' },
};
const fieldLabel: Record<string, string> = { title: 'عنوان', description: 'خلاصه لازم', dueAt: 'مهلت' };
const evidenceLabel: Record<string, string> = {
  DOCUMENT: 'سند مجاز', NOTE: 'یادداشت مجاز', CHECKLIST: 'چک‌لیست مجاز',
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
  const load = useCallback(async () => {
    dispatch({ type: 'start' });
    try {
      const response = await hrDutyApi.detail(workspace, dutyId);
      dispatch({ type: 'success', data: response.data.data });
    } catch (error) {
      dispatch({ type: 'failure', message: failureMessage(error) });
    }
  }, [dutyId, workspace]);
  useEffect(() => { void load(); }, [load]);

  const respond = async (actionCode: string) => {
    if (!state.data || pendingAction) return;
    if (actionCode !== 'APPROVE' && reason.trim().length < 3) {
      setReasonError('برای این اقدام، دلیل کوتاه و روشن وارد کنید.');
      return;
    }
    setPendingAction(actionCode);
    setActionError(null);
    setReasonError(null);
    try {
      await hrDutyApi.respond(state.data, actionCode, reason.trim() || null);
      setReason('');
      await load();
    } catch (error) {
      setActionError(failureMessage(error));
      await load();
    } finally {
      setPendingAction(null);
    }
  };

  if (!state.data && state.loading) {
    return <ErpPage title="وظیفه منابع انسانی" backHref={`/dashboard/${workspace}/duties`}><ErpSkeleton lines={6} /></ErpPage>;
  }
  if (!state.data) {
    return (
      <ErpPage title="وظیفه منابع انسانی" backHref={`/dashboard/${workspace}/duties`}>
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
      title={duty.fields.title || 'وظیفه منابع انسانی'}
      description="این صفحه دسترسی عمومی به پرونده منابع انسانی ایجاد نمی‌کند."
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
      {duty.allowedActionCodes.length > 0 && (
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
          <p id="duty-reason-hint" className="sds-text-muted mt-2 text-xs">برای تأیید اختیاری و برای سایر نتیجه‌ها الزامی است.</p>
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
                  onClick={() => void respond(actionCode)}
                />
              );
            })}
          </div>
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
