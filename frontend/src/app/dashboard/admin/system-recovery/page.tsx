'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  FaCheckCircle,
  FaCloudDownloadAlt,
  FaDatabase,
  FaExclamationTriangle,
  FaFileUpload,
  FaKey,
  FaRedo,
} from 'react-icons/fa';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpInlineState,
  ErpInput,
  ErpLoading,
  ErpPage,
  ErpSection,
  ErpSelect,
  ErpSheet,
  ErpTextarea,
  ErpTone,
  erpFieldLabelClassName,
} from '@/components/erp';
import { authAPI, systemRecoveryAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';

type RecoveryOperation = {
  id: string;
  packageType: 'COMPLETE' | 'SANITIZED_TEST';
  source: string;
  status: string;
  progress: number;
  originalName?: string | null;
  encryptedSha256?: string | null;
  size?: number | null;
  compatibility?: { compatible?: boolean; reasons?: string[] } | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdById?: string | null;
  approvedById?: string | null;
  approvalExpiresAt?: string | null;
  downloadedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  createdBy?: { firstName: string; lastName: string; username: string } | null;
  approvedBy?: { firstName: string; lastName: string; username: string } | null;
};

type RecoveryState = {
  operations: RecoveryOperation[];
  runtime: { mode: string; message?: string };
  sanitizedEnvironment: boolean;
  sanitizedRestoreEnabled: boolean;
  latestCompleteDownloadAt: string | null;
  stale: boolean;
  retentionHours: number;
};

type ActionKind = 'download' | 'approve' | 'restore';

const statusLabel: Record<string, string> = {
  CREATING: 'در حال ساخت',
  READY: 'آماده دانلود',
  VALIDATING: 'در حال اعتبارسنجی',
  VALIDATED: 'اعتبارسنجی‌شده',
  APPROVED: 'تأییدشده برای بازیابی',
  INCOMPATIBLE: 'ناسازگار',
  RESTORING: 'در حال بازیابی',
  COMPLETED: 'تکمیل‌شده',
  FAILED: 'ناموفق',
  EXPIRED: 'منقضی‌شده',
};

const statusTone: Record<string, ErpTone> = {
  READY: 'success',
  VALIDATED: 'info',
  APPROVED: 'purple',
  FAILED: 'danger',
  INCOMPATIBLE: 'danger',
  EXPIRED: 'neutral',
};

const formatBytes = (value?: number | null) => {
  if (!value) return '—';
  const units = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toLocaleString('fa-IR', { maximumFractionDigits: 1 })} ${units[unit]}`;
};

const errorText = (error: any) =>
  error?.response?.data?.message || error?.response?.data?.error || 'عملیات بازیابی انجام نشد.';

export default function SystemRecoveryPage() {
  const router = useRouter();
  const [state, setState] = useState<RecoveryState | null>(null);
  const [currentUserId, setCurrentUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [packageType, setPackageType] = useState<'COMPLETE' | 'SANITIZED_TEST'>('COMPLETE');
  const [createPassword, setCreatePassword] = useState('');
  const [createPassphrase, setCreatePassphrase] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadPassword, setUploadPassword] = useState('');
  const [uploadPassphrase, setUploadPassphrase] = useState('');
  const [action, setAction] = useState<{ kind: ActionKind; operation: RecoveryOperation } | null>(null);
  const [actionPassword, setActionPassword] = useState('');
  const [actionPassphrase, setActionPassphrase] = useState('');
  const [confirmationPhrase, setConfirmationPhrase] = useState('');
  const [breakGlassReason, setBreakGlassReason] = useState('');
  const [bootstrap, setBootstrap] = useState<{ username: string; temporaryPassword: string } | null>(null);

  const load = useCallback(async (quiet = false) => {
    try {
      if (!quiet) setLoading(true);
      const [profile, response] = await Promise.all([authAPI.getMe(), systemRecoveryAPI.getState()]);
      if (profile.data.data.role !== 'ADMIN') {
        router.replace('/dashboard');
        return;
      }
      setCurrentUserId(profile.data.data.id);
      setState(response.data.data);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
    const timer = window.setInterval(() => load(true), 4000);
    return () => window.clearInterval(timer);
  }, [load]);

  const active = useMemo(
    () => state?.operations.some((item) => ['CREATING', 'VALIDATING', 'RESTORING'].includes(item.status)),
    [state],
  );

  const clearFeedback = () => {
    setError('');
    setMessage('');
  };

  const createBackup = async (event: FormEvent) => {
    event.preventDefault();
    clearFeedback();
    setBusy(true);
    try {
      await systemRecoveryAPI.createBackup({ packageType, adminPassword: createPassword, passphrase: createPassphrase });
      setCreatePassword('');
      setCreatePassphrase('');
      setMessage('ساخت بسته در پس‌زمینه آغاز شد. هنگام ثبت تصویر سازگار، سامانه برای مدت کوتاهی فقط‌خواندنی است.');
      await load(true);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const uploadBackup = async (event: FormEvent) => {
    event.preventDefault();
    if (!uploadFile) return;
    clearFeedback();
    setBusy(true);
    try {
      const data = new FormData();
      data.append('file', uploadFile);
      data.append('adminPassword', uploadPassword);
      data.append('passphrase', uploadPassphrase);
      await systemRecoveryAPI.uploadBackup(data);
      setUploadFile(null);
      setUploadPassword('');
      setUploadPassphrase('');
      setMessage('بارگذاری کامل شد و اعتبارسنجی در پس‌زمینه آغاز شد. نتیجه سازگاری در تاریخچه نمایش داده می‌شود.');
      await load(true);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const runAction = async (event: FormEvent) => {
    event.preventDefault();
    if (!action) return;
    clearFeedback();
    setBusy(true);
    try {
      if (action.kind === 'download') {
        const response = await systemRecoveryAPI.downloadBackup(action.operation.id, actionPassword);
        const url = URL.createObjectURL(response.data);
        const link = document.createElement('a');
        link.href = url;
        link.download = action.operation.originalName || 'sabalan-recovery.sabrec';
        link.click();
        URL.revokeObjectURL(url);
        setMessage('دانلود آغاز شد. فایل و عبارت عبور آن را جدا از سرور و در محل امن نگهداری کنید.');
      } else if (action.kind === 'approve') {
        await systemRecoveryAPI.approveRestore(action.operation.id, actionPassword);
        setMessage('تأیید مدیر دوم ثبت شد و ۳۰ دقیقه اعتبار دارد.');
      } else {
        const response = await systemRecoveryAPI.restore(action.operation.id, {
          adminPassword: actionPassword,
          passphrase: actionPassphrase,
          confirmationPhrase,
          breakGlassReason,
        });
        if (response.data.data.bootstrapAdmin) setBootstrap(response.data.data.bootstrapAdmin);
        setMessage('بازیابی آغاز شد. سامانه پس از ارتقا و بررسی سلامت راه‌اندازی مجدد می‌شود و همه کاربران باید دوباره وارد شوند.');
      }
      setAction(null);
      setActionPassword('');
      setActionPassphrase('');
      setConfirmationPhrase('');
      setBreakGlassReason('');
      await load(true);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="مدیریت سیستم"
      title="پشتیبان‌گیری و بازیابی کامل سامانه"
      description="پایگاه داده، فایل‌های کسب‌وکار و داده سرویس استعلام در یک بسته رمزگذاری‌شده ثبت می‌شوند. رمز بسته در سامانه ذخیره نمی‌شود."
      actions={[{ label: 'به‌روزرسانی', icon: FaRedo, onClick: () => load(), disabled: busy, tone: 'neutral', variant: 'outline' }]}
    >
      <div className="space-y-3">
        {state?.sanitizedEnvironment && (
          <ErpInlineState kind="stale" title="محیط آزمایشی با داده‌های پاک‌سازی‌شده است؛ استفاده عملیاتی ممنوع است." />
        )}
        {state?.stale && (
          <ErpInlineState kind="stale" title="نسخه پشتیبان کامل دانلودشده به‌روز نیست؛ فایل باقی‌مانده روی همین سرور در برابر خرابی سرور محافظت ایجاد نمی‌کند." />
        )}
        {state?.runtime.mode !== 'NORMAL' && (
          <ErpInlineState kind="permission" title={`وضعیت سامانه: ${state?.runtime.mode}${state?.runtime.message ? ` — ${state.runtime.message}` : ''}`} />
        )}
        {error && <ErpInlineState kind="error" title={error} />}
        {message && <ErpInlineState kind="success" title={message} />}
      </div>

      {bootstrap && (
        <ErpCard tone="purple" className="p-4 sm:p-5">
          <h2 className="sds-text-primary font-semibold">اعتبار مدیر محلی — فقط همین یک بار نمایش داده می‌شود</h2>
          <div className="sds-text-primary mt-3 font-mono text-left" dir="ltr">
            username: {bootstrap.username}<br />password: {bootstrap.temporaryPassword}
          </div>
          <p className="sds-text-muted mt-2 text-sm">پس از نخستین ورود، تغییر رمز اجباری است.</p>
        </ErpCard>
      )}

      <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <form onSubmit={createBackup}>
          <ErpSection title={<span className="inline-flex items-center gap-2"><FaDatabase aria-hidden="true" /> ساخت بسته جدید</span>} className="h-full">
            <div className="space-y-4">
              <label className="block">
                <span className={erpFieldLabelClassName}>نوع بسته</span>
                <ErpSelect value={packageType} onChange={(event) => setPackageType(event.target.value as 'COMPLETE' | 'SANITIZED_TEST')}>
                  <option value="COMPLETE">بازیابی کامل — داده دقیق عملیاتی</option>
                  <option value="SANITIZED_TEST">آزمایشی پاک‌سازی‌شده — فقط Docker غیرتولیدی</option>
                </ErpSelect>
              </label>
              <label className="block">
                <span className={`${erpFieldLabelClassName} inline-flex items-center gap-2`}><FaKey aria-hidden="true" />رمز فعلی مدیر</span>
                <ErpInput type="password" autoComplete="off" value={createPassword} onChange={(event) => setCreatePassword(event.target.value)} required />
              </label>
              <label className="block">
                <span className={`${erpFieldLabelClassName} inline-flex items-center gap-2`}><FaKey aria-hidden="true" />عبارت عبور بسته (حداقل ۱۲ نویسه، شامل حرف و عدد)</span>
                <ErpInput type="password" autoComplete="off" value={createPassphrase} onChange={(event) => setCreatePassphrase(event.target.value)} required />
              </label>
              <ErpButton type="submit" label="ساخت در پس‌زمینه" disabled={busy || active} className="min-h-11 w-full" />
            </div>
          </ErpSection>
        </form>

        <form onSubmit={uploadBackup}>
          <ErpSection title={<span className="inline-flex items-center gap-2"><FaFileUpload aria-hidden="true" /> بارگذاری و اعتبارسنجی</span>} className="h-full">
            <div className="space-y-4">
              <label className="block">
                <span className={erpFieldLabelClassName}>فایل ‎.sabrec</span>
                <ErpInput type="file" accept=".sabrec,application/octet-stream" onChange={(event) => setUploadFile(event.target.files?.[0] || null)} required />
              </label>
              <label className="block">
                <span className={`${erpFieldLabelClassName} inline-flex items-center gap-2`}><FaKey aria-hidden="true" />رمز فعلی مدیر</span>
                <ErpInput type="password" autoComplete="off" value={uploadPassword} onChange={(event) => setUploadPassword(event.target.value)} required />
              </label>
              <label className="block">
                <span className={`${erpFieldLabelClassName} inline-flex items-center gap-2`}><FaKey aria-hidden="true" />عبارت عبور بسته</span>
                <ErpInput type="password" autoComplete="off" value={uploadPassphrase} onChange={(event) => setUploadPassphrase(event.target.value)} required />
              </label>
              <ErpButton type="submit" label="بارگذاری امن" tone="info" disabled={busy || active || !uploadFile} className="min-h-11 w-full" />
            </div>
          </ErpSection>
        </form>
      </section>

      <ErpSection
        title="تاریخچه عملیات"
        description={`آخرین دانلود کامل: ${state?.latestCompleteDownloadAt ? PersianCalendar.formatForDisplay(state.latestCompleteDownloadAt) : 'هرگز'}`}
      >
        <div className="space-y-3">
          {!state?.operations.length && <ErpEmptyState title="هنوز عملیاتی ثبت نشده است" />}
          {state?.operations.map((operation) => (
            <ErpCard key={operation.id} className="p-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="sds-text-primary font-semibold">{operation.packageType === 'COMPLETE' ? 'بازیابی کامل' : 'آزمایشی پاک‌سازی‌شده'}</span>
                    <ErpBadge tone={statusTone[operation.status] || 'neutral'}>{statusLabel[operation.status] || operation.status}</ErpBadge>
                  </div>
                  <div className="sds-text-muted mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                    <span>ایجاد: {PersianCalendar.formatForDisplay(operation.createdAt)}</span>
                    <span>اندازه: {formatBytes(operation.size)}</span>
                    <span>عامل: {operation.createdBy ? `${operation.createdBy.firstName} ${operation.createdBy.lastName}` : 'سامانه/بازیابی‌شده'}</span>
                    <span dir="ltr" className="truncate text-left">SHA-256: {operation.encryptedSha256 || '—'}</span>
                  </div>
                  {['CREATING', 'VALIDATING', 'RESTORING'].includes(operation.status) && (
                    <div className="sds-skeleton mt-3 h-2 overflow-hidden rounded-full" role="progressbar" aria-label="پیشرفت عملیات" aria-valuemin={0} aria-valuemax={100} aria-valuenow={operation.progress}>
                      <div className="h-full bg-[var(--sds-accent)] transition-[width] motion-reduce:transition-none" style={{ width: `${operation.progress}%` }} />
                    </div>
                  )}
                  {operation.errorMessage && <div className="mt-3"><ErpInlineState kind="error" title={`${operation.errorCode || 'خطا'}: ${operation.errorMessage}`} /></div>}
                  {operation.compatibility && !operation.compatibility.compatible && (
                    <div className="mt-3"><ErpInlineState kind="error" title={operation.compatibility.reasons?.join('، ') || 'این بسته با سامانه سازگار نیست.'} /></div>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {operation.status === 'READY' && (
                    <ErpButton icon={FaCloudDownloadAlt} label="دانلود" onClick={() => setAction({ kind: 'download', operation })} />
                  )}
                  {operation.status === 'VALIDATED' && operation.createdById !== currentUserId && (
                    <ErpButton icon={FaCheckCircle} label="تأیید مدیر دوم" tone="success" onClick={() => setAction({ kind: 'approve', operation })} />
                  )}
                  {['VALIDATED', 'APPROVED'].includes(operation.status) && (
                    <ErpButton icon={FaExclamationTriangle} label="بازیابی" tone="danger" onClick={() => setAction({ kind: 'restore', operation })} />
                  )}
                </div>
              </div>
            </ErpCard>
          ))}
        </div>
      </ErpSection>

      <ErpSheet
        open={Boolean(action)}
        onClose={() => { if (!busy) setAction(null); }}
        title={action?.kind === 'download' ? 'دانلود بسته' : action?.kind === 'approve' ? 'تأیید بازیابی' : 'بازیابی کل سامانه'}
        presentation="modal"
        dismissible={!busy}
      >
        {action && (
          <form onSubmit={runAction} className="space-y-4">
            <label className="block">
              <span className={`${erpFieldLabelClassName} inline-flex items-center gap-2`}><FaKey aria-hidden="true" />رمز فعلی مدیر</span>
              <ErpInput type="password" autoComplete="off" value={actionPassword} onChange={(event) => setActionPassword(event.target.value)} required />
            </label>
            {action.kind === 'restore' && (
              <>
                <label className="block">
                  <span className={`${erpFieldLabelClassName} inline-flex items-center gap-2`}><FaKey aria-hidden="true" />عبارت عبور بسته</span>
                  <ErpInput type="password" autoComplete="off" value={actionPassphrase} onChange={(event) => setActionPassphrase(event.target.value)} required />
                </label>
                <label className="block">
                  <span className={erpFieldLabelClassName}>برای تأیید دقیقاً بنویسید: <span dir="ltr" className="font-mono">RESTORE SABALAN ERP</span></span>
                  <ErpInput value={confirmationPhrase} onChange={(event) => setConfirmationPhrase(event.target.value)} dir="ltr" className="font-mono" required />
                </label>
                <label className="block">
                  <span className={erpFieldLabelClassName}>دلیل اضطراری (در حالت تک‌مدیر اجباری)</span>
                  <ErpTextarea value={breakGlassReason} onChange={(event) => setBreakGlassReason(event.target.value)} />
                </label>
                <ErpInlineState kind="error" title="سامانه وارد حالت نگهداری می‌شود، داده فعال جایگزین خواهد شد و نشست همه کاربران لغو می‌شود." />
              </>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <ErpButton type="submit" label={busy ? 'در حال انجام…' : 'تأیید'} tone={action.kind === 'restore' ? 'danger' : 'primary'} disabled={busy} />
              <ErpButton label="انصراف" tone="neutral" variant="outline" onClick={() => setAction(null)} disabled={busy} />
            </div>
          </form>
        )}
      </ErpSheet>
    </ErpPage>
  );
}
