"use client";

import { useCallback, useEffect, useState } from 'react';
import { FaDownload, FaSync } from 'react-icons/fa';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpField,
  ErpInlineState,
  ErpInput,
  ErpLoading,
  ErpPage,
  ErpSection,
  ErpSegmentedControl,
  ErpSelect,
} from '@/components/erp';
import { personnelPerformanceAPI } from '@/lib/api';
import { apiError } from '@/features/hr/hrUi';

type Surface = 'aggregate' | 'ranking' | 'calibration';
type CapabilityMap = Record<string, boolean>;

const levelTone: Record<string, 'danger' | 'warning' | 'success' | 'primary' | 'purple' | 'neutral'> = {
  URGENT_IMPROVEMENT: 'danger', IMPROVEMENT_NEEDED: 'warning', MEETS_EXPECTATIONS: 'success',
  EXCEEDS_EXPECTATIONS: 'primary', OUTSTANDING: 'purple',
};

export default function PerformanceInsights() {
  const [capabilities, setCapabilities] = useState<CapabilityMap>({});
  const [surface, setSurface] = useState<Surface>('aggregate');
  const [report, setReport] = useState<any>();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [evaluatorPersonnelId, setEvaluatorPersonnelId] = useState('');
  const [evaluators, setEvaluators] = useState<Array<{ id: string; firstName: string; lastName: string; employeeNumber?: string }>>([]);
  const [exportKind, setExportKind] = useState<'PDF' | 'XLSX'>('XLSX');
  const [purpose, setPurpose] = useState('بازبینی مدیریتی دوره عملکرد');
  const [exportJob, setExportJob] = useState<{ id: string; status: string; token: string }>();

  const load = useCallback(async (nextSurface: Surface = surface) => {
    setLoading(true); setError(''); setSuccess('');
    try {
      const capabilityResponse = await personnelPerformanceAPI.capabilities();
      const nextCapabilities = capabilityResponse.data.capabilities || {};
      setCapabilities(nextCapabilities);
      if (nextSurface === 'aggregate' && nextCapabilities.VIEW_PERFORMANCE_ANALYTICS) {
        setReport((await personnelPerformanceAPI.analytics()).data.analytics);
      } else if (nextSurface === 'ranking' && nextCapabilities.VIEW_NAMED_PERFORMANCE_RANKING) {
        setReport((await personnelPerformanceAPI.ranking()).data.ranking);
      } else if (nextSurface === 'calibration') {
        setReport(undefined);
        if (nextCapabilities.VIEW_EVALUATOR_CALIBRATION) setEvaluators((await personnelPerformanceAPI.calibrationEvaluators()).data.evaluators || []);
      } else setReport(undefined);
    } catch (cause) { setError(apiError(cause)); }
    finally { setLoading(false); }
  }, [surface]);

  useEffect(() => { void load(); }, [load]);

  const changeSurface = (value: string) => {
    const next = value as Surface;
    setSurface(next);
    void load(next);
  };

  const runCalibration = async () => {
    try { setPending(true); setError(''); setReport((await personnelPerformanceAPI.calibration(evaluatorPersonnelId)).data.calibration); }
    catch (cause) { setError(apiError(cause)); }
    finally { setPending(false); }
  };

  const requestExport = async () => {
    try {
      setPending(true); setError(''); setSuccess('');
      const response = await personnelPerformanceAPI.requestExport({ exportKind, reportKind: surface === 'ranking' ? 'NAMED_RANKING' : 'AGGREGATE', purpose });
      setExportJob({ id: response.data.export.id, status: response.data.export.status, token: response.data.downloadToken });
      setSuccess('درخواست خروجی در صف امن تولید قرار گرفت.');
    } catch (cause) { setError(apiError(cause)); }
    finally { setPending(false); }
  };

  const refreshExport = async () => {
    if (!exportJob) return;
    try {
      setPending(true); setError('');
      const response = await personnelPerformanceAPI.exportStatus(exportJob.id);
      setExportJob({ ...exportJob, status: response.data.export.status });
    } catch (cause) { setError(apiError(cause)); }
    finally { setPending(false); }
  };

  const downloadExport = async () => {
    if (!exportJob) return;
    try {
      setPending(true); setError('');
      const response = await personnelPerformanceAPI.downloadExport(exportJob.id, exportJob.token);
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `performance.${exportKind === 'PDF' ? 'pdf' : 'xlsx'}`; anchor.click();
      URL.revokeObjectURL(url);
      setExportJob({ ...exportJob, status: 'DOWNLOADED' });
    } catch (cause) { setError(apiError(cause)); }
    finally { setPending(false); }
  };

  if (loading && !Object.keys(capabilities).length) return <ErpLoading />;
  const canAggregate = Boolean(capabilities.VIEW_PERFORMANCE_ANALYTICS);
  const canRanking = Boolean(capabilities.VIEW_NAMED_PERFORMANCE_RANKING);
  const canCalibration = Boolean(capabilities.VIEW_EVALUATOR_CALIBRATION);
  const canExport = Boolean(capabilities.REQUEST_PERFORMANCE_EXPORT) && surface !== 'calibration' && report && !report.suppressed;

  return <ErpPage
    eyebrow="منابع انسانی · عملکرد محرمانه"
    title="تحلیل، رتبه‌بندی و خروجی عملکرد"
    description="گزارش‌ها فقط از نتیجه‌های مصوب و جمعیت مجاز ساخته می‌شوند؛ گروه‌های کوچک به‌صورت خودکار سرکوب می‌شوند."
    backHref="/dashboard/hr/personnel/performance"
    actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: () => void load(), tone: 'neutral' }]}
  >
    {error && <ErpInlineState kind="error" title={error} />}
    {success && <ErpInlineState kind="success" title={success} />}
    <ErpSegmentedControl value={surface} onChange={changeSurface} options={[
      { value: 'aggregate', label: 'تحلیل تجمیعی', disabled: !canAggregate },
      { value: 'ranking', label: 'تحلیل نام‌دار', disabled: !canRanking },
      { value: 'calibration', label: 'کالیبراسیون ارزیاب', disabled: !canCalibration },
    ]} />

    {surface === 'calibration' && canCalibration && <ErpSection title="کنترل تشخیصی ارزیاب" description="حداقل ده بخش پذیرفته‌شده از پنج Personnel و دو بازه لازم است.">
      <ErpCard className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
        <ErpField label="ارزیاب"><ErpSelect value={evaluatorPersonnelId} onChange={(event) => setEvaluatorPersonnelId(event.target.value)}><option value="">انتخاب ارزیاب</option>{evaluators.map((evaluator) => <option key={evaluator.id} value={evaluator.id}>{evaluator.firstName} {evaluator.lastName}{evaluator.employeeNumber ? ` · ${evaluator.employeeNumber}` : ''}</option>)}</ErpSelect></ErpField>
        <ErpButton label="بررسی کالیبراسیون" onClick={runCalibration} disabled={pending || !evaluatorPersonnelId.trim()} />
      </ErpCard>
      {report && <ErpCard className="mt-3 p-4">{report.sufficient
        ? <div className="grid gap-3 sm:grid-cols-3"><p>بخش پذیرفته‌شده: <strong>{report.acceptedSectionCount.toLocaleString('fa-IR')}</strong></p><p>Personnel متمایز: <strong>{report.distinctPersonnelCount.toLocaleString('fa-IR')}</strong></p><p>بازه: <strong>{report.distinctPeriodCount.toLocaleString('fa-IR')}</strong></p></div>
        : <ErpInlineState kind="empty" title={report.messageFa} />}</ErpCard>}
    </ErpSection>}

    {surface !== 'calibration' && (canAggregate || canRanking) && <ErpSection title={surface === 'ranking' ? 'گروه‌های هم‌سطح' : 'توزیع سطح‌های مصوب'}>
      {report?.suppressed && <ErpInlineState kind="permission" title={report.messageFa} />}
      {!report?.suppressed && surface === 'aggregate' && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{(report?.levelDistribution || []).map((row: any) => <ErpCard key={row.levelCode} className="p-4"><ErpBadge tone={levelTone[row.levelCode] || 'neutral'}>{row.labelFa}</ErpBadge><p className="mt-3 text-2xl font-black">{row.count.toLocaleString('fa-IR')}</p><p className="text-xs text-[var(--sds-text-muted)]">{row.percent.toLocaleString('fa-IR')}٪ جمعیت واجد شرایط</p></ErpCard>)}</div>}
      {!report?.suppressed && surface === 'aggregate' && report?.trend && <ErpCard className="mt-4 p-4"><h3 className="font-bold">روند جمعیت ثابت و قابل‌مقایسه</h3>{report.trend.suppressed
        ? <p className="mt-2 text-sm text-[var(--sds-text-muted)]">برای نمایش روند، جمعیت ثابت کافی در دسترس نیست.</p>
        : <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">{report.trend.periods.map((period: any) => <div key={period.periodKey} className="rounded-xl border border-[var(--sds-border-default)] p-3"><p className="text-sm font-bold">بازه {period.periodKey}</p><div className="mt-2 space-y-1 text-xs text-[var(--sds-text-secondary)]">{period.levelDistribution.map((row: any) => <p key={row.levelCode}>{row.labelFa}: {row.count.toLocaleString('fa-IR')}</p>)}</div></div>)}</div>}</ErpCard>}
      {!report?.suppressed && surface === 'ranking' && <div className="space-y-3">{(report?.groups || []).map((group: any) => <ErpCard key={group.levelCode} className="p-4"><ErpBadge tone={levelTone[group.levelCode] || 'neutral'}>{group.labelFa}</ErpBadge><div className="mt-3 flex flex-wrap gap-2">{group.members.map((member: any) => <span key={member.employmentRelationshipId} className="rounded-lg border border-[var(--sds-border-default)] px-3 py-2 text-sm">{member.displayName}</span>)}</div></ErpCard>)}</div>}
      {!loading && !report && <ErpEmptyState title="گزارشی برای نمایش وجود ندارد" />}
    </ErpSection>}

    {canExport && <ErpSection title="خروجی محرمانه" description="فایل پس از نخستین دانلود موفق حذف می‌شود و پیوند حداکثر پانزده دقیقه معتبر است.">
      <ErpCard className="grid gap-3 p-4 md:grid-cols-[180px_1fr_auto] md:items-end">
        <ErpField label="نوع فایل"><ErpSelect value={exportKind} onChange={(event) => setExportKind(event.target.value as 'PDF' | 'XLSX')}><option value="XLSX">Excel</option><option value="PDF">PDF</option></ErpSelect></ErpField>
        <ErpField label="هدف خروجی"><ErpInput value={purpose} onChange={(event) => setPurpose(event.target.value)} /></ErpField>
        <ErpButton label="ثبت درخواست" icon={FaDownload} onClick={requestExport} disabled={pending || purpose.trim().length < 8} />
      </ErpCard>
      {exportJob && <ErpCard className="mt-3 flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-bold">وضعیت خروجی</p><ErpBadge tone={exportJob.status === 'READY' ? 'success' : exportJob.status === 'FAILED' ? 'danger' : 'info'}>{exportJob.status === 'QUEUED' ? 'در صف' : exportJob.status === 'RUNNING' ? 'در حال تولید' : exportJob.status === 'READY' ? 'آماده دانلود' : exportJob.status === 'DOWNLOADED' ? 'دانلودشده' : 'ناموفق'}</ErpBadge></div><div className="flex gap-2"><ErpButton label="به‌روزرسانی وضعیت" icon={FaSync} tone="neutral" onClick={refreshExport} disabled={pending} />{exportJob.status === 'READY' && <ErpButton label="دانلود یک‌باره" icon={FaDownload} onClick={downloadExport} disabled={pending} />}</div></ErpCard>}
    </ErpSection>}
  </ErpPage>;
}
