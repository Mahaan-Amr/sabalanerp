'use client';

import { useCallback, useEffect, useState } from 'react';
import { FaExclamationTriangle, FaPause, FaPlay, FaShieldAlt, FaSync } from 'react-icons/fa';
import {
  ErpButton,
  ErpCheckbox,
  ErpEmptyState,
  ErpField,
  ErpFieldView,
  ErpInlineState,
  ErpInput,
  ErpLoading,
  ErpPage,
  ErpSection,
  ErpSheet,
  ErpStatus,
  ErpSummaryGrid,
  ErpTextarea,
} from '@/components/erp';
import { shipmentStatementOperationsAPI } from '@/lib/api';

type Action = 'PAUSE_PLANNED' | 'PAUSE_INCIDENT' | 'RESUME';
type State = {
  control: { paused: boolean; incident: boolean; revision: number; changedAt: string; changedBy: string | null; reason: string };
  cutover: { enabled: boolean; cutoverAt: string | null; activatedAt: string | null; activatedBy: string | null } | null;
  environmentEnabled: boolean;
  effectiveActive: boolean;
  live: { totalContracts: number; evaluatedContracts: number; readinessCounts: Record<string, number> };
  events: Array<{
    id: string; revision: number; action: Action; paused: boolean; incident: boolean; actorId: string;
    reason: string; integrityHash: string; createdAt: string;
  }>;
};

const actionContent: Record<Action, { title: string; submit: string; tone: 'primary' | 'warning' | 'danger'; guidance: string }> = {
  RESUME: {
    title: 'شروع صورت‌حساب‌های ارسال', submit: 'شروع جریان', tone: 'primary',
    guidance: 'فقط وقتی شروع کنید که پنجره نگهداری پایان یافته و وضعیت production پایدار است.',
  },
  PAUSE_PLANNED: {
    title: 'توقف موقت برنامه‌ریزی‌شده', submit: 'توقف موقت', tone: 'warning',
    guidance: 'ثبت‌های جدید بعد از cutover متوقف می‌شوند؛ داده موجود و مسیر قدیمی دست‌کاری نخواهد شد.',
  },
  PAUSE_INCIDENT: {
    title: 'توقف اضطراری', submit: 'توقف اضطراری', tone: 'danger',
    guidance: 'پس از بررسی رخداد و اصلاح علت، شروع دوباره نیز به رمز مدیر، دلیل و ثبت حسابرسی نیاز دارد.',
  },
};

const faNumber = (value: number) => value.toLocaleString('fa-IR');
const faDate = (value: string | null) => value ? new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';

export default function ShipmentStatementOperationsPage() {
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [password, setPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await shipmentStatementOperationsAPI.getState();
      setState(response.data.data);
    } catch (cause: any) {
      setError(cause.response?.data?.message || cause.response?.data?.error || 'دریافت وضعیت ممکن نشد.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const openAction = (next: Action) => {
    setAction(next);
    setReason('');
    setPassword('');
    setConfirmed(false);
    setError(null);
    setMessage(null);
  };

  const closeAction = () => { if (!pending) setAction(null); };

  const submit = async () => {
    if (!action || !state) return;
    if (reason.trim().length < 8) return setError('دلیل باید حداقل ۸ نویسه باشد.');
    if (!password) return setError('رمز فعلی مدیر را وارد کنید.');
    if (!confirmed) return setError('تأیید اثر عملیات الزامی است.');
    try {
      setPending(true);
      setError(null);
      await shipmentStatementOperationsAPI.transition({
        action, reason: reason.trim(), adminPassword: password, expectedRevision: state.control.revision,
      });
      setMessage(action === 'RESUME' ? 'جریان صورت‌حساب ارسال شروع شد.' : 'جریان صورت‌حساب ارسال متوقف شد.');
      setAction(null);
      await refresh();
    } catch (cause: any) {
      setError(cause.response?.data?.message || cause.response?.data?.error || 'اجرای عملیات ممکن نشد.');
    } finally {
      setPending(false);
    }
  };

  if (loading && !state) return <ErpLoading />;
  if (!state) return <ErpEmptyState icon={FaExclamationTriangle} title="وضعیت کنترل در دسترس نیست" description={error || undefined} action={{ label: 'تلاش دوباره', onClick: refresh }} />;

  const activated = Boolean(state.cutover?.enabled && state.cutover.cutoverAt && state.environmentEnabled);
  const currentStatus = state.control.incident
    ? { label: 'توقف اضطراری', tone: 'danger' as const }
    : state.effectiveActive
      ? { label: 'در حال اجرا', tone: 'success' as const }
      : { label: 'متوقف', tone: 'warning' as const };
  const readiness = state.live.readinessCounts;

  return (
    <ErpPage
      eyebrow="مدیریت سیستم"
      title="کنترل صورت‌حساب ارسال مشتری"
      description="تعدادها زنده‌اند و به یک عدد ثابت وابسته نیستند. این کنترل فقط جریان جدید را متوقف می‌کند و داده‌های موجود را تغییر نمی‌دهد."
      backHref="/dashboard"
      actions={[{ label: loading ? 'در حال به‌روزرسانی' : 'به‌روزرسانی', icon: FaSync, onClick: refresh, disabled: loading, variant: 'soft' }]}
      metrics={[
        { label: 'کل قراردادها اکنون', value: faNumber(state.live.totalContracts), tone: 'primary' },
        { label: 'قراردادهای ارزیابی‌شده', value: faNumber(state.live.evaluatedContracts), tone: 'info' },
        { label: 'آماده', value: faNumber(readiness.READY || 0), tone: 'success' },
        { label: 'نیازمند رسیدگی', value: faNumber((readiness.REPAIR_REQUIRED || 0) + (readiness.EVIDENCE_CONFLICT || 0) + (readiness.STALE || 0)), tone: 'warning' },
      ]}
    >
      {error && <ErpInlineState kind="error" title={error} />}
      {message && <ErpInlineState kind="success" title={message} />}
      {!activated && <ErpInlineState kind="stale" title="شروع هنوز قفل است؛ ابتدا cutover امضاشده و gate محیط production باید با فرایند انتشار امن فعال شوند." />}
      {state.control.incident && <ErpInlineState kind="error" title="توقف اضطراری فعال است؛ پیش از شروع دوباره علت رخداد را بررسی و اصلاح کنید." />}

      <ErpSection title="وضعیت عملیاتی" description="تغییر وضعیت با رمز فعلی مدیر و ثبت دلیل در تاریخچه غیرقابل‌ویرایش انجام می‌شود.">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <ErpStatus label={currentStatus.label} tone={currentStatus.tone} emphasis="strong" />
          <div className="flex flex-wrap gap-2">
            {!state.control.paused && <ErpButton label="توقف موقت" icon={FaPause} tone="warning" variant="solid" onClick={() => openAction('PAUSE_PLANNED')} />}
            {!state.control.paused && <ErpButton label="توقف اضطراری" icon={FaShieldAlt} tone="danger" variant="outline" onClick={() => openAction('PAUSE_INCIDENT')} />}
            {state.control.paused && (
              <ErpButton label="شروع جریان" icon={FaPlay} tone="primary" variant="solid" disabled={!activated} onClick={() => openAction('RESUME')} />
            )}
            {state.control.paused && !state.control.incident && (
              <ErpButton label="ثبت توقف اضطراری" icon={FaShieldAlt} tone="danger" variant="outline" onClick={() => openAction('PAUSE_INCIDENT')} />
            )}
          </div>
        </div>
        <div className="mt-4">
          <ErpSummaryGrid columns={3} items={[
            { label: 'آخرین تغییر', value: faDate(state.control.changedAt) },
            { label: 'نسخه کنترل', value: faNumber(state.control.revision) },
            { label: 'زمان cutover', value: faDate(state.cutover?.cutoverAt || null) },
          ]} />
        </div>
        <div className="mt-4"><ErpFieldView label="دلیل وضعیت فعلی" value={state.control.reason} /></div>
      </ErpSection>

      <ErpSection title="تاریخچه کنترل" description="۲۰ تغییر آخر؛ شناسه hash برای بررسی یکپارچگی هر رویداد نگهداری می‌شود.">
        {state.events.length === 0 ? <ErpEmptyState title="هنوز تغییری ثبت نشده است" /> : (
          <div className="space-y-3">
            {state.events.map((event) => (
              <div key={event.id} className="rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <ErpStatus label={event.action === 'RESUME' ? 'شروع' : event.action === 'PAUSE_INCIDENT' ? 'توقف اضطراری' : 'توقف موقت'} tone={event.action === 'RESUME' ? 'success' : event.action === 'PAUSE_INCIDENT' ? 'danger' : 'warning'} />
                  <span className="text-xs text-[var(--sds-text-muted)]">نسخه {faNumber(event.revision)} · {faDate(event.createdAt)}</span>
                </div>
                <p className="mt-3 text-sm text-[var(--sds-text-primary)]">{event.reason}</p>
                <p className="mt-2 break-all font-mono text-xs text-[var(--sds-text-muted)]" dir="ltr">{event.integrityHash}</p>
              </div>
            ))}
          </div>
        )}
      </ErpSection>

      <ErpSheet open={Boolean(action)} onClose={closeAction} title={action ? actionContent[action].title : ''} presentation="modal" pending={pending} footer={action ? (
        <div className="flex flex-wrap justify-end gap-2">
          <ErpButton label="انصراف" variant="ghost" onClick={closeAction} disabled={pending} />
          <ErpButton label={pending ? 'در حال ثبت' : actionContent[action].submit} tone={actionContent[action].tone} variant="solid" onClick={submit} disabled={pending || !confirmed} />
        </div>
      ) : null}>
        {action && <div className="space-y-4">
          <ErpInlineState kind={action === 'PAUSE_INCIDENT' ? 'error' : action === 'RESUME' ? 'permission' : 'stale'} title={actionContent[action].guidance} />
          <ErpField label="دلیل" required hint="این متن در سابقه حسابرسی ذخیره می‌شود."><ErpTextarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} /></ErpField>
          <ErpField label="رمز فعلی مدیر" required><ErpInput type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></ErpField>
          <ErpCheckbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} label="اثر این عملیات بر ثبت‌های جدید را بررسی و تأیید کردم." />
        </div>}
      </ErpSheet>
    </ErpPage>
  );
}
