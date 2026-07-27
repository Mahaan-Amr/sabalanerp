'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { FaClock, FaFilePdf, FaFilter, FaRedo, FaSearch, FaUsers } from 'react-icons/fa';
import PersianCalendarComponent from '@/components/PersianCalendar';
import { ErpButton, ErpEmptyState, ErpInlineState, ErpSection, ErpSegmentedControl, ErpShiftTimeline, ErpSkeleton, ErpStatus, ErpWorkspacePage } from '@/components/erp';
import { ErpCheckboxControl, ErpInput, ErpPressable, ErpSelect } from '@/components/erp';
import { securityAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';

type ReportKind = 'shifts' | 'attendance';
const inputClass = 'min-h-12 w-full rounded-xl border border-[var(--sds-border-subtle)] bg-[var(--sds-surface-panel)] px-3 text-sm outline-none focus:border-[var(--sds-accent)] focus:ring-2 focus:ring-[var(--sds-focus-ring)] dark:border-[var(--sds-border-default)] dark:bg-[var(--sds-surface-panel)] ';
const downloadBlob = (blob: Blob, filename: string) => { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0); };
const dateTime = (value?: string | null) => value ? PersianCalendar.formatForDisplay(value, true) : '—';

function ShiftReportPreview({ shift }: { shift: any }) {
  const coverage = (shift.temporaryCoverage || []).map((item: any) => item.name).filter(Boolean).join('، ');
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold">{shift.effectivePersonnel?.name || 'شیفت گارد'}</h3><p className="mt-1 text-xs sds-text-muted">برنامه: {dateTime(shift.startsAt)} تا {dateTime(shift.endsAt)} · واقعی: {dateTime(shift.startedAt)} تا {dateTime(shift.endedAt)}</p></div><div className="flex flex-wrap gap-2"><ErpStatus label={shift.status === 'FORCE_CLOSED' ? 'بسته‌شده توسط مدیر' : 'تکمیل‌شده'} tone="neutral" />{shift.isManagerCorrected && <ErpStatus label="اصلاح‌شده توسط مدیر" tone="warning" />}</div></div>
    <dl className="grid gap-3 text-sm sm:grid-cols-3"><div><dt className="text-xs sds-text-muted">نیروی برنامه‌ریزی‌شده</dt><dd className="mt-1 font-semibold">{shift.plannedPersonnel?.name || '—'}</dd></div><div><dt className="text-xs sds-text-muted">جایگزین</dt><dd className="mt-1 font-semibold">{shift.replacementPersonnel?.name || '—'}</dd></div><div><dt className="text-xs sds-text-muted">پوشش موقت</dt><dd className="mt-1 font-semibold">{coverage || '—'}</dd></div></dl>
    {(shift.forceCloseReason || shift.closureSummary) && <div className="border-y border-[var(--sds-border-subtle)] py-3 text-sm leading-6 dark:border-[var(--sds-border-subtle)]">{shift.forceCloseReason && <p>دلیل بستن: {shift.forceCloseReason}</p>}{shift.closureSummary && <p>خلاصه پایان: {shift.closureSummary}</p>}</div>}
    {shift.corrections?.length > 0 && <div><h4 className="text-sm font-bold">تاریخچه اصلاح زمان‌های شیفت</h4><div className="mt-2 divide-y divide-[var(--sds-border-subtle)] dark:divide-[var(--sds-border-subtle)]">{shift.corrections.map((item: any) => <div key={item.id} className="py-2 text-sm"><p className="font-semibold">{item.correctedByName} · {dateTime(item.correctedAt)}</p><p className="mt-1 text-xs sds-text-muted">قبلی: {dateTime(item.previousStartedAt)} تا {dateTime(item.previousEndedAt)} · مؤثر: {dateTime(item.effectiveStartedAt)} تا {dateTime(item.effectiveEndedAt)}</p><p className="mt-1">{item.reason}</p></div>)}</div></div>}
    {shift.attendance?.length > 0 && <div><h4 className="text-sm font-bold">حضور شیفت</h4><div className="mt-2 divide-y divide-[var(--sds-border-subtle)] dark:divide-[var(--sds-border-subtle)]">{shift.attendance.map((item: any) => <div key={item.id} className="flex min-h-11 items-center justify-between gap-3 py-2"><span className="font-semibold">{item.name}</span><span className="text-xs sds-text-muted">{dateTime(item.arrivedAt)}{item.delayMinutes ? ` · ${item.delayMinutes.toLocaleString('fa-IR')} دقیقه تأخیر` : ''}{item.correctedAt ? ` · اصلاح‌شده: ${dateTime(item.correctedAt)}` : ''}</span></div>)}</div></div>}
    <ErpShiftTimeline title="خط زمانی" entries={shift.timeline || []} formatTimestamp={dateTime} showAttachmentImages attachmentHref={(attachmentId) => `/api/security/shift-log/attachments/${attachmentId}`} />
  </div>;
}

export default function ReportsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [kind, setKind] = useState<ReportKind>('shifts');
  const [shifts, setShifts] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [range, setRange] = useState({ startDate: '', endDate: '' });
  const [selectedShiftIds, setSelectedShiftIds] = useState<string[]>([]);
  const [selectedPersonnelIds, setSelectedPersonnelIds] = useState<string[]>([]);
  const [attendancePreview, setAttendancePreview] = useState<any>(null);
  const [selectedShiftDetails, setSelectedShiftDetails] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [queryReady, setQueryReady] = useState(false);

  const loadShifts = async () => {
    setLoading(true); setError('');
    try { const response = await securityAPI.getCompletedSecurityShifts({ q: search.trim() || undefined, status: status || undefined, startDate: range.startDate ? PersianCalendar.toGregorianDateOnly(range.startDate) : undefined, endDate: range.endDate ? PersianCalendar.toGregorianDateOnly(range.endDate) : undefined }); setShifts(response.data.data || []); }
    catch (requestError: any) { setError(requestError.response?.data?.error || 'دریافت شیفت‌های پایان‌یافته ناموفق بود.'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('report') === 'attendance') setKind('attendance');
    setSearch(params.get('q') || ''); setStatus(params.get('status') || '');
    const startDate = params.get('start') || ''; const endDate = params.get('end') || '';
    setRange({ startDate, endDate }); setShowAdvanced(Boolean(startDate || endDate));
    setSelectedShiftIds((params.get('shifts') || '').split(',').filter(Boolean));
    setSelectedPersonnelIds((params.get('personnel') || '').split(',').filter(Boolean));
    setQueryReady(true);
  }, []);

  useEffect(() => { if (!queryReady) return; const timer = window.setTimeout(() => { void loadShifts(); }, 250); return () => window.clearTimeout(timer); }, [queryReady, range.endDate, range.startDate, search, status]);
  useEffect(() => {
    if (!queryReady) return;
    const params = new URLSearchParams(); if (kind === 'attendance') params.set('report', kind); if (search.trim()) params.set('q', search.trim()); if (status) params.set('status', status); if (range.startDate) params.set('start', range.startDate); if (range.endDate) params.set('end', range.endDate); if (selectedShiftIds.length) params.set('shifts', selectedShiftIds.join(',')); if (kind === 'attendance' && selectedPersonnelIds.length) params.set('personnel', selectedPersonnelIds.join(','));
    const query = params.toString(); router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [kind, pathname, queryReady, range.endDate, range.startDate, router, search, selectedPersonnelIds, selectedShiftIds, status]);

  useEffect(() => {
    if (kind !== 'attendance' || !selectedShiftIds.length) { setAttendancePreview(null); return; }
    let active = true; setPreviewLoading(true); setPreviewError('');
    securityAPI.previewSecurityShiftAttendance(selectedShiftIds, selectedPersonnelIds).then((response) => { if (active) setAttendancePreview(response.data.data); }).catch((requestError: any) => { if (active) setPreviewError(requestError.response?.data?.error || 'پیش‌نمایش حضور و غیاب ناموفق بود.'); }).finally(() => { if (active) setPreviewLoading(false); });
    return () => { active = false; };
  }, [kind, selectedPersonnelIds, selectedShiftIds]);

  useEffect(() => {
    let active = true;
    if (!selectedShiftIds.length) { setSelectedShiftDetails([]); return undefined; }
    Promise.all(selectedShiftIds.map((id) => securityAPI.getCompletedSecurityShift(id)))
      .then((responses) => { if (active) setSelectedShiftDetails(responses.map((response) => response.data.data)); })
      .catch(() => { if (active) setSelectedShiftDetails([]); });
    return () => { active = false; };
  }, [selectedShiftIds]);

  const selectedShifts = useMemo(() => selectedShiftIds.map((id) => selectedShiftDetails.find((shift) => shift.id === id)).filter(Boolean), [selectedShiftDetails, selectedShiftIds]);
  const toggleShift = (id: string) => setSelectedShiftIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const togglePersonnel = (id: string) => setSelectedPersonnelIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const exportReport = async () => {
    if (!selectedShiftIds.length || selectedShifts.length !== selectedShiftIds.length) return; setExporting(true); setError('');
    try { const response = kind === 'shifts' ? await securityAPI.downloadCompletedSecurityShiftsPdf(selectedShiftIds) : await securityAPI.downloadSecurityShiftAttendancePdf(selectedShiftIds, selectedPersonnelIds); downloadBlob(response.data, kind === 'shifts' ? 'security-shifts.pdf' : 'security-attendance.pdf'); }
    catch (requestError: any) { setError(requestError.response?.data?.error || 'ساخت PDF ناموفق بود.'); }
    finally { setExporting(false); }
  };

  const exportLabel = kind === 'shifts' ? `دریافت PDF ${selectedShiftIds.length.toLocaleString('fa-IR')} شیفت` : `دریافت PDF ${selectedShiftIds.length.toLocaleString('fa-IR')} شیفت برای ${selectedPersonnelIds.length ? selectedPersonnelIds.length.toLocaleString('fa-IR') : 'همه'} نفر`;

  return <ErpWorkspacePage title="گزارش‌ها" secondaryActions={[{ label: 'به‌روزرسانی', icon: FaRedo, onClick: loadShifts }]}>
    <ErpSegmentedControl value={kind} onChange={(value) => { setKind(value); setSelectedPersonnelIds([]); }} options={[{ value: 'shifts', label: 'گزارش شیفت‌ها', icon: FaClock }, { value: 'attendance', label: 'گزارش حضور و غیاب گارد', icon: FaUsers }]} />
    <ErpSection>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]"><label className="relative"><span className="sr-only">جستجوی شیفت</span><FaSearch className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 sds-text-muted" /><ErpInput className={`${inputClass} pr-10`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="شناسه شیفت، نام نگهبان یا تاریخ شمسی" /></label><ErpSelect value={status} onChange={(event) => setStatus(event.target.value)} className={inputClass} aria-label="وضعیت شیفت"><option value="">همه وضعیت‌ها</option><option value="CLOSED">تکمیل‌شده</option><option value="FORCE_CLOSED">بسته‌شده توسط مدیر</option></ErpSelect><ErpButton label="بازه اختیاری" icon={FaFilter} variant={showAdvanced ? 'soft' : 'outline'} onClick={() => setShowAdvanced((value) => !value)} /></div>
      {showAdvanced && <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><PersianCalendarComponent value={range.startDate} onChange={(startDate) => setRange((current) => ({ ...current, startDate }))} placeholder="از تاریخ" clearable /><PersianCalendarComponent value={range.endDate} onChange={(endDate) => setRange((current) => ({ ...current, endDate }))} placeholder="تا تاریخ" clearable />{(range.startDate || range.endDate) && <ErpButton label="پاک‌کردن بازه" variant="ghost" onClick={() => setRange({ startDate: '', endDate: '' })} />}</div>}
      {selectedShiftIds.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2"><span className="text-xs font-semibold sds-text-muted">دامنه:</span>{selectedShiftIds.map((id) => { const shift = shifts.find((item) => item.id === id); return <ErpPressable key={id} type="button" onClick={() => toggleShift(id)} className="min-h-9 rounded-full bg-[var(--sds-surface-subtle)] px-3 text-xs font-semibold sds-text-secondary dark:bg-[var(--sds-surface-subtle)] ">{shift?.effectivePersonnel?.name || id.slice(0, 8)} ×</ErpPressable>; })}<ErpPressable type="button" onClick={() => setSelectedShiftIds([])} className="min-h-9 px-2 text-xs font-bold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">پاک‌کردن</ErpPressable></div>}
    </ErpSection>

    {loading && !shifts.length ? <ErpSkeleton lines={7} /> : error && !shifts.length ? <ErpInlineState kind="error" title={error} action={{ label: 'تلاش مجدد', onClick: loadShifts }} /> : <>
      {error && <ErpInlineState kind="stale" title="آخرین جستجو ناموفق بود؛ نتایج قبلی نمایش داده می‌شود." action={{ label: 'تلاش مجدد', onClick: loadShifts }} />}
      <ErpSection title="شیفت‌های پایان‌یافته"><p className="mb-3 text-xs font-semibold sds-text-muted">{shifts.length.toLocaleString('fa-IR')} نتیجه · جدیدترین ابتدا</p>{!shifts.length ? <ErpEmptyState icon={FaClock} title="شیفت پایان‌یافته‌ای پیدا نشد" action={{ label: 'پاک‌کردن جستجو', onClick: () => { setSearch(''); setStatus(''); } }} /> : <div className="divide-y divide-[var(--sds-border-subtle)] dark:divide-[var(--sds-border-subtle)]">{shifts.map((shift) => <article key={shift.id} className="flex items-start gap-3 py-4 first:pt-0 last:pb-0"><ErpCheckboxControl checked={selectedShiftIds.includes(shift.id)} onChange={() => toggleShift(shift.id)} className="mt-3 h-5 w-5 accent-[var(--sds-accent)]" aria-label={`انتخاب شیفت ${shift.effectivePersonnel?.name || ''}`} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-bold sds-text-primary ">{shift.effectivePersonnel?.name || 'شیفت گارد'}</h2><ErpStatus label={shift.status === 'FORCE_CLOSED' ? 'بسته‌شده توسط مدیر' : 'تکمیل‌شده'} tone="neutral" />{shift.isManagerCorrected && <ErpStatus label="اصلاح‌شده توسط مدیر" tone="warning" />}</div><p className="mt-1 text-sm sds-text-muted">{dateTime(shift.startsAt)} تا {dateTime(shift.endsAt)}</p><p className="mt-1 text-xs sds-text-muted">پایان واقعی: {dateTime(shift.endedAt)} · {(shift.timeline?.length || 0).toLocaleString('fa-IR')} رویداد</p></div><Link href={`/dashboard/security/reports/shifts/${shift.id}`} className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-bold text-[var(--sds-accent)] outline-none hover:bg-[var(--sds-surface-subtle)] focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)] dark:text-[var(--sds-accent)] dark:hover:bg-[var(--sds-surface-subtle)]">جزئیات</Link></article>)}</div>}</ErpSection>
    </>}

    {kind === 'attendance' && selectedShiftIds.length > 0 && <ErpSection title="انتخاب کارکنان"><p className="mb-3 text-xs sds-text-muted">انتخاب نکردن فرد به معنی همه کارکنان این شیفت‌هاست.</p>{previewLoading && !attendancePreview ? <ErpSkeleton lines={3} /> : attendancePreview && <div className="flex flex-wrap gap-2">{attendancePreview.personnel.map((person: any) => <ErpPressable key={person.id} type="button" onClick={() => togglePersonnel(person.id)} className={`min-h-11 rounded-full border px-3 text-sm font-semibold transition ${selectedPersonnelIds.includes(person.id) ? 'border-[var(--sds-accent)] bg-[var(--sds-accent)] text-[var(--sds-on-accent)]' : 'border-[var(--sds-border-subtle)] sds-text-secondary dark:border-[var(--sds-border-default)] '}`}>{person.name}</ErpPressable>)}</div>}</ErpSection>}

    {selectedShiftIds.length > 0 && <ErpSection title="پیش‌نمایش دقیق" actions={[{ label: exporting ? 'در حال ساخت…' : exportLabel, icon: FaFilePdf, onClick: exportReport, disabled: exporting || Boolean(previewError) || selectedShifts.length !== selectedShiftIds.length, variant: 'solid' }]}>
      {kind === 'shifts' ? <div className="space-y-8">{selectedShifts.map((shift) => <ShiftReportPreview key={shift.id} shift={shift} />)}</div> : previewLoading ? <ErpSkeleton lines={5} /> : previewError ? <ErpInlineState kind="error" title={previewError} /> : attendancePreview?.rows?.length ? <div className="space-y-2">{attendancePreview.rows.map((row: any) => <div key={`${row.shiftId}-${row.personnelId}`} className="grid gap-2 border-b border-[var(--sds-border-subtle)] py-3 last:border-0 dark:border-[var(--sds-border-subtle)] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"><div><p className="font-bold">{row.personnelName}</p><p className="mt-1 text-xs sds-text-muted">{row.shiftTitle}</p></div><p className="text-sm sds-text-secondary ">حضور: {dateTime(row.arrivedAt)}{row.delayMinutes ? ` · ${row.delayMinutes.toLocaleString('fa-IR')} دقیقه تأخیر` : ''}</p><ErpStatus label={row.state === 'PRESENT' ? 'حاضر' : row.state === 'LATE' ? 'با تأخیر' : 'غایب'} tone={row.state === 'PRESENT' ? 'success' : row.state === 'LATE' ? 'warning' : 'danger'} /></div>)}</div> : <ErpEmptyState icon={FaUsers} title="داده‌ای در دامنه انتخاب‌شده وجود ندارد" />}
    </ErpSection>}
  </ErpWorkspacePage>;
}
