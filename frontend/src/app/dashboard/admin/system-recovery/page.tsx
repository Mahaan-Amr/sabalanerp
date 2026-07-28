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

const statusTone: Record<string, string> = {
  READY: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  VALIDATED: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  APPROVED: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  FAILED: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  INCOMPATIBLE: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
  EXPIRED: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
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
    return <div className="flex min-h-[50vh] items-center justify-center text-teal-700"><FaSpinner className="h-8 w-8 animate-spin" /></div>;
  }

  return (
    <main dir="rtl" className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="rounded-2xl bg-gradient-to-l from-[#063f3f] to-[#0b6864] p-6 text-white shadow-lg">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-teal-100"><FaShieldAlt /> فقط مدیر سامانه</div>
            <h1 className="text-2xl font-bold">پشتیبان‌گیری و بازیابی کامل سامانه</h1>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-teal-50">
              پایگاه داده اصلی، فایل‌های کسب‌وکار و داده سرویس استعلام در یک بسته رمزگذاری‌شده ثبت می‌شوند. رمز بسته در سامانه ذخیره نمی‌شود.
            </p>
          </div>
          <button onClick={() => load()} className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/30 px-4 py-2 hover:bg-white/10">
            <FaRedo /> به‌روزرسانی
          </button>
        </div>
      </header>

      {state?.sanitizedEnvironment && (
        <div className="rounded-xl border-2 border-amber-500 bg-amber-50 p-4 font-bold text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          محیط آزمایشی با داده‌های پاک‌سازی‌شده — استفاده عملیاتی ممنوع
        </div>
      )}

      {state?.stale && (
        <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <FaExclamationTriangle className="mt-1 shrink-0" />
          <div>
            <div className="font-bold">نسخه پشتیبان کامل دانلودشده به‌روز نیست</div>
            <p className="mt-1 text-sm">فایلی که فقط روی همین سرور باقی بماند، در برابر خرابی سرور محافظت ایجاد نمی‌کند.</p>
          </div>
        </div>
      )}

      {state?.runtime.mode !== 'NORMAL' && (
        <div className="rounded-xl border border-sky-300 bg-sky-50 p-4 text-sky-900 dark:bg-sky-950 dark:text-sky-100">
          وضعیت سامانه: <strong>{state?.runtime.mode}</strong> — {state?.runtime.message}
        </div>
      )}

      {error && <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-800 dark:bg-red-950 dark:text-red-100">{error}</div>}
      {message && <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-100">{message}</div>}
      {bootstrap && (
        <div className="rounded-xl border-2 border-violet-500 bg-violet-50 p-5 text-violet-950 dark:bg-violet-950 dark:text-violet-100">
          <div className="font-bold">اعتبار مدیر محلی — فقط همین یک بار نمایش داده می‌شود</div>
          <div className="mt-3 font-mono text-left" dir="ltr">username: {bootstrap.username}<br />password: {bootstrap.temporaryPassword}</div>
          <p className="mt-2 text-sm">پس از نخستین ورود، تغییر رمز اجباری است.</p>
        </div>
      )}

      <section className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={createBackup} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white"><FaDatabase className="text-teal-700" /> ساخت بسته جدید</h2>
          <label className="block text-sm font-medium">
            نوع بسته
            <select value={packageType} onChange={(event) => setPackageType(event.target.value as any)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-700 dark:bg-slate-950">
              <option value="COMPLETE">بازیابی کامل — داده دقیق عملیاتی</option>
              <option value="SANITIZED_TEST">آزمایشی پاک‌سازی‌شده — فقط Docker غیرتولیدی</option>
            </select>
          </label>
          <SecretField label="رمز فعلی مدیر" value={createPassword} onChange={setCreatePassword} />
          <SecretField label="عبارت عبور بسته (حداقل ۱۲ نویسه، شامل حرف و عدد)" value={createPassphrase} onChange={setCreatePassphrase} />
          <button disabled={busy || active} className="w-full rounded-lg bg-teal-700 px-4 py-3 font-bold text-white disabled:opacity-50">ساخت در پس‌زمینه</button>
        </form>

        <form onSubmit={uploadBackup} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white"><FaFileUpload className="text-sky-700" /> بارگذاری و اعتبارسنجی</h2>
          <label className="block text-sm font-medium">
            فایل ‎.sabrec
            <input type="file" accept=".sabrec,application/octet-stream" onChange={(event) => setUploadFile(event.target.files?.[0] || null)} className="mt-1 block w-full rounded-lg border border-slate-300 p-3 dark:border-slate-700" required />
          </label>
          <SecretField label="رمز فعلی مدیر" value={uploadPassword} onChange={setUploadPassword} />
          <SecretField label="عبارت عبور بسته" value={uploadPassphrase} onChange={setUploadPassphrase} />
          <button disabled={busy || active || !uploadFile} className="w-full rounded-lg bg-sky-700 px-4 py-3 font-bold text-white disabled:opacity-50">بارگذاری امن</button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-bold">تاریخچه عملیات</h2>
          <span className="text-sm text-slate-500">
            آخرین دانلود کامل: {state?.latestCompleteDownloadAt ? PersianCalendar.formatForDisplay(state.latestCompleteDownloadAt) : 'هرگز'}
          </span>
        </div>
        <div className="space-y-4">
          {!state?.operations.length && <div className="rounded-xl bg-slate-50 p-8 text-center text-slate-500 dark:bg-slate-950">هنوز عملیاتی ثبت نشده است.</div>}
          {state?.operations.map((operation) => (
            <article key={operation.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{operation.packageType === 'COMPLETE' ? 'بازیابی کامل' : 'آزمایشی پاک‌سازی‌شده'}</span>
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusTone[operation.status] || 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>
                      {statusLabel[operation.status] || operation.status}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-x-6 gap-y-1 text-xs text-slate-500 sm:grid-cols-2">
                    <span>ایجاد: {PersianCalendar.formatForDisplay(operation.createdAt)}</span>
                    <span>اندازه: {formatBytes(operation.size)}</span>
                    <span>عامل: {operation.createdBy ? `${operation.createdBy.firstName} ${operation.createdBy.lastName}` : 'سامانه/بازیابی‌شده'}</span>
                    <span dir="ltr" className="truncate text-left">SHA-256: {operation.encryptedSha256 || '—'}</span>
                  </div>
                  {['CREATING', 'VALIDATING', 'RESTORING'].includes(operation.status) && (
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                      <div className="h-full bg-teal-600 transition-all" style={{ width: `${operation.progress}%` }} />
                    </div>
                  )}
                  {operation.errorMessage && <p className="mt-2 text-sm text-red-700 dark:text-red-300">{operation.errorCode}: {operation.errorMessage}</p>}
                  {operation.compatibility && !operation.compatibility.compatible && (
                    <p className="mt-2 text-sm text-red-700">{operation.compatibility.reasons?.join('، ')}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {operation.status === 'READY' && (
                    <ActionButton icon={<FaCloudDownloadAlt />} label="دانلود" onClick={() => setAction({ kind: 'download', operation })} />
                  )}
                  {operation.status === 'VALIDATED' && operation.createdById !== currentUserId && (
                    <ActionButton icon={<FaCheckCircle />} label="تأیید مدیر دوم" onClick={() => setAction({ kind: 'approve', operation })} />
                  )}
                  {['VALIDATED', 'APPROVED'].includes(operation.status) && (
                    <ActionButton danger icon={<FaExclamationTriangle />} label="بازیابی" onClick={() => setAction({ kind: 'restore', operation })} />
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {action && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <form onSubmit={runAction} className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900">
            <h2 className="flex items-center gap-2 text-xl font-bold">
              {action.kind === 'download' ? <FaCloudDownloadAlt /> : action.kind === 'approve' ? <FaCheckCircle /> : <FaExclamationTriangle className="text-red-600" />}
              {action.kind === 'download' ? 'دانلود بسته' : action.kind === 'approve' ? 'تأیید بازیابی' : 'بازیابی کل سامانه'}
            </h2>
            <SecretField label="رمز فعلی مدیر" value={actionPassword} onChange={setActionPassword} />
            {action.kind === 'restore' && (
              <>
                <SecretField label="عبارت عبور بسته" value={actionPassphrase} onChange={setActionPassphrase} />
                <label className="block text-sm font-medium">
                  برای تأیید دقیقاً بنویسید: <span dir="ltr" className="font-mono">RESTORE SABALAN ERP</span>
                  <input value={confirmationPhrase} onChange={(event) => setConfirmationPhrase(event.target.value)} dir="ltr" className="mt-1 w-full rounded-lg border border-red-300 bg-white p-3 font-mono dark:bg-slate-950" required />
                </label>
                <label className="block text-sm font-medium">
                  دلیل اضطراری (در حالت تک‌مدیر اجباری)
                  <textarea value={breakGlassReason} onChange={(event) => setBreakGlassReason(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 dark:bg-slate-950" />
                </label>
                <p className="rounded-lg bg-red-50 p-3 text-sm leading-6 text-red-800 dark:bg-red-950 dark:text-red-100">
                  سامانه وارد حالت نگهداری می‌شود، داده فعال جایگزین خواهد شد و نشست همه کاربران لغو می‌شود.
                </p>
              </>
            )}
            <div className="flex gap-3">
              <button disabled={busy} className={`flex-1 rounded-lg px-4 py-3 font-bold text-white ${action.kind === 'restore' ? 'bg-red-700' : 'bg-teal-700'}`}>
                {busy ? 'در حال انجام…' : 'تأیید'}
              </button>
              <button type="button" onClick={() => setAction(null)} className="rounded-lg border border-slate-300 px-4 py-3">انصراف</button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

function SecretField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm font-medium">
      <span className="flex items-center gap-2"><FaKey className="text-slate-400" />{label}</span>
      <input type="password" autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-700 dark:bg-slate-950" required />
    </label>
  );
}

function ActionButton({ icon, label, onClick, danger = false }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-white ${danger ? 'bg-red-700' : 'bg-teal-700'}`}>
      {icon}{label}
    </button>
  );
}
