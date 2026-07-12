'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  FaCalendarAlt,
  FaCheckCircle,
  FaClock,
  FaDownload,
  FaExclamationTriangle,
  FaFilter,
  FaSearch,
  FaSignature,
  FaSignInAlt,
  FaSignOutAlt,
  FaUserCheck,
  FaUserTimes,
  FaUsers,
} from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection } from '@/components/erp';
import { notifySecurity } from '@/components/SecurityNoticeHost';
import PersianCalendarComponent from '@/components/PersianCalendar';
import PersianCalendar from '@/lib/persian-calendar';
import { departmentsAPI, securityAPI } from '@/lib/api';

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
  shift?: {
    id: string;
    namePersian: string;
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
      return 'تاخیر';
    case 'MISSION':
      return 'ماموریت';
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

const canCheckIn = (record: AttendanceRecord) => !record.entryTime && ['ABSENT', 'PRESENT'].includes(record.status);
const canCheckOut = (record: AttendanceRecord) => Boolean(record.entryTime) && !record.exitTime && ['PRESENT', 'LATE'].includes(record.status);
const isExceptionStatus = (status: string) => ['MISSION', 'HOURLY_LEAVE', 'SICK_LEAVE', 'VACATION'].includes(status);

export default function AttendancePage() {
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [stats, setStats] = useState<AttendanceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(PersianCalendar.now());
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [departmentId, setDepartmentId] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const fetchAttendanceData = async () => {
    try {
      setLoading(true);
      setError(null);

      const attendanceResponse = await securityAPI.getDailyAttendance({
        date: PersianCalendar.toGregorian(selectedDate).toISOString(),
        departmentId: departmentId || undefined,
        shiftId: shiftId || undefined,
      });

      if (attendanceResponse.data.success) {
        setAttendanceRecords(attendanceResponse.data.data.attendanceSummary || []);
        setStats(attendanceResponse.data.data.stats);
      }
    } catch (requestError: any) {
      console.error('Error fetching attendance data:', requestError);
      setError(requestError.response?.data?.error || 'خطا در دریافت اطلاعات');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAttendanceData();
  }, [selectedDate, departmentId, shiftId]);

  useEffect(() => {
    const loadFilters = async () => {
      try {
        const [departmentsResponse, shiftsResponse] = await Promise.all([
          departmentsAPI.getDepartments(),
          securityAPI.getShifts(),
        ]);
        if (departmentsResponse.data.success) setDepartments(departmentsResponse.data.data || []);
        if (shiftsResponse.data.success) setShifts(shiftsResponse.data.data || []);
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
    const matchesStatus = statusFilter === 'ALL' || record.status === statusFilter;
    return matchesSearch && matchesStatus;
  }), [attendanceRecords, searchTerm, statusFilter]);

  const runAttendanceAction = async (record: AttendanceRecord, action: 'checkin' | 'checkout') => {
    setActionLoadingId(`${action}-${record.employee.id}`);
    try {
      const response = action === 'checkin'
        ? await securityAPI.checkIn(record.employee.id)
        : await securityAPI.checkOut(record.employee.id);
      if (response.data.success) {
        notifySecurity(action === 'checkin' ? 'ورود ثبت شد' : 'خروج ثبت شد');
        await fetchAttendanceData();
      }
    } catch (requestError: any) {
      notifySecurity(requestError.response?.data?.error || 'ثبت عملیات ناموفق بود', 'error');
    } finally {
      setActionLoadingId('');
    }
  };

  if (loading) return <ErpLoading />;

  if (error) {
    return (
      <ErpPage eyebrow="حراست" title="ورود و خروج" description="گزارش حضور و غیاب روزانه">
        <ErpEmptyState
          icon={FaExclamationTriangle}
          title="اطلاعات حضور و غیاب دریافت نشد"
          description={error}
          action={{ label: 'تلاش مجدد', onClick: fetchAttendanceData, variant: 'solid' }}
        />
      </ErpPage>
    );
  }

  return (
    <ErpPage
      eyebrow="حراست"
      title="ورود و خروج"
      description={`گزارش روز ${PersianCalendar.formatForDisplay(selectedDate)}`}
      actions={[{ label: 'به‌روزرسانی', icon: FaDownload, onClick: fetchAttendanceData, tone: 'neutral' }]}
      metrics={[
        { label: 'کل کارکنان', value: stats?.totalEmployees.toLocaleString('fa-IR') || '۰', icon: FaUsers, tone: 'neutral' },
        { label: 'حاضر', value: stats?.present.toLocaleString('fa-IR') || '۰', icon: FaUserCheck, tone: 'success' },
        { label: 'غایب', value: stats?.absent.toLocaleString('fa-IR') || '۰', icon: FaUserTimes, tone: 'danger' },
        { label: 'تاخیر', value: stats?.late.toLocaleString('fa-IR') || '۰', icon: FaClock, tone: 'warning' },
        { label: 'ماموریت', value: stats?.mission.toLocaleString('fa-IR') || '۰', icon: FaClock, tone: 'info' },
        { label: 'مرخصی', value: stats?.leave.toLocaleString('fa-IR') || '۰', icon: FaCalendarAlt, tone: 'purple' },
      ]}
    >
      <ErpSection title="فیلترها" description="در موبایل فیلترها فشرده می‌شوند تا لیست عملیات همیشه در دسترس بماند.">
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
            <ErpButton label={filtersOpen ? 'بستن فیلترها' : 'فیلترها'} icon={FaFilter} onClick={() => setFiltersOpen((current) => !current)} tone="neutral" />
            <ErpButton label="به‌روزرسانی" icon={FaDownload} onClick={fetchAttendanceData} variant="solid" />
          </div>
        </div>

        <div className={`mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4 ${filtersOpen ? '' : 'hidden lg:grid'}`}>
          <label>
            <span className={labelClass}>تاریخ</span>
            <PersianCalendarComponent value={selectedDate} onChange={setSelectedDate} placeholder="انتخاب تاریخ" />
          </label>
          <label>
            <span className={labelClass}>بخش</span>
            <select value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className={inputClass}>
              <option value="">همه بخش‌ها</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>{department.namePersian}</option>
              ))}
            </select>
          </label>
          <label>
            <span className={labelClass}>شیفت</span>
            <select value={shiftId} onChange={(event) => setShiftId(event.target.value)} className={inputClass}>
              <option value="">همه شیفت‌ها</option>
              {shifts.map((shift) => (
                <option key={shift.id} value={shift.id}>{shift.namePersian}</option>
              ))}
            </select>
          </label>
          <label>
            <span className={labelClass}>وضعیت</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={inputClass}>
              <option value="ALL">همه وضعیت‌ها</option>
              <option value="PRESENT">حاضر</option>
              <option value="ABSENT">غایب</option>
              <option value="LATE">تاخیر</option>
              <option value="MISSION">ماموریت</option>
              <option value="HOURLY_LEAVE">مرخصی ساعتی</option>
            </select>
          </label>
        </div>
      </ErpSection>

      <ErpSection title="لیست حضور و غیاب" description={`${filteredRecords.length.toLocaleString('fa-IR')} نفر در فیلتر فعلی`}>
        {filteredRecords.length === 0 ? (
          <ErpEmptyState icon={FaUsers} title="رکوردی برای نمایش وجود ندارد" description="فیلترها را تغییر دهید یا تاریخ دیگری انتخاب کنید." />
        ) : (
          <>
            <div className="space-y-3 lg:hidden">
              {filteredRecords.map((record) => {
                const checkingIn = actionLoadingId === `checkin-${record.employee.id}`;
                const checkingOut = actionLoadingId === `checkout-${record.employee.id}`;
                return (
                  <ErpCard key={record.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold text-slate-900 dark:text-white">
                          {record.employee.firstName} {record.employee.lastName}
                        </p>
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {record.employee.department?.namePersian || 'بدون بخش'}{record.employee.username ? ` · @${record.employee.username}` : ''}
                        </p>
                      </div>
                      <ErpBadge tone={getStatusTone(record.status)}>{getStatusLabel(record.status)}</ErpBadge>
                    </div>

                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/70">
                        <dt className="text-xs text-slate-500 dark:text-slate-400">ورود</dt>
                        <dd className="mt-1 font-semibold text-slate-900 dark:text-white">{record.entryTime || '-'}</dd>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/70">
                        <dt className="text-xs text-slate-500 dark:text-slate-400">خروج</dt>
                        <dd className="mt-1 font-semibold text-slate-900 dark:text-white">{record.exitTime || '-'}</dd>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/70">
                        <dt className="text-xs text-slate-500 dark:text-slate-400">شیفت ثبت</dt>
                        <dd className="mt-1 font-semibold text-slate-900 dark:text-white">{record.shift?.namePersian || '-'}</dd>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/70">
                        <dt className="text-xs text-slate-500 dark:text-slate-400">امضا</dt>
                        <dd className="mt-1 flex items-center gap-2 font-semibold text-slate-900 dark:text-white">
                          {record.digitalSignature ? <><FaSignature className="h-4 w-4 text-emerald-600" /> ثبت شده</> : '-'}
                        </dd>
                      </div>
                    </dl>

                    <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                      {record.notes || record.exceptionType || 'بدون یادداشت'}
                    </p>

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <ErpButton
                        label="ثبت ورود"
                        icon={FaSignInAlt}
                        onClick={() => runAttendanceAction(record, 'checkin')}
                        disabled={!canCheckIn(record) || Boolean(actionLoadingId)}
                        variant={canCheckIn(record) ? 'solid' : 'soft'}
                      />
                      <ErpButton
                        label="ثبت خروج"
                        icon={FaSignOutAlt}
                        onClick={() => runAttendanceAction(record, 'checkout')}
                        disabled={!canCheckOut(record) || Boolean(actionLoadingId)}
                        tone="neutral"
                        variant={canCheckOut(record) ? 'solid' : 'soft'}
                      />
                    </div>
                    {(checkingIn || checkingOut) && <p className="mt-2 text-xs font-semibold text-[#074747] dark:text-teal-200">در حال ثبت...</p>}
                    {isExceptionStatus(record.status) && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">برای وضعیت‌های استثنا، ورود و خروج مستقیم از کارت پیشنهاد نمی‌شود.</p>}
                    {record.entryTime && record.exitTime && <p className="mt-2 inline-flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-300"><FaCheckCircle /> تکمیل شده</p>}
                  </ErpCard>
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
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">شیفت ثبت</th>
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
                      <td className="px-3 py-4"><ErpBadge tone={getStatusTone(record.status)}>{getStatusLabel(record.status)}</ErpBadge></td>
                      <td className="px-3 py-4 text-slate-900 dark:text-white">{record.entryTime || '-'}</td>
                      <td className="px-3 py-4 text-slate-900 dark:text-white">{record.exitTime || '-'}</td>
                      <td className="px-3 py-4 text-slate-600 dark:text-slate-300">{record.shift?.namePersian || '-'}</td>
                      <td className="px-3 py-4 text-slate-600 dark:text-slate-300">{record.notes || record.exceptionType || (record.digitalSignature ? 'امضا ثبت شده' : '-')}</td>
                      <td className="px-3 py-4">
                        <div className="flex flex-wrap gap-2">
                          <ErpButton label="ورود" icon={FaSignInAlt} onClick={() => runAttendanceAction(record, 'checkin')} disabled={!canCheckIn(record) || Boolean(actionLoadingId)} variant="soft" />
                          <ErpButton label="خروج" icon={FaSignOutAlt} onClick={() => runAttendanceAction(record, 'checkout')} disabled={!canCheckOut(record) || Boolean(actionLoadingId)} tone="neutral" variant="soft" />
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
    </ErpPage>
  );
}
