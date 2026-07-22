'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  FaCalendarAlt,
  FaCheckCircle,
  FaClock,
  FaRedo,
  FaExclamationTriangle,
  FaFilter,
  FaSearch,
  FaSignInAlt,
  FaSignOutAlt,
  FaUserCheck,
  FaUserTimes,
  FaUsers,
} from 'react-icons/fa';
import { ErpButton, ErpEmptyState, ErpInlineState, ErpSection, ErpSheet, ErpSkeleton, ErpStatus, ErpWorkspacePage } from '@/components/erp';
import { notifySecurity } from '@/components/SecurityNoticeHost';
import PersianCalendarComponent from '@/components/PersianCalendar';
import PersianCalendar from '@/lib/persian-calendar';
import PersianTimePicker, { formatTime12 } from '@/components/PersianTimePicker';
import { departmentsAPI, securityAPI } from '@/lib/api';
import {
  matchesAttendanceFilter,
  parseAttendanceDashboardQuery,
  type DashboardAttendanceCondition,
} from '../securityDashboardViewModel';

interface AttendanceRecord {
  id: string;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    username?: string;
    department?: {
      name: string;
      namePersian: string;
    };
  };
  attendance?: {
    id: string;
    entryTime: string | null;
    exitTime: string | null;
    status: string;
    exceptionType: string | null;
    notes: string | null;
    digitalSignature: string | null;
  } | null;
  entryTime: string | null;
  exitTime: string | null;
  status: string;
  exceptionType: string | null;
  notes: string | null;
  digitalSignature: string | null;
  createdAt: string;
  workScheduleStatus?: string | null;
  scheduledStartTime?: string | null;
  scheduledEndTime?: string | null;
  delayMinutes?: number | null;
  overtimeMinutes?: number | null;
  overtimePending?: boolean;
  intervals?: Array<{ id: string; enteredAt: string; exitedAt?: string | null; entryRecorder?: { firstName: string; lastName: string }; exitRecorder?: { firstName: string; lastName: string } | null }>;
  movementTimeline?: Array<{ kind: 'PRESENCE' | 'OUTSIDE' | 'HOURLY_LEAVE'; startsAt: string; endsAt?: string | null }>;
  physicalPresenceMinutes?: number;
  outsideMinutes?: number;
  presencePending?: boolean;
  accountedWorkMinutes?: number | null;
  approvedExceptions?: any[];
  approvedLeaves?: any[];
  approvedMissions?: any[];
  shift?: {
    id: string;
    namePersian: string;
  } | null;
  openPreviousAttendance?: {
    id: string;
    date: string;
    entryTime: string | null;
    shift?: {
      id: string;
      namePersian: string;
    } | null;
    notes?: string | null;
  } | null;
}

interface AttendanceStats {
  totalEmployees: number;
  present: number;
  absent: number;
  late: number;
  mission: number;
  leave: number;
  signed?: number;
}

interface Department {
  id: string;
  namePersian: string;
}

interface Shift {
  id: string;
  namePersian: string;
}

const inputClass = 'min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#074747] focus:bg-white focus:ring-2 focus:ring-[#074747]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-500 dark:focus:bg-slate-900';
const labelClass = 'mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200';

const getStatusTone = (status: string) => {
  switch (status) {
    case 'PRESENT':
      return 'success' as const;
    case 'ABSENT':
      return 'danger' as const;
    case 'LATE':
      return 'warning' as const;
    case 'PENDING':
      return 'info' as const;
    case 'NON_WORKING_DAY':
      return 'neutral' as const;
    case 'MISSION':
      return 'info' as const;
    case 'HOURLY_LEAVE':
    case 'SICK_LEAVE':
    case 'VACATION':
      return 'purple' as const;
    default:
      return 'neutral' as const;
  }
};

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'PRESENT':
      return 'حاضر';
    case 'ABSENT':
      return 'غایب';
    case 'LATE':
      return 'حاضر با تأخیر';
    case 'PENDING':
      return 'در انتظار شروع';
    case 'NON_WORKING_DAY':
      return 'روز غیرکاری';
    case 'MISSION':
      return 'مأموریت';
    case 'HOURLY_LEAVE':
      return 'مرخصی ساعتی';
    case 'SICK_LEAVE':
      return 'مرخصی استعلاجی';
    case 'VACATION':
      return 'مرخصی روزانه';
    default:
      return 'نامشخص';
  }
};

const canCheckIn = (record: AttendanceRecord) => !record.presencePending;
const canCheckOut = (record: AttendanceRecord) => Boolean(record.presencePending);
const isExceptionStatus = (status: string) => ['MISSION', 'HOURLY_LEAVE', 'SICK_LEAVE', 'VACATION'].includes(status);
const currentTimeValue = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
const selectedDateIso = (date: string) => PersianCalendar.toGregorianDateOnly(date);

type AttendanceAction = 'checkin' | 'checkout' | 'close-previous';

interface AttendanceDialogState {
  action: AttendanceAction;
  record: AttendanceRecord;
  time: string;
  defaultTime: string;
  reason: string;
}

interface IntervalDialogState {
  action: 'correct' | 'void';
  interval: NonNullable<AttendanceRecord['intervals']>[number];
  record: AttendanceRecord;
  enteredAt: string;
  exitedAt: string;
  reason: string;
}

const localDateTimeValue = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return `${PersianCalendar.toPersian(date)} ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
};

const persianDateTimeIso = (value: string) => PersianCalendar.toGregorian(value, 'jYYYY/jMM/jDD HH:mm').toISOString();

export default function AttendancePage() {
  const router = useRouter();
  const pathname = usePathname();
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [stats, setStats] = useState<AttendanceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(PersianCalendar.now());
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [conditionFilter, setConditionFilter] = useState<DashboardAttendanceCondition | null>(null);
  const [queryInitialized, setQueryInitialized] = useState(false);
  const [departmentId, setDepartmentId] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [attendanceDialog, setAttendanceDialog] = useState<AttendanceDialogState | null>(null);
  const [intervalDialog, setIntervalDialog] = useState<IntervalDialogState | null>(null);
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null);

  const fetchAttendanceData = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      setError(null);

      const attendanceResponse = await securityAPI.getDailyAttendance({
        date: selectedDateIso(selectedDate),
        departmentId: departmentId || undefined,
      });

      if (attendanceResponse.data.success) {
        setAttendanceRecords(attendanceResponse.data.data.attendanceSummary || []);
        setStats(attendanceResponse.data.data.stats);
      }
    } catch (requestError: any) {
      console.error('Error fetching attendance data:', requestError);
      setError(requestError.response?.data?.error || 'خطا در دریافت اطلاعات');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const query = parseAttendanceDashboardQuery(params);
    if (query.date) setSelectedDate(query.date);
    setStatusFilter(query.status);
    setConditionFilter(query.condition);
    setSearchTerm(params.get('q') || '');
    setDepartmentId(params.get('department') || '');
    setQueryInitialized(true);
  }, []);

  useEffect(() => {
    if (!queryInitialized) return;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams();
      if (selectedDate !== PersianCalendar.now()) params.set('date', selectedDate);
      if (searchTerm.trim()) params.set('q', searchTerm.trim());
      if (departmentId) params.set('department', departmentId);
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      if (conditionFilter) params.set('condition', conditionFilter);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [conditionFilter, departmentId, pathname, queryInitialized, router, searchTerm, selectedDate, statusFilter]);

  useEffect(() => {
    if (queryInitialized) fetchAttendanceData();
  }, [selectedDate, departmentId, queryInitialized]);

  useEffect(() => {
    if (!queryInitialized || selectedDate !== PersianCalendar.now()) return undefined;
    const timer = window.setInterval(() => { void fetchAttendanceData(true); }, 30_000);
    return () => window.clearInterval(timer);
  }, [departmentId, queryInitialized, selectedDate]);

  useEffect(() => {
    const loadFilters = async () => {
      try {
        const [departmentsResponse] = await Promise.all([
          departmentsAPI.getDepartments(),
        ]);
        if (departmentsResponse.data.success) setDepartments(departmentsResponse.data.data || []);
      } catch (requestError) {
        console.error('Error loading attendance filters:', requestError);
      }
    };
    loadFilters();
  }, []);

  const filteredRecords = useMemo(() => attendanceRecords.filter((record) => {
    const search = searchTerm.trim().toLowerCase();
    const matchesSearch = !search ||
      record.employee.firstName.toLowerCase().includes(search) ||
      record.employee.lastName.toLowerCase().includes(search) ||
      (record.employee.username || '').toLowerCase().includes(search);
    const matchesStatus = matchesAttendanceFilter(record, statusFilter, conditionFilter);
    return matchesSearch && matchesStatus;
  }), [attendanceRecords, searchTerm, statusFilter, conditionFilter]);

  const openAttendanceDialog = (record: AttendanceRecord, action: AttendanceAction) => {
    const defaultTime = currentTimeValue();
    setAttendanceDialog({ action, record, time: defaultTime, defaultTime, reason: '' });
  };

  const submitAttendanceDialog = async () => {
    if (!attendanceDialog) return;
    const { action, record, time, defaultTime, reason } = attendanceDialog;
    const requiresReason = action === 'close-previous';
    if (requiresReason && !reason.trim()) {
      notifySecurity('برای ثبت خروج روز قبل، دلیل کوتاه الزامی است.', 'error');
      return;
    }
    setActionLoadingId(`${action}-${record.employee.id}`);
    try {
      const response = action === 'checkin'
        ? await securityAPI.checkIn(record.employee.id, { date: selectedDateIso(selectedDate), entryTime: time, reason: requiresReason ? reason.trim() : undefined })
        : await securityAPI.checkOut(record.employee.id, {
            date: action === 'close-previous' && record.openPreviousAttendance ? String(record.openPreviousAttendance.date).slice(0, 10) : selectedDateIso(selectedDate),
            attendanceId: action === 'close-previous' ? record.openPreviousAttendance?.id : undefined,
            exitTime: time,
            reason: reason.trim() || undefined,
          });
      if (response.data.success) {
        notifySecurity(response.data.message || (action === 'checkin' ? 'ورود ثبت شد' : 'خروج ثبت شد'));
        setAttendanceDialog(null);
        await fetchAttendanceData();
      }
    } catch (requestError: any) {
      notifySecurity(requestError.response?.data?.error || 'ثبت عملیات ناموفق بود', 'error');
    } finally {
      setActionLoadingId('');
    }
  };

  const openIntervalDialog = (record: AttendanceRecord, interval: NonNullable<AttendanceRecord['intervals']>[number], action: IntervalDialogState['action']) => {
    setIntervalDialog({ action, record, interval, enteredAt: localDateTimeValue(interval.enteredAt), exitedAt: localDateTimeValue(interval.exitedAt), reason: '' });
  };

  const submitIntervalDialog = async () => {
    if (!intervalDialog || !intervalDialog.reason.trim()) return;
    if (intervalDialog.action === 'correct' && (!intervalDialog.enteredAt || (intervalDialog.exitedAt && intervalDialog.exitedAt <= intervalDialog.enteredAt))) {
      notifySecurity('زمان‌های ورود و خروج را بررسی کنید.', 'error');
      return;
    }
    setActionLoadingId(`interval-${intervalDialog.interval.id}`);
    try {
      const response = intervalDialog.action === 'void'
        ? await securityAPI.voidAttendanceInterval(intervalDialog.interval.id, intervalDialog.reason.trim())
        : await securityAPI.correctAttendanceInterval(intervalDialog.interval.id, {
            enteredAt: persianDateTimeIso(intervalDialog.enteredAt),
            exitedAt: intervalDialog.exitedAt ? persianDateTimeIso(intervalDialog.exitedAt) : null,
            reason: intervalDialog.reason.trim()
          });
      notifySecurity(response.data.message || 'تردد به‌روزرسانی شد.');
      setIntervalDialog(null);
      await fetchAttendanceData();
    } catch (requestError: any) {
      notifySecurity(requestError.response?.data?.error || 'به‌روزرسانی تردد ناموفق بود.', 'error');
    } finally {
      setActionLoadingId('');
    }
  };

  const rosterScopeEmpty = (stats?.totalEmployees || 0) === 0 && attendanceRecords.length === 0 && !searchTerm.trim() && statusFilter === 'ALL' && !conditionFilter;

  const filterControls = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label><span className={labelClass}>تاریخ</span><PersianCalendarComponent value={selectedDate} onChange={setSelectedDate} placeholder="انتخاب تاریخ" clearable={false} /></label>
      <label><span className={labelClass}>بخش</span><select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className={inputClass}><option value="">همه بخش‌ها</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.namePersian}</option>)}</select></label>
      <label className="sm:col-span-2"><span className={labelClass}>وضعیت</span><select value={conditionFilter ? `CONDITION_${conditionFilter}` : statusFilter} onChange={(event) => { if (event.target.value === 'CONDITION_MISSION' || event.target.value === 'CONDITION_LEAVE') { setStatusFilter('ALL'); setConditionFilter(event.target.value === 'CONDITION_MISSION' ? 'MISSION' : 'LEAVE'); return; } setConditionFilter(null); setStatusFilter(event.target.value); }} className={inputClass}>
        <option value="ALL">همه وضعیت‌ها</option><option value="PRESENT">حاضر</option><option value="ABSENT">غایب</option><option value="LATE">تأخیر</option><option value="PENDING">در انتظار شروع</option><option value="NON_WORKING_DAY">روز غیرکاری</option><option value="MISSION">مأموریت</option><option value="HOURLY_LEAVE">مرخصی ساعتی</option><option value="CONDITION_MISSION">دارای مأموریت تأییدشده</option><option value="CONDITION_LEAVE">دارای مرخصی تأییدشده</option>
      </select></label>
    </div>
  );

  const activeFilterCount = Number(Boolean(departmentId)) + Number(statusFilter !== 'ALL') + Number(Boolean(conditionFilter));

  return (
    <ErpWorkspacePage title="حضور و غیاب" context={PersianCalendar.formatForDisplay(selectedDate)} secondaryActions={[{ label: 'به‌روزرسانی', icon: FaRedo, onClick: fetchAttendanceData, tone: 'neutral' }]}>
      {loading && attendanceRecords.length === 0 ? <ErpSkeleton lines={6} /> : error && attendanceRecords.length === 0 ? <ErpInlineState kind="error" title={error} action={{ label: 'تلاش مجدد', onClick: fetchAttendanceData }} /> : <>
      {error && attendanceRecords.length > 0 && <ErpInlineState kind="stale" title="آخرین به‌روزرسانی ناموفق بود؛ اطلاعات قبلی نمایش داده می‌شود." action={{ label: 'تلاش مجدد', onClick: fetchAttendanceData }} />}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/70">
        <div className="grid grid-cols-2 divide-x divide-x-reverse divide-y divide-slate-100 dark:divide-slate-800 sm:grid-cols-3 lg:grid-cols-6 lg:divide-y-0">
          {[
            ['کل کارکنان', stats?.totalEmployees || 0, 'neutral'], ['حاضر', stats?.present || 0, 'success'], ['غایب', stats?.absent || 0, 'danger'], ['تأخیر', stats?.late || 0, 'warning'], ['مأموریت', stats?.mission || 0, 'info'], ['مرخصی', stats?.leave || 0, 'purple'],
          ].map(([label, value, tone]) => <div key={String(label)} className="p-3 sm:p-4"><p className="text-xs font-semibold text-slate-500">{label}</p><div className="mt-2 flex items-center justify-between gap-2"><strong className="text-xl text-slate-950 dark:text-white">{Number(value).toLocaleString('fa-IR')}</strong><ErpStatus label={String(label)} tone={tone as any} /></div></div>)}
        </div>
      </div>

      <ErpSection>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <label>
            <span className={labelClass}>جستجو</span>
            <div className="relative">
              <FaSearch className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="نام، نام خانوادگی یا نام کاربری"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className={`${inputClass} pr-10`}
              />
            </div>
          </label>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <ErpButton label={activeFilterCount ? `فیلترها (${activeFilterCount.toLocaleString('fa-IR')})` : 'فیلترها'} icon={FaFilter} onClick={() => setFiltersOpen(true)} tone="neutral" className="lg:hidden" />
          </div>
        </div>
        <div className="mt-4 hidden lg:block">{filterControls}</div>
        {activeFilterCount > 0 && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">{departmentId && <button type="button" onClick={() => setDepartmentId('')} className="min-h-9 rounded-full bg-slate-100 px-3 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">بخش ×</button>}{(statusFilter !== 'ALL' || conditionFilter) && <button type="button" onClick={() => { setStatusFilter('ALL'); setConditionFilter(null); }} className="min-h-9 rounded-full bg-slate-100 px-3 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">وضعیت ×</button>}<button type="button" onClick={() => { setDepartmentId(''); setStatusFilter('ALL'); setConditionFilter(null); }} className="min-h-9 px-2 font-bold text-[#074747] dark:text-teal-200">پاک‌کردن همه</button></div>}
      </ErpSection>

      <ErpSection title="کارکنان" actions={[]}>
        <p className="mb-3 text-xs font-semibold text-slate-500">{filteredRecords.length.toLocaleString('fa-IR')} نتیجه</p>
        {filteredRecords.length === 0 && rosterScopeEmpty ? (
          <ErpEmptyState
            icon={FaUsers}
            title="فهرست حضور و غیاب حراست هنوز تنظیم نشده است"
            description="مدیر حراست باید افراد قابل محاسبه در حضور و غیاب را از تنظیمات حراست انتخاب کند."
          />
        ) : filteredRecords.length === 0 ? (
          <ErpEmptyState icon={FaUsers} title="رکوردی برای نمایش وجود ندارد" description="فیلترها را تغییر دهید یا تاریخ دیگری انتخاب کنید." />
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 lg:hidden">
              {filteredRecords.map((record) => {
                const checkingIn = actionLoadingId === `checkin-${record.employee.id}`;
                const checkingOut = actionLoadingId === `checkout-${record.employee.id}`;
                const expanded = expandedRecordId === record.id;
                return (
                  <div key={record.id} className="border-b border-slate-100 bg-white p-3 last:border-b-0 dark:border-slate-800 dark:bg-slate-900/70">
                    <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] items-center gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                          {record.employee.firstName} {record.employee.lastName}
                        </p>
                      </div>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">{record.employee.department?.namePersian || 'بدون بخش'}</p>
                      <ErpStatus tone={getStatusTone(record.status)} label={getStatusLabel(record.status)} />
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {record.openPreviousAttendance ? <ErpButton label="ثبت خروج قبلی" icon={FaSignOutAlt} onClick={() => openAttendanceDialog(record, 'close-previous')} tone="warning" variant="solid" disabled={Boolean(actionLoadingId)} /> : canCheckOut(record) ? <ErpButton label="خروج" icon={FaSignOutAlt} onClick={() => openAttendanceDialog(record, 'checkout')} disabled={Boolean(actionLoadingId)} tone="neutral" variant="soft" /> : canCheckIn(record) ? <ErpButton label="ورود" icon={FaSignInAlt} onClick={() => openAttendanceDialog(record, 'checkin')} disabled={Boolean(actionLoadingId)} variant="soft" /> : null}
                      <ErpButton label={expanded ? 'بستن جزئیات' : 'جزئیات'} onClick={() => setExpandedRecordId(expanded ? null : record.id)} tone="neutral" variant="ghost" />
                    </div>
                    {expanded && (
                      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/70">
                        <div><dt className="text-xs text-slate-500">ورود</dt><dd className="mt-1 font-semibold">{record.entryTime || '-'}</dd></div>
                        <div><dt className="text-xs text-slate-500">خروج</dt><dd className="mt-1 font-semibold">{record.exitTime || '-'}</dd></div>
                        <div><dt className="text-xs text-slate-500">حضور فیزیکی</dt><dd className="mt-1 font-semibold">{record.presencePending ? 'در حال حضور' : `${(record.physicalPresenceMinutes || 0).toLocaleString('fa-IR')} دقیقه`}</dd></div>
                        <div><dt className="text-xs text-slate-500">خارج از محل</dt><dd className="mt-1 font-semibold">{(record.outsideMinutes || 0).toLocaleString('fa-IR')} دقیقه</dd></div>
                        <div><dt className="text-xs text-slate-500">کارکرد محاسبه‌شده</dt><dd className="mt-1 font-semibold">{record.accountedWorkMinutes === null || record.accountedWorkMinutes === undefined ? 'در انتظار تکمیل' : `${record.accountedWorkMinutes.toLocaleString('fa-IR')} دقیقه`}</dd></div>
                        {record.movementTimeline?.length ? <div className="col-span-2"><dt className="text-xs text-slate-500">خط زمانی روز</dt><dd className="mt-2 space-y-1">{record.movementTimeline.map((segment, index) => <p key={`${segment.kind}-${segment.startsAt}-${index}`} className="rounded bg-white px-2 py-1 text-xs dark:bg-slate-900"><strong>{segment.kind === 'PRESENCE' ? 'حضور در محل' : segment.kind === 'HOURLY_LEAVE' ? 'مرخصی ساعتی' : 'خارج از محل'}:</strong> {new Date(segment.startsAt).toLocaleString('fa-IR')} تا {segment.endsAt ? new Date(segment.endsAt).toLocaleString('fa-IR') : 'باز'}</p>)}</dd></div> : null}
                        {record.intervals?.length ? <div className="col-span-2"><dt className="text-xs text-slate-500">جزئیات تردد</dt><dd className="mt-2 space-y-1">{record.intervals.map((interval, index) => <div key={interval.id} className="rounded bg-white px-2 py-2 text-xs dark:bg-slate-900"><p>{(index + 1).toLocaleString('fa-IR')}. {new Date(interval.enteredAt).toLocaleString('fa-IR')} تا {interval.exitedAt ? new Date(interval.exitedAt).toLocaleString('fa-IR') : 'باز'} · ثبت‌کننده ورود: {interval.entryRecorder ? `${interval.entryRecorder.firstName} ${interval.entryRecorder.lastName}` : '-'}</p><div className="mt-2 flex gap-2"><button type="button" className="font-semibold text-teal-700" onClick={() => openIntervalDialog(record, interval, 'correct')}>اصلاح</button><button type="button" className="font-semibold text-rose-700" onClick={() => openIntervalDialog(record, interval, 'void')}>ابطال</button></div></div>)}</dd></div> : null}
                        <div><dt className="text-xs text-slate-500">ساعت کاری</dt><dd className="mt-1 font-semibold" dir="ltr">{record.scheduledStartTime && record.scheduledEndTime ? `${formatTime12(record.scheduledStartTime)} – ${formatTime12(record.scheduledEndTime)}` : record.workScheduleStatus === 'NON_WORKING_DAY' ? 'روز غیرکاری' : 'تعریف نشده'}</dd></div>
                        <div><dt className="text-xs text-slate-500">تأخیر</dt><dd className="mt-1 font-semibold">{record.delayMinutes === null || record.delayMinutes === undefined ? '-' : `${record.delayMinutes.toLocaleString('fa-IR')} دقیقه`}</dd></div>
                        <div><dt className="text-xs text-slate-500">اضافه‌کار</dt><dd className="mt-1 font-semibold">{record.overtimePending ? 'در انتظار ثبت خروج' : record.overtimeMinutes === null || record.overtimeMinutes === undefined ? '-' : `${record.overtimeMinutes.toLocaleString('fa-IR')} دقیقه`}</dd></div>
                        <div><dt className="text-xs text-slate-500">یادداشت</dt><dd className="mt-1 font-semibold">{record.notes || record.exceptionType || 'بدون یادداشت'}</dd></div>
                        {record.openPreviousAttendance && <div className="col-span-2 text-xs font-semibold text-amber-700 dark:text-amber-300">خروج روز قبل ثبت نشده است: {PersianCalendar.formatForDisplay(record.openPreviousAttendance.date)}، ورود {record.openPreviousAttendance.entryTime || '-'}</div>}
                      </dl>
                    )}
                    {(checkingIn || checkingOut) && <p className="mt-2 text-xs font-semibold text-[#074747] dark:text-teal-200">در حال ثبت...</p>}
                    {isExceptionStatus(record.status) && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">استثنای تأییدشده با تردد واقعی هم‌زمان نمایش داده می‌شود.</p>}
                    {record.entryTime && !record.presencePending && <p className="mt-2 inline-flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300"><FaCheckCircle /> آخرین بازه تکمیل شده</p>}
                  </div>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">کارمند</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">بخش</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">وضعیت</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">ورود</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">خروج</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">ساعت کاری</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">تأخیر</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">اضافه‌کار</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">حضور / خارج</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">یادداشت</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map((record) => (
                    <tr key={record.id} className="border-b border-slate-100 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60">
                      <td className="px-3 py-4">
                        <div className="font-semibold text-slate-900 dark:text-white">{record.employee.firstName} {record.employee.lastName}</div>
                        {record.employee.username && <div className="text-xs text-slate-500 dark:text-slate-400">@{record.employee.username}</div>}
                      </td>
                      <td className="px-3 py-4 text-slate-600 dark:text-slate-300">{record.employee.department?.namePersian || '-'}</td>
                      <td className="px-3 py-4"><ErpStatus tone={getStatusTone(record.status)} label={getStatusLabel(record.status)} /></td>
                      <td className="px-3 py-4 text-slate-900 dark:text-white">{record.entryTime || '-'}</td>
                      <td className="px-3 py-4 text-slate-900 dark:text-white">{record.exitTime || '-'}</td>
                      <td className="px-3 py-4 text-slate-600 dark:text-slate-300" dir="ltr">{record.scheduledStartTime && record.scheduledEndTime ? `${formatTime12(record.scheduledStartTime)} – ${formatTime12(record.scheduledEndTime)}` : record.workScheduleStatus === 'NON_WORKING_DAY' ? 'روز غیرکاری' : 'تعریف نشده'}</td>
                      <td className="px-3 py-4 text-amber-700">{record.delayMinutes === null || record.delayMinutes === undefined ? '-' : `${record.delayMinutes.toLocaleString('fa-IR')} دقیقه`}</td>
                      <td className="px-3 py-4 text-teal-700">{record.overtimePending ? 'در انتظار خروج' : record.overtimeMinutes === null || record.overtimeMinutes === undefined ? '-' : `${record.overtimeMinutes.toLocaleString('fa-IR')} دقیقه`}</td>
                      <td className="px-3 py-4 text-slate-600 dark:text-slate-300">{record.presencePending ? 'در حال حضور' : `${(record.physicalPresenceMinutes || 0).toLocaleString('fa-IR')} / ${(record.outsideMinutes || 0).toLocaleString('fa-IR')} دقیقه`}</td>
                      <td className="px-3 py-4 text-slate-600 dark:text-slate-300">
                        {record.openPreviousAttendance ? (
                          <span className="font-semibold text-amber-700">خروج روز قبل ثبت نشده</span>
                        ) : record.notes || record.exceptionType || (record.digitalSignature ? 'امضا ثبت شده' : '-')}
                      </td>
                      <td className="px-3 py-4">
                        <div className="flex flex-wrap gap-2">
                          <ErpButton label="ورود" icon={FaSignInAlt} onClick={() => openAttendanceDialog(record, 'checkin')} disabled={!canCheckIn(record) || Boolean(actionLoadingId) || Boolean(record.openPreviousAttendance)} variant="soft" />
                          <ErpButton label="خروج" icon={FaSignOutAlt} onClick={() => openAttendanceDialog(record, 'checkout')} disabled={!canCheckOut(record) || Boolean(actionLoadingId)} tone="neutral" variant="soft" />
                          {record.openPreviousAttendance && <ErpButton label="خروج قبلی" icon={FaSignOutAlt} onClick={() => openAttendanceDialog(record, 'close-previous')} disabled={Boolean(actionLoadingId)} tone="warning" variant="soft" />}
                          {record.intervals?.map((interval, index) => (
                            <div key={interval.id} className="flex gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs dark:border-slate-700">
                              <span className="text-slate-500">تردد {(index + 1).toLocaleString('fa-IR')}</span>
                              <button type="button" className="font-semibold text-teal-700" onClick={() => openIntervalDialog(record, interval, 'correct')}>اصلاح</button>
                              <button type="button" className="font-semibold text-rose-700" onClick={() => openIntervalDialog(record, interval, 'void')}>ابطال</button>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </ErpSection>
      </>}
      <ErpSheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="فیلترهای حضور و غیاب" footer={<div className="flex justify-end"><ErpButton label="مشاهده نتایج" onClick={() => setFiltersOpen(false)} variant="solid" /></div>}>
        {filterControls}
      </ErpSheet>
      {attendanceDialog && (
        <ErpSheet open onClose={() => setAttendanceDialog(null)} title={attendanceDialog.action === 'checkin' ? 'ثبت ورود' : attendanceDialog.action === 'checkout' ? 'ثبت خروج' : 'ثبت خروج قبلی'} footer={<div className="flex flex-wrap justify-end gap-2"><ErpButton label="انصراف" onClick={() => setAttendanceDialog(null)} tone="neutral" variant="ghost" /><ErpButton label="ثبت" onClick={submitAttendanceDialog} variant="solid" disabled={Boolean(actionLoadingId) || (attendanceDialog.action === 'close-previous' && !attendanceDialog.reason.trim())} /></div>}>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {attendanceDialog.record.employee.firstName} {attendanceDialog.record.employee.lastName}
            </p>
            {attendanceDialog.action === 'close-previous' && attendanceDialog.record.openPreviousAttendance && (
              <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-100">
                این خروج برای {PersianCalendar.formatForDisplay(attendanceDialog.record.openPreviousAttendance.date)} ثبت می‌شود.
              </p>
            )}
            <label className="mt-4 block">
              <span className={labelClass}>زمان</span>
              <PersianTimePicker value={attendanceDialog.time} onChange={(time) => setAttendanceDialog((current) => current ? { ...current, time } : current)} />
            </label>
            {(attendanceDialog.action === 'close-previous' || attendanceDialog.time !== attendanceDialog.defaultTime) && <label className="mt-4 block">
              <span className={labelClass}>دلیل {attendanceDialog.action === 'close-previous' ? '(الزامی)' : '(اختیاری)'}</span>
              <textarea value={attendanceDialog.reason} onChange={(event) => setAttendanceDialog((current) => current ? { ...current, reason: event.target.value } : current)} className={`${inputClass} min-h-24`} placeholder="مثلاً فراموشی ثبت در زمان واقعی" />
            </label>}
        </ErpSheet>
      )}
      {intervalDialog && (
        <ErpSheet open onClose={() => setIntervalDialog(null)} title={intervalDialog.action === 'correct' ? 'اصلاح بازه تردد' : 'ابطال بازه تردد'} footer={<div className="flex justify-end gap-2"><ErpButton label="انصراف" onClick={() => setIntervalDialog(null)} tone="neutral" variant="ghost" /><ErpButton label={intervalDialog.action === 'correct' ? 'ثبت اصلاح' : 'تأیید ابطال'} onClick={submitIntervalDialog} tone={intervalDialog.action === 'void' ? 'danger' : undefined} variant="solid" disabled={Boolean(actionLoadingId) || !intervalDialog.reason.trim()} /></div>}>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{intervalDialog.record.employee.firstName} {intervalDialog.record.employee.lastName}</p>
            {intervalDialog.action === 'correct' && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label><span className={labelClass}>ورود</span><PersianCalendarComponent showTime value={intervalDialog.enteredAt} onChange={(enteredAt) => setIntervalDialog((current) => current ? { ...current, enteredAt } : current)} /></label>
                <label><span className={labelClass}>خروج (اختیاری)</span><PersianCalendarComponent showTime value={intervalDialog.exitedAt} onChange={(exitedAt) => setIntervalDialog((current) => current ? { ...current, exitedAt } : current)} clearable /></label>
              </div>
            )}
            <label className="mt-4 block"><span className={labelClass}>دلیل (الزامی)</span><textarea value={intervalDialog.reason} onChange={(event) => setIntervalDialog((current) => current ? { ...current, reason: event.target.value } : current)} className={`${inputClass} min-h-24`} /></label>
            <p className="mt-2 text-xs text-slate-500">سابقه قبلی حذف نمی‌شود و همراه عامل و دلیل در لاگ ممیزی باقی می‌ماند.</p>
        </ErpSheet>
      )}
    </ErpWorkspacePage>
  );
}
