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
  FaShieldAlt,
  FaSpinner,
} from 'react-icons/fa';
import { authAPI, systemRecoveryAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';
import {
  ErpBadge,
  ErpInput,
  ErpPressable,
  ErpSelect,
  ErpSheet,
  ErpTextarea,
} from '@/components/erp';

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

const statusTone: Record<string, 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  READY: 'success',
  VALIDATED: 'info',
  APPROVED: 'success',
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
      setMessage('ساخت بسته در پس‌زمینه آغاز شد. در زمان ثبت تصویر سازگار، سامانه برای مدت کوتاهی فقط‌خواندنی است.');
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
      setMessage('بارگذاری کامل شد و اعتبارسنجی در پس‌زمینه آغاز شد. نتیجه سازگاری در فهرست نمایش داده می‌شود.');
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

  if (loading) {
    return <div className="flex min-h-[50vh] items-center justify-center text-[var(--sds-text-primary)]"><FaSpinner className="h-8 w-8 animate-spin" /></div>;
  }

  return (
    <main dir="rtl" className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="rounded-2xl bg-gradient-to-l   p-6 text-[var(--sds-text-primary)] shadow-lg">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[var(--sds-text-primary)]"><FaShieldAlt /> فقط مدیر سامانه</div>
            <h1 className="text-2xl font-bold">پشتیبان‌گیری و بازیابی کامل سامانه</h1>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-[var(--sds-text-primary)]">
              پایگاه داده اصلی، فایل‌های کسب‌وکار و داده سرویس استعلام در یک بسته رمزگذاری‌شده ثبت می‌شوند. رمز بسته در سامانه ذخیره نمی‌شود.
            </p>
          </div>
          <ErpPressable onClick={() => load()} className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--sds-border-default)] px-4 py-2 bg-[var(--sds-surface-raised)]">
            <FaRedo /> به‌روزرسانی
          </ErpPressable>
        </div>
      </header>

      {state?.sanitizedEnvironment && (
        <div className="rounded-xl border-2 border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-4 font-bold text-[var(--sds-text-primary)] bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)]">
          محیط آزمایشی با داده‌های پاک‌سازی‌شده — استفاده عملیاتی ممنوع
        </div>
      )}

      {state?.stale && (
        <div className="flex gap-3 rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-4 text-[var(--sds-text-primary)] border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)]">
          <FaExclamationTriangle className="mt-1 shrink-0" />
          <div>
            <div className="font-bold">نسخه پشتیبان کامل دانلودشده به‌روز نیست</div>
            <p className="mt-1 text-sm">فایلی که فقط روی همین سرور باقی بماند، در برابر خرابی سرور محافظت ایجاد نمی‌کند.</p>
          </div>
        </div>
      )}

      {state?.runtime.mode !== 'NORMAL' && (
        <div className="rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-4 text-[var(--sds-text-primary)] bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)]">
          وضعیت سامانه: <strong>{state?.runtime.mode}</strong> — {state?.runtime.message}
        </div>
      )}

      {error && <div className="rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-4 text-[var(--sds-text-primary)] bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)]">{error}</div>}
      {message && <div className="rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-4 text-[var(--sds-text-primary)] bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)]">{message}</div>}
      {bootstrap && (
        <div className="rounded-xl border-2 border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-5 text-[var(--sds-text-primary)] bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)]">
          <div className="font-bold">اعتبار مدیر محلی — فقط همین یک بار نمایش داده می‌شود</div>
          <div className="mt-3 font-mono text-left" dir="ltr">username: {bootstrap.username}<br />password: {bootstrap.temporaryPassword}</div>
          <p className="mt-2 text-sm">پس از نخستین ورود، تغییر رمز اجباری است.</p>
        </div>
      )}

      <section className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={createBackup} className="space-y-4 rounded-2xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-5 shadow-sm border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)]">
          <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--sds-text-primary)] text-[var(--sds-text-primary)]"><FaDatabase className="text-[var(--sds-text-primary)]" /> ساخت بسته جدید</h2>
          <label className="block text-sm font-medium">
            نوع بسته
            <ErpSelect value={packageType} onChange={(event) => setPackageType(event.target.value as any)} className="mt-1 w-full rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-3 border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)]">
              <option value="COMPLETE">بازیابی کامل — داده دقیق عملیاتی</option>
              <option value="SANITIZED_TEST">آزمایشی پاک‌سازی‌شده — فقط Docker غیرتولیدی</option>
            </ErpSelect>
          </label>
          <RecoveryCredentialEntry label="رمز فعلی مدیر" value={createPassword} onChange={setCreatePassword} />
          <RecoveryCredentialEntry label="عبارت عبور بسته (حداقل ۱۲ نویسه، شامل حرف و عدد)" value={createPassphrase} onChange={setCreatePassphrase} />
          <ErpPressable type="submit" disabled={busy || active} className="w-full rounded-lg bg-[var(--sds-surface-raised)] px-4 py-3 font-bold text-[var(--sds-text-primary)] disabled:opacity-50">ساخت در پس‌زمینه</ErpPressable>
        </form>

        <form onSubmit={uploadBackup} className="space-y-4 rounded-2xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-5 shadow-sm border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)]">
          <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--sds-text-primary)] text-[var(--sds-text-primary)]"><FaFileUpload className="text-[var(--sds-text-primary)]" /> بارگذاری و اعتبارسنجی</h2>
          <label className="block text-sm font-medium">
            فایل ‎.sabrec
            <ErpInput type="file" accept=".sabrec,application/octet-stream" onChange={(event) => setUploadFile(event.target.files?.[0] || null)} className="mt-1 block w-full rounded-lg border border-[var(--sds-border-default)] p-3 border-[var(--sds-border-default)]" required />
          </label>
          <RecoveryCredentialEntry label="رمز فعلی مدیر" value={uploadPassword} onChange={setUploadPassword} />
          <RecoveryCredentialEntry label="عبارت عبور بسته" value={uploadPassphrase} onChange={setUploadPassphrase} />
          <ErpPressable type="submit" disabled={busy || active || !uploadFile} className="w-full rounded-lg bg-[var(--sds-surface-raised)] px-4 py-3 font-bold text-[var(--sds-text-primary)] disabled:opacity-50">بارگذاری امن</ErpPressable>
        </form>
      </section>

      <section className="rounded-2xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-5 shadow-sm border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)]">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-bold">تاریخچه عملیات</h2>
          <span className="text-sm text-[var(--sds-text-primary)]">
            آخرین دانلود کامل: {state?.latestCompleteDownloadAt ? PersianCalendar.formatForDisplay(state.latestCompleteDownloadAt) : 'هرگز'}
          </span>
        </div>
        <div className="space-y-4">
          {!state?.operations.length && <div className="rounded-xl bg-[var(--sds-surface-raised)] p-8 text-center text-[var(--sds-text-primary)] bg-[var(--sds-surface-raised)]">هنوز عملیاتی ثبت نشده است.</div>}
          {state?.operations.map((operation) => (
            <article key={operation.id} className="rounded-xl border border-[var(--sds-border-default)] p-4 border-[var(--sds-border-default)]">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{operation.packageType === 'COMPLETE' ? 'بازیابی کامل' : 'آزمایشی پاک‌سازی‌شده'}</span>
                    <ErpBadge tone={statusTone[operation.status] || 'neutral'}>
                      {statusLabel[operation.status] || operation.status}
                    </ErpBadge>
                  </div>
                  <div className="mt-2 grid gap-x-6 gap-y-1 text-xs text-[var(--sds-text-primary)] sm:grid-cols-2">
                    <span>ایجاد: {PersianCalendar.formatForDisplay(operation.createdAt)}</span>
                    <span>اندازه: {formatBytes(operation.size)}</span>
                    <span>عامل: {operation.createdBy ? `${operation.createdBy.firstName} ${operation.createdBy.lastName}` : 'سامانه/بازیابی‌شده'}</span>
                    <span dir="ltr" className="truncate text-left">SHA-256: {operation.encryptedSha256 || '—'}</span>
                  </div>
                  {['CREATING', 'VALIDATING', 'RESTORING'].includes(operation.status) && (
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--sds-surface-raised)] bg-[var(--sds-surface-raised)]">
                      <div className="h-full bg-[var(--sds-surface-raised)] transition-all" style={{ width: `${operation.progress}%` }} />
                    </div>
                  )}
                  {operation.errorMessage && <p className="mt-2 text-sm text-[var(--sds-text-primary)] text-[var(--sds-text-primary)]">{operation.errorCode}: {operation.errorMessage}</p>}
                  {operation.compatibility && !operation.compatibility.compatible && (
                    <p className="mt-2 text-sm text-[var(--sds-text-primary)]">{operation.compatibility.reasons?.join('، ')}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {operation.status === 'READY' && (
                    <RecoveryOperationTrigger icon={<FaCloudDownloadAlt />} label="دانلود" onClick={() => setAction({ kind: 'download', operation })} />
                  )}
                  {operation.status === 'VALIDATED' && operation.createdById !== currentUserId && (
                    <RecoveryOperationTrigger icon={<FaCheckCircle />} label="تأیید مدیر دوم" onClick={() => setAction({ kind: 'approve', operation })} />
                  )}
                  {['VALIDATED', 'APPROVED'].includes(operation.status) && (
                    <RecoveryOperationTrigger danger icon={<FaExclamationTriangle />} label="بازیابی" onClick={() => setAction({ kind: 'restore', operation })} />
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {action && (
        <ErpSheet open onClose={() => { if (!busy) setAction(null); }} title="ØªØ£ÛŒÛŒØ¯ Ø¹Ù…Ù„ÛŒØ§Øª Ø¨Ø§Ø²ÛŒØ§Ø¨ÛŒ" presentation="modal" dismissible={!busy}>
          <form onSubmit={runAction} className="space-y-4">
            <h2 className="flex items-center gap-2 text-xl font-bold">
              {action.kind === 'download' ? <FaCloudDownloadAlt /> : action.kind === 'approve' ? <FaCheckCircle /> : <FaExclamationTriangle className="text-[var(--sds-text-primary)]" />}
              {action.kind === 'download' ? 'دانلود بسته' : action.kind === 'approve' ? 'تأیید بازیابی' : 'بازیابی کل سامانه'}
            </h2>
            <RecoveryCredentialEntry label="رمز فعلی مدیر" value={actionPassword} onChange={setActionPassword} />
            {action.kind === 'restore' && (
              <>
                <RecoveryCredentialEntry label="عبارت عبور بسته" value={actionPassphrase} onChange={setActionPassphrase} />
                <label className="block text-sm font-medium">
                  برای تأیید دقیقاً بنویسید: <span dir="ltr" className="font-mono">RESTORE SABALAN ERP</span>
                  <ErpInput value={confirmationPhrase} onChange={(event) => setConfirmationPhrase(event.target.value)} dir="ltr" className="mt-1 w-full rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-3 font-mono bg-[var(--sds-surface-raised)]" required />
                </label>
                <label className="block text-sm font-medium">
                  دلیل اضطراری (در حالت تک‌مدیر اجباری)
                  <ErpTextarea value={breakGlassReason} onChange={(event) => setBreakGlassReason(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-3 bg-[var(--sds-surface-raised)]" />
                </label>
                <p className="rounded-lg bg-[var(--sds-surface-raised)] p-3 text-sm leading-6 text-[var(--sds-text-primary)] bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)]">
                  سامانه وارد حالت نگهداری می‌شود، داده فعال جایگزین خواهد شد و نشست همه کاربران لغو می‌شود.
                </p>
              </>
            )}
            <div className="flex gap-3">
              <ErpPressable type="submit" disabled={busy} className={`flex-1 rounded-lg px-4 py-3 font-bold text-[var(--sds-text-primary)] ${action.kind === 'restore' ? 'bg-[var(--sds-surface-raised)]' : 'bg-[var(--sds-surface-raised)]'}`}>
                {busy ? 'در حال انجام…' : 'تأیید'}
              </ErpPressable>
              <ErpPressable type="button" onClick={() => setAction(null)} className="rounded-lg border border-[var(--sds-border-default)] px-4 py-3">انصراف</ErpPressable>
            </div>
          </form>
        </ErpSheet>
      )}
    </main>
  );
}

function RecoveryCredentialEntry({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm font-medium">
      <span className="flex items-center gap-2"><FaKey className="text-[var(--sds-text-primary)]" />{label}</span>
      <ErpInput type="password" autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} className="mt-1" required />
    </label>
  );
}

function RecoveryOperationTrigger({ icon, label, onClick, danger = false }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <ErpPressable onClick={onClick} tone={danger ? 'danger' : 'primary'} variant="solid" className="inline-flex items-center gap-2 px-3 py-2 text-sm font-bold">
      {icon}{label}
    </ErpPressable>
  );
}
