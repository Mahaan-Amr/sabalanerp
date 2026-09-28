'use client';

import { useEffect, useMemo, useState } from 'react';
import { FaFilePdf, FaUsers } from 'react-icons/fa';
import PersianCalendarComponent from '@/components/PersianCalendar';
import { ErpButton, ErpCard, ErpCheckboxControl, ErpEmptyState, ErpField, ErpInlineState, ErpInput, ErpPressable, ErpSection, ErpSegmentedControl, ErpSheet, ErpSkeleton, ErpSummaryGrid, ErpWorkspacePage } from '@/components/erp';
import { securityAPI } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import PersianCalendar from '@/lib/persian-calendar';

type Period = 'previous' | 'current' | 'custom';
type ReportDay = { date: string; intervals: Array<{ enteredAt: string; exitedAt: string | null }>; grossMinutes: number; netMinutes: number };
type ReportPerson = { key: string; name: string; grossMinutes: number; netMinutes: number; daysWithMovement: number; days: ReportDay[] };
type ReportPreview = {
  availablePeople: Array<{ id: string; name: string }>;
  people: ReportPerson[];
  records: number;
  validIntervals: number;
  openIntervals: number;
};
const timeLabel = (minutes: number) => `${Math.floor(minutes / 60).toLocaleString('fa-IR')}:${String(minutes % 60).padStart(2, '0').replace(/[0-9]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)])}`;
const dayLabel = (date: string) => new Date(`${date}T12:00:00.000Z`).toLocaleDateString('fa-IR', { timeZone: 'UTC', weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' });
const clockLabel = (iso: string) => new Date(iso).toLocaleTimeString('fa-IR', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false });
const monthRange = (offset: number) => {
  const { start, end } = PersianCalendar.getMonthRange(offset);
  return { start: PersianCalendar.toPersian(start), end: PersianCalendar.toPersian(end) };
};
const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

export default function PersonnelAttendanceReportPage() {
  const { user, loading: authLoading } = useAuth();
  const permittedRole = user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const [period, setPeriod] = useState<Period>('previous');
  const [range, setRange] = useState({ start: '', end: '' });
  const [restMinutes, setRestMinutes] = useState(120);
  const [includeNoMovement, setIncludeNoMovement] = useState(true);
  const [mergeMatchingNames, setMergeMatchingNames] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setRange(monthRange(-1)), []);
  const changePeriod = (value: Period) => {
    setPeriod(value);
    if (value !== 'custom') { setRange(monthRange(value === 'previous' ? -1 : 0)); setSelectedIds([]); }
  };
  const startGregorian = range.start ? PersianCalendar.toGregorianDateOnly(range.start) : '';
  const endGregorian = range.end ? PersianCalendar.toGregorianDateOnly(range.end) : '';
  const spanDays = startGregorian && endGregorian ? (Date.parse(endGregorian) - Date.parse(startGregorian)) / 86_400_000 : 0;
  const validationError = !range.start || !range.end ? 'بازه گزارش را انتخاب کنید.'
    : range.start > range.end ? 'تاریخ پایان باید پس از تاریخ شروع باشد.'
    : spanDays > 92 ? 'بازه گزارش حداکثر ۹۳ روز است.'
    : !Number.isInteger(restMinutes) || restMinutes < 0 || restMinutes > 240 ? 'زمان استراحت باید بین ۰ تا ۲۴۰ دقیقه باشد.'
    : '';
  const options = useMemo(() => validationError || !permittedRole ? null : ({
    startDate: startGregorian,
    endDate: endGregorian,
    restMinutes, personnelIds: selectedIds,
    includeNoMovement, mergeMatchingNames,
  }), [endGregorian, includeNoMovement, mergeMatchingNames, permittedRole, restMinutes, selectedIds, startGregorian, validationError]);

  useEffect(() => {
    if (!options) { setPreview(null); return; }
    let active = true;
    setLoading(true);
    setError('');
    const timer = window.setTimeout(() => {
      securityAPI.previewPersonnelAttendance(options)
        .then((response) => { if (active) setPreview(response.data.data); })
        .catch((requestError) => { if (active) { setPreview(null); setError(requestError.response?.data?.error || 'پیش‌نمایش گزارش کارکرد ناموفق بود.'); } })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [options]);

  const togglePerson = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const people = (preview?.availablePeople || []).filter((person) => person.name.includes(search.trim()));
  const selectedCount = selectedIds.length || preview?.availablePeople.length || 0;
  const grossTotal = preview?.people.reduce((sum, person) => sum + person.grossMinutes, 0) || 0;
  const netTotal = preview?.people.reduce((sum, person) => sum + person.netMinutes, 0) || 0;
  const detailPerson = preview?.people.find((person) => person.key === detailKey) || null;
  const exportPdf = async () => {
    if (!options || !preview?.people.length || loading) return;
    setExporting(true);
    setError('');
    try {
      const response = await securityAPI.downloadPersonnelAttendancePdf(options);
      downloadBlob(response.data, `personnel-attendance-${options.startDate}-${options.endDate}.pdf`);
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'ساخت PDF گزارش کارکرد ناموفق بود.');
    } finally { setExporting(false); }
  };

  if (!authLoading && !permittedRole) return <ErpWorkspacePage className="guard-workspace" title="گزارش کارکرد پرسنل" backHref="/dashboard/security/reports"><ErpInlineState kind="error" title="این گزارش فقط برای مدیر و ادمین در دسترس است." /></ErpWorkspacePage>;

  return <ErpWorkspacePage className="guard-workspace" title="گزارش کارکرد پرسنل" backHref="/dashboard/security/reports" context="کارکرد روزانه و جمع کارکرد، با کسر زمان استراحت">
    <ErpSection title="بازه گزارش">
      <div className="space-y-4">
        <ErpSegmentedControl value={period} onChange={(value) => changePeriod(value as Period)} options={[{ value: 'previous', label: 'ماه گذشته' }, { value: 'current', label: 'ماه جاری' }, { value: 'custom', label: 'بازه دلخواه' }]} />
        <div className="grid gap-3 sm:grid-cols-2">
          <ErpField label="از تاریخ" required><PersianCalendarComponent value={range.start} onChange={(start) => { setPeriod('custom'); setRange((current) => ({ ...current, start })); setSelectedIds([]); }} placeholder="شروع بازه" /></ErpField>
          <ErpField label="تا تاریخ" required><PersianCalendarComponent value={range.end} onChange={(end) => { setPeriod('custom'); setRange((current) => ({ ...current, end })); setSelectedIds([]); }} placeholder="پایان بازه" /></ErpField>
        </div>
        <p className="text-xs sds-text-muted">گزارش می‌تواند حداکثر ۹۳ روز را پوشش دهد.</p>
      </div>
    </ErpSection>

    <ErpSection title="تنظیمات محاسبه">
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ErpField label="استراحت روزانه (دقیقه)" hint={`از کارکرد هر روز کسر می‌شود · معادل ${timeLabel(restMinutes)} ساعت`} error={!Number.isInteger(restMinutes) || restMinutes < 0 || restMinutes > 240 ? 'عدد باید بین ۰ تا ۲۴۰ باشد.' : undefined}>
          <ErpInput type="number" min={0} max={240} step={1} value={restMinutes} onChange={(event) => setRestMinutes(Number(event.target.value))} />
        </ErpField>
        <div className="space-y-3 pt-1">
          <label className="flex min-h-11 items-center gap-3 text-sm sds-text-primary"><ErpCheckboxControl checked={includeNoMovement} onChange={(event) => setIncludeNoMovement(event.target.checked)} />روزهای بدون تردد ثبت‌شده</label>
          <label className="flex min-h-11 items-center gap-3 text-sm sds-text-primary"><ErpCheckboxControl checked={mergeMatchingNames} onChange={(event) => setMergeMatchingNames(event.target.checked)} />تجمیع شناسه‌های دارای نام یکسان</label>
        </div>
      </div>
    </ErpSection>

    <ErpSection title="پرسنل" actions={selectedIds.length ? [{ label: 'نمایش همه', variant: 'ghost', onClick: () => setSelectedIds([]) }] : []}>
      <div className="space-y-3">
        <ErpField label="جستجوی نام"><ErpInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="نام پرسنل" /></ErpField>
        <p className="text-xs sds-text-muted">{selectedIds.length ? `${selectedCount.toLocaleString('fa-IR')} نفر انتخاب‌شده` : 'همه افراد دارای رکورد در بازه انتخاب شده‌اند.'}</p>
        {loading && !preview ? <ErpSkeleton lines={3} /> : <div className="flex flex-wrap gap-2">{people.map((person) => <ErpPressable key={person.id} type="button" onClick={() => togglePerson(person.id)} aria-pressed={selectedIds.includes(person.id)} className={`min-h-11 rounded-full border px-3 text-sm font-semibold transition ${selectedIds.includes(person.id) ? 'border-[var(--sds-accent)] bg-[var(--sds-accent)] text-[var(--sds-on-accent)]' : 'border-[var(--sds-border-default)] sds-text-secondary'}`}>{person.name}</ErpPressable>)}</div>}
      </div>
    </ErpSection>

    {validationError && <ErpInlineState kind="error" title={validationError} />}
    {error && <ErpInlineState kind="error" title={error} />}
    <ErpSection title="پیش‌نمایش">
      {loading ? <ErpSkeleton lines={5} /> : preview?.people.length ? <div className="space-y-4">
        <ErpSummaryGrid columns={3} items={[{ label: 'نفر', value: preview.people.length.toLocaleString('fa-IR') }, { label: 'جمع کارکرد', value: timeLabel(grossTotal) }, { label: 'جمع بدون استراحت', value: timeLabel(netTotal) }]} />
        <p className="text-xs sds-text-muted">{preview.records.toLocaleString('fa-IR')} روز ثبت‌شده · {preview.validIntervals.toLocaleString('fa-IR')} بازه معتبر{preview.openIntervals ? ` · ${preview.openIntervals.toLocaleString('fa-IR')} بازه در انتظار خروج` : ''}</p>
        <div className="grid gap-3 lg:grid-cols-2">{preview.people.map((person) => <ErpCard key={person.key} className="p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold sds-text-primary">{person.name}</h3><p className="mt-1 text-xs sds-text-muted">{person.daysWithMovement.toLocaleString('fa-IR')} روز دارای تردد</p></div><div className="text-left text-sm"><p className="sds-text-secondary">کارکرد: <strong className="sds-text-primary">{timeLabel(person.grossMinutes)}</strong></p><p className="mt-1 sds-text-secondary">بدون استراحت: <strong className="sds-text-primary">{timeLabel(person.netMinutes)}</strong></p></div></div><div className="mt-3"><ErpButton label="جزئیات روزها" variant="ghost" onClick={() => setDetailKey(person.key)} /></div></ErpCard>)}</div>
      </div> : <ErpEmptyState icon={FaUsers} title="در این بازه رکوردی برای گزارش وجود ندارد" />}
      <div className="mt-4"><ErpButton label={exporting ? 'در حال ساخت PDF…' : `دریافت PDF ${preview?.people.length?.toLocaleString('fa-IR') || ''} نفر`} icon={FaFilePdf} onClick={exportPdf} disabled={exporting || loading || !preview?.people.length} /></div>
    </ErpSection>
    <ErpSheet open={Boolean(detailPerson)} onClose={() => setDetailKey(null)} title={detailPerson ? `روزهای ${detailPerson.name}` : 'روزهای کارکرد'} presentation="modal" size="wide">
      {detailPerson && <div className="space-y-4">
        <ErpSummaryGrid items={[{ label: 'جمع کارکرد', value: timeLabel(detailPerson.grossMinutes) }, { label: 'بدون استراحت', value: timeLabel(detailPerson.netMinutes) }]} />
        <div className="divide-y divide-[var(--sds-border-subtle)]">{detailPerson.days.map((day) => <div key={day.date} className="grid gap-2 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <strong className="sds-text-primary">{dayLabel(day.date)}</strong>
          <span className="sds-text-secondary">{day.intervals.length ? day.intervals.map((interval) => `${clockLabel(interval.enteredAt)} تا ${interval.exitedAt ? clockLabel(interval.exitedAt) : 'در انتظار خروج'}`).join(' · ') : 'بدون تردد ثبت‌شده'}</span>
          <span className="sds-text-secondary">کارکرد {timeLabel(day.grossMinutes)} · بدون استراحت {timeLabel(day.netMinutes)}</span>
        </div>)}</div>
      </div>}
    </ErpSheet>
  </ErpWorkspacePage>;
}
