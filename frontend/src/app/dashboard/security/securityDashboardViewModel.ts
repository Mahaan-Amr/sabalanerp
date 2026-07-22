import PersianCalendar from '@/lib/persian-calendar';

export interface SecurityPersonnelSummary {
  name: string;
  position: string;
  department: string | null;
}

export type DashboardAttendanceCondition = 'MISSION' | 'LEAVE';
export type DashboardAttendanceStatus = 'ALL' | 'ABSENT' | 'LATE' | 'PRESENT' | 'PENDING' | 'NON_WORKING_DAY';

export interface DashboardAttendanceRow {
  id: string;
  status: string;
  delayMinutes?: number | null;
  approvedMissions?: unknown[];
  approvedExceptions?: unknown[];
  approvedLeaves?: unknown[];
}

export interface TodayStatusCounts {
  absent: number;
  late: number;
  mission: number;
  leave: number;
}

export interface TodayStatusItem {
  id: 'absent' | 'late' | 'mission' | 'leave';
  label: string;
  value: number;
  href: string;
  tone: 'danger' | 'warning' | 'info' | 'purple';
}

const attendanceHref = (date: string, filter: { status?: string; condition?: DashboardAttendanceCondition }) => {
  const params = new URLSearchParams({ date });
  if (filter.status) params.set('status', filter.status);
  if (filter.condition) params.set('condition', filter.condition);
  return `/dashboard/security/attendance?${params.toString()}`;
};

export const buildTodayStatusItems = (counts: TodayStatusCounts, date: string): TodayStatusItem[] => [
  { id: 'absent', label: 'غایب', value: counts.absent, href: attendanceHref(date, { status: 'ABSENT' }), tone: 'danger' },
  { id: 'late', label: 'تأخیر', value: counts.late, href: attendanceHref(date, { status: 'LATE' }), tone: 'warning' },
  { id: 'mission', label: 'مأموریت', value: counts.mission, href: attendanceHref(date, { condition: 'MISSION' }), tone: 'info' },
  { id: 'leave', label: 'مرخصی', value: counts.leave, href: attendanceHref(date, { condition: 'LEAVE' }), tone: 'purple' },
];

export const matchesAttendanceFilter = (
  row: DashboardAttendanceRow,
  status: DashboardAttendanceStatus | string,
  condition: DashboardAttendanceCondition | null,
) => {
  if (condition === 'MISSION' && !(row.approvedMissions?.length)) return false;
  if (condition === 'LEAVE' && !(row.approvedLeaves?.length)) return false;
  return status === 'ALL' || row.status === status;
};

const validStatuses = new Set<DashboardAttendanceStatus>(['ALL', 'ABSENT', 'LATE', 'PRESENT', 'PENDING', 'NON_WORKING_DAY']);

export const parseAttendanceDashboardQuery = (params: URLSearchParams): {
  date: string | null;
  status: DashboardAttendanceStatus;
  condition: DashboardAttendanceCondition | null;
} => {
  const rawDate = params.get('date');
  const rawStatus = params.get('status') as DashboardAttendanceStatus | null;
  const rawCondition = params.get('condition') as DashboardAttendanceCondition | null;
  return {
    date: rawDate && PersianCalendar.isValid(rawDate) ? rawDate : null,
    status: rawStatus && validStatuses.has(rawStatus) ? rawStatus : 'ALL',
    condition: rawCondition === 'MISSION' || rawCondition === 'LEAVE' ? rawCondition : null,
  };
};

export const getNeedsAttention = <T extends DashboardAttendanceRow>(rows: T[], limit = 5) => {
  const absent = rows.filter((row) => row.status === 'ABSENT');
  const late = rows
    .filter((row) => row.status === 'LATE')
    .sort((left, right) => (right.delayMinutes || 0) - (left.delayMinutes || 0));
  return {
    absent: absent.slice(0, limit),
    late: late.slice(0, limit),
    absentTotal: absent.length,
    lateTotal: late.length,
  };
};

const securityQuickAccess = [
  { id: 'attendance', title: 'حضور و غیاب', href: '/dashboard/security/attendance', managerOnly: false },
  { id: 'shift-report', title: 'گزارش شیفت', href: '/dashboard/security/supervisor-reports', managerOnly: false, shiftReportOnly: true },
  { id: 'vehicles', title: 'خودرویی', href: '/dashboard/security/vehicles', managerOnly: false },
  { id: 'exceptions', title: 'استثناها و مأموریت‌ها', href: '/dashboard/security/exceptions', managerOnly: false },
  { id: 'shifts', title: 'شیفت‌ها', href: '/dashboard/security/shifts', managerOnly: false },
  { id: 'reports', title: 'گزارش‌ها', href: '/dashboard/security/reports', managerOnly: true },
  { id: 'personnel', title: 'کارکنان حراست', href: '/dashboard/security/personnel', managerOnly: true },
] as const;

export const buildSecurityQuickAccess = (isManager: boolean, canOpenShiftReport = isManager) => securityQuickAccess
  .filter((item) => (isManager || !item.managerOnly) && (!('shiftReportOnly' in item) || canOpenShiftReport))
  .map((item) => {
    const { managerOnly: _managerOnly, ...visibleItem } = item;
    if ('shiftReportOnly' in visibleItem) {
      const { shiftReportOnly: _shiftReportOnly, ...quickAccessItem } = visibleItem;
      return quickAccessItem;
    }
    return visibleItem;
  });
