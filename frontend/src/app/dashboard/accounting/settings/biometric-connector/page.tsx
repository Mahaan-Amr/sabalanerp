'use client';

import { useCallback, useEffect, useState } from 'react';
import { FaFingerprint, FaRedo } from 'react-icons/fa';
import { ErpCard, ErpFieldView, ErpInlineState, ErpSection, ErpSkeleton, ErpStatus, ErpWorkspacePage } from '@/components/erp';
import { accountingAPI } from '@/lib/api';

interface Diagnostics {
  mode: 'SIMULATOR';
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  liveEnrollmentEnabled: false;
  checkedAt: string;
  device: { model: string; serial: string; connectorVersion: string; sdkVersion: string };
  supportedChecks: readonly string[];
}

const checkLabels: Record<string, string> = {
  'capture-quality': 'کیفیت ثبت',
  liveness: 'تشخیص زنده‌بودن انگشت',
  'one-to-one-match': 'تطبیق یک‌به‌یک',
  'retry-recovery': 'تلاش مجدد و بازیابی',
};

export default function BiometricConnectorDiagnosticsPage() {
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await accountingAPI.getBiometricConnectorDiagnostics();
      if (response.data.success) setDiagnostics(response.data.data);
    } catch (requestError: any) {
      setError(requestError.response?.status === 403 ? 'شما اجازه مشاهده وضعیت اتصال اسکنر را ندارید.' : 'دریافت وضعیت اتصال اسکنر ناموفق بود.');
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
        <ErpInlineState kind={error.includes('اجازه') ? 'permission' : 'error'} title={error} action={error.includes('اجازه') ? undefined : { label: 'تلاش مجدد', onClick: load }} />
      ) : diagnostics ? (
        <div className="space-y-4">
          {error && <ErpInlineState kind="stale" title="به‌روزرسانی ناموفق بود؛ آخرین وضعیت موفق نمایش داده می‌شود." action={{ label: 'تلاش مجدد', onClick: load }} />}
          <ErpInlineState
            kind="stale"
            title="این اتصال شبیه‌ساز است و ثبت واقعی اثر انگشت را فعال نمی‌کند."
          />
          <ErpSection title="سلامت اتصال">
            <ErpCard className="p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--sds-radius-control)] bg-[var(--sds-accent-soft)] text-[var(--sds-accent)]"><FaFingerprint aria-hidden="true" /></span>
                  <div className="min-w-0"><p className="font-bold sds-text-primary">{diagnostics.device.model}</p><p className="mt-1 text-xs sds-text-muted">شناسه دستگاه: {diagnostics.device.serial}</p></div>
                </div>
                <ErpStatus label={diagnostics.availability === 'AVAILABLE' ? 'در دسترس' : 'قطع'} tone={diagnostics.availability === 'AVAILABLE' ? 'success' : 'danger'} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <ErpFieldView label="نوع اتصال" value="شبیه‌ساز قطعی" tone="info" />
                <ErpFieldView label="ثبت واقعی" value="غیرفعال" tone="warning" />
                <ErpFieldView label="نسخه اتصال" value={diagnostics.device.connectorVersion} />
                <ErpFieldView label="نسخه SDK" value={diagnostics.device.sdkVersion} />
              </div>
            </ErpCard>
          </ErpSection>
          <ErpSection title="بررسی‌های قابل شبیه‌سازی">
            <div className="grid gap-3 sm:grid-cols-2">
              {diagnostics.supportedChecks.map((check) => <ErpFieldView key={check} label={checkLabels[check] || check} value="آماده آزمون خودکار" tone="success" />)}
            </div>
          </ErpSection>
          <p className="text-xs sds-text-muted">آخرین بررسی: {new Date(diagnostics.checkedAt).toLocaleString('fa-IR')}</p>
        </div>
      ) : null}
    </ErpWorkspacePage>
  );
}
