'use client';

import { useCallback, useEffect, useState } from 'react';
import { FaFingerprint, FaRedo } from 'react-icons/fa';
import { ErpFieldView, ErpInlineState, ErpSection, ErpSkeleton, ErpStatus, ErpWorkspacePage } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { biometricConnectorClient } from '@/lib/biometricConnector';

interface Diagnostics {
  mode: 'SIMULATOR' | 'PHYSICAL';
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  liveEnrollmentEnabled: boolean;
  checkedAt: string;
  device: { model: string; serial: string; connectorVersion: string; sdkVersion: string };
  supportedChecks: readonly string[];
  platform?: Record<'connector' | 'lifecycle' | 'confirmation' | 'authorization' | 'projection' | 'auditIntegrity' | 'outage' | 'sms', number>;
}

const checkLabels: Record<string, string> = {
  'capture-quality': 'کیفیت ثبت',
  liveness: 'تشخیص زنده‌بودن انگشت',
  'one-to-one-match': 'تطبیق یک‌به‌یک',
  'retry-recovery': 'تلاش مجدد و بازیابی',
  licensing: 'مجوز SDK',
};

type DiagnosticError = { kind: 'permission' | 'request'; message: string };

export default function BiometricConnectorDiagnosticsPage() {
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DiagnosticError | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const serverDiagnostics = await accountingAPI.getBiometricConnectorDiagnostics(); // Enforces permission and reads platform health.
      const local = await biometricConnectorClient.status();
      const issued = await accountingAPI.createBiometricDiagnosticCommand(local.workstationId);
      const connectorResult = await biometricConnectorClient.execute(issued.data.data);
      const completed = await accountingAPI.completeBiometricDiagnostic({ challengeId: issued.data.data.command.commandId,
        signedResponse: { response: connectorResult.response, signature: connectorResult.signature } });
      setDiagnostics({ ...completed.data.data, platform: serverDiagnostics.data.data.platform });
    } catch (requestError: any) {
      setError(requestError.response?.status === 403
        ? { kind: 'permission', message: 'شما اجازه مشاهده وضعیت اتصال اسکنر را ندارید.' }
        : { kind: 'request', message: 'دریافت وضعیت اتصال اسکنر ناموفق بود.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <ErpWorkspacePage
      title="وضعیت اسکنر اثر انگشت"
      context="حسابداری · عیب‌یابی"
      backHref="/dashboard/accounting/settings"
      secondaryActions={[{ label: 'به‌روزرسانی', icon: FaRedo, onClick: load, disabled: loading }]}
    >
      {loading && !diagnostics ? <ErpSkeleton lines={5} /> : error && !diagnostics ? (
        <ErpInlineState kind={error.kind === 'permission' ? 'permission' : 'error'} title={error.message} action={error.kind === 'permission' ? undefined : { label: 'تلاش مجدد', onClick: load }} />
      ) : diagnostics ? (
        <div className="space-y-4">
          {error && <ErpInlineState kind="stale" title="به‌روزرسانی ناموفق بود؛ آخرین وضعیت موفق نمایش داده می‌شود." action={{ label: 'تلاش مجدد', onClick: load }} />}
          {diagnostics.mode === 'SIMULATOR' && <ErpInlineState kind="stale" title="این اتصال شبیه‌ساز است و ثبت واقعی اثر انگشت را فعال نمی‌کند." />}
          <ErpSection title="سلامت اتصال">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--sds-radius-control)] bg-[var(--sds-accent-soft)] text-[var(--sds-accent)]"><FaFingerprint aria-hidden="true" /></span>
                <div className="min-w-0"><p className="font-bold sds-text-primary">{diagnostics.device.model}</p><p className="mt-1 text-xs sds-text-muted">شناسه دستگاه: {diagnostics.device.serial}</p></div>
              </div>
              <ErpStatus label={diagnostics.availability === 'AVAILABLE' ? 'در دسترس' : 'قطع'} tone={diagnostics.availability === 'AVAILABLE' ? 'success' : 'danger'} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ErpFieldView label="نوع اتصال" value={diagnostics.mode === 'PHYSICAL' ? 'اسکنر فیزیکی محلی' : 'شبیه‌ساز قطعی'} tone="info" />
              <ErpFieldView label="ثبت واقعی" value={diagnostics.liveEnrollmentEnabled ? 'فعال' : 'غیرفعال'} tone={diagnostics.liveEnrollmentEnabled ? 'success' : 'warning'} />
              <ErpFieldView label="نسخه اتصال" value={diagnostics.device.connectorVersion} />
              <ErpFieldView label="نسخه SDK" value={diagnostics.device.sdkVersion} />
            </div>
          </ErpSection>
          <ErpSection title="بررسی‌های پشتیبانی‌شده">
            <div className="grid gap-3 sm:grid-cols-2">
              {diagnostics.supportedChecks.map((check) => <ErpFieldView key={check} label={checkLabels[check] || check} value="آماده آزمون خودکار" tone="success" />)}
            </div>
          </ErpSection>
          {diagnostics.platform && <ErpSection title="پایش زنجیره ارسال" description="مقدار صفر یعنی مورد باز فعلی یا شکست ثبت‌شده در ۲۴ ساعت اخیر دیده نشده است؛ تطبیق روزانه موارد منقضی را به استثنای ممیزی تبدیل می‌کند.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Object.entries({ connector: 'اتصال‌گر', lifecycle: 'چرخه ثبت', confirmation: 'تأیید راننده', authorization: 'مجوز خروج', projection: 'مانده بار', auditIntegrity: 'یکپارچگی ممیزی', outage: 'خروج اضطراری', sms: 'پیامک خریدار' }).map(([key, label]) => {
                const count = diagnostics.platform![key as keyof typeof diagnostics.platform];
                return <ErpFieldView key={key} label={label} value={count === 0 ? 'سالم' : `${count} مورد نیازمند رسیدگی`} tone={count === 0 ? 'success' : 'warning'} />;
              })}
            </div>
          </ErpSection>}
          <p className="text-xs sds-text-muted">آخرین بررسی: {new Date(diagnostics.checkedAt).toLocaleString('fa-IR')}</p>
        </div>
      ) : null}
    </ErpWorkspacePage>
  );
}
