'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FaCalendarDay,
  FaChartLine,
  FaClock,
  FaFileAlt,
  FaPlane,
  FaShieldAlt,
  FaTruck,
  FaUserClock,
  FaUserTimes,
} from 'react-icons/fa';
import {
  ErpAttentionList,
  ErpCurrentShiftPanel,
  ErpDashboardSkeleton,
  ErpInlineError,
  ErpWorkspacePage,
  ErpQuickAccessGrid,
  ErpShiftTimeline,
  ErpStatusSummary,
} from '@/components/erp';
import { WORKSPACES, WORKSPACE_PERMISSIONS, useWorkspace } from '@/contexts/WorkspaceContext';
import { securityAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';
import { buildSecurityQuickAccess, buildTodayStatusItems, getNeedsAttention } from './securityDashboardViewModel';

interface DashboardStats {
  todayStats: { absent: number; late: number; mission: number; leave: number };
  shiftAwarenessEligible?: boolean;
}

interface AttendanceRow {
  id: string;
  employee: { id: string; firstName: string; lastName: string; username?: string };
  status: string;
  delayMinutes?: number | null;
  approvedMissions?: unknown[];
  approvedExceptions?: unknown[];
  approvedLeaves?: unknown[];
}

interface DailyAttendance {
  attendanceSummary: AttendanceRow[];
}

interface CurrentShiftAwareness {
  authorized: boolean;
  access: 'manager' | 'operator' | null;
  overview: null | {
    state: 'ACTIVE' | 'SCHEDULED_NOT_STARTED' | 'NONE';
    sessionId: string | null;
    slotId: string | null;
    startedAt: string | null;
    startsAt: string | null;
    endsAt: string | null;
    overdue: boolean;
    coverageKind: 'PLANNED' | 'REPLACEMENT' | 'TEMPORARY' | null;
    effectivePersonnel: { id: string; name: string; position: string | null } | null;
    plannedPersonnel: { id: string; name: string; position: string | null } | null;
  };
  recentReports?: Array<{
    id: string;
    rowNumber: number;
    status: string;
    title: string;
    description: string | null;
    createdAt: string;
    voidReason: string | null;
    voidedAt: string | null;
    participants: string[];
    attachmentCount: number;
  }>;
}

const formatShiftTimestamp = (value: string | null) => {
  if (!value) return null;
  return PersianCalendar.isToday(value)
    ? PersianCalendar.toPersian(value, 'HH:mm')
    : PersianCalendar.toPersian(value, 'jYYYY/jMM/jDD - HH:mm');
};

export default function SecurityDashboardPage() {
  const { hasPermission, loading: permissionsLoading } = useWorkspace();
  const today = PersianCalendar.now();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState('');
  const [attendance, setAttendance] = useState<DailyAttendance | null>(null);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [attendanceError, setAttendanceError] = useState('');
  const [shiftAwareness, setShiftAwareness] = useState<CurrentShiftAwareness | null>(null);
  const [shiftLoading, setShiftLoading] = useState(true);
  const [shiftRefreshing, setShiftRefreshing] = useState(false);
  const [shiftError, setShiftError] = useState('');
  const [shiftUpdatedAt, setShiftUpdatedAt] = useState<Date | null>(null);

  const securityAdmin = hasPermission(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.ADMIN);
  const showShiftShell = securityAdmin || Boolean(stats?.shiftAwarenessEligible);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError('');
    try {
      const response = await securityAPI.getDashboardStats();
      if (response.data.success) setStats(response.data.data);
    } catch (error: any) {
      setStatsError(error.response?.data?.error || 'دریافت وضعیت امروز ناموفق بود.');
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const loadAttendance = useCallback(async () => {
    setAttendanceLoading(true);
    setAttendanceError('');
    try {
      const response = await securityAPI.getDailyAttendance(PersianCalendar.toGregorianDateOnly(today));
      if (response.data.success) setAttendance(response.data.data);
    } catch (error: any) {
      setAttendanceError(error.response?.data?.error || 'دریافت افراد نیازمند پیگیری ناموفق بود.');
    } finally {
      setAttendanceLoading(false);
    }
  }, [today]);

  const loadCurrentShift = useCallback(async ({ silent = false } = {}) => {
    if (silent) setShiftRefreshing(true);
    else setShiftLoading(true);
    try {
      const response = await securityAPI.getDashboardCurrentShift();
      if (response.data.success) {
        setShiftAwareness(response.data.data);
        setShiftUpdatedAt(new Date());
        setShiftError('');
      }
    } catch (error: any) {
      setShiftError(error.response?.data?.error || 'دریافت وضعیت شیفت جاری ناموفق بود.');
    } finally {
      setShiftLoading(false);
      setShiftRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
    loadAttendance();
    loadCurrentShift();
  }, [loadAttendance, loadCurrentShift, loadStats]);

  useEffect(() => {
    if (!shiftAwareness?.authorized) return;
    const intervalId = window.setInterval(() => loadCurrentShift({ silent: true }), 30_000);
    return () => window.clearInterval(intervalId);
  }, [loadCurrentShift, shiftAwareness?.authorized]);

  const statusItems = useMemo(() => {
    const counts = stats?.todayStats || { absent: 0, late: 0, mission: 0, leave: 0 };
    const icons = { absent: FaUserTimes, late: FaUserClock, mission: FaPlane, leave: FaCalendarDay };
    return buildTodayStatusItems(counts, today).map((item) => ({ ...item, icon: icons[item.id] }));
  }, [stats, today]);

  const attention = useMemo(() => getNeedsAttention(attendance?.attendanceSummary || []), [attendance]);
  const absentHref = statusItems.find((item) => item.id === 'absent')?.href || '/dashboard/security/attendance';
  const lateHref = statusItems.find((item) => item.id === 'late')?.href || '/dashboard/security/attendance';

  const quickAccessItems = useMemo(() => {
    const icons = { attendance: FaClock, 'shift-report': FaFileAlt, vehicles: FaTruck, exceptions: FaPlane, shifts: FaCalendarDay, reports: FaChartLine, personnel: FaShieldAlt };
    const canOpenShiftReport = securityAdmin || (shiftAwareness?.access === 'operator' && shiftAwareness.overview?.state === 'ACTIVE');
    return buildSecurityQuickAccess(securityAdmin, canOpenShiftReport).map((item) => ({ ...item, icon: icons[item.id] }));
  }, [securityAdmin, shiftAwareness?.access, shiftAwareness?.overview?.state]);

  const overview = shiftAwareness?.overview;
  const coverageLabel = overview?.coverageKind === 'REPLACEMENT'
    ? 'جانشین شیفت'
    : overview?.coverageKind === 'TEMPORARY'
      ? 'پوشش موقت'
      : null;

  return (
    <ErpWorkspacePage title="گارد" context={PersianCalendar.formatForDisplay(today)}>
      {!permissionsLoading && showShiftShell && shiftLoading && !shiftAwareness && <ErpDashboardSkeleton variant="panel" />}
      {!permissionsLoading && showShiftShell && shiftError && !shiftAwareness && <ErpInlineError message={shiftError} onRetry={() => loadCurrentShift()} />}
      {shiftAwareness?.authorized && overview && (
        <ErpCurrentShiftPanel
          state={overview.state}
          personnelName={overview.effectivePersonnel?.name}
          personnelPosition={overview.effectivePersonnel?.position}
          plannedPersonnelName={overview.plannedPersonnel?.name}
          coverageLabel={coverageLabel}
          scheduleLabel={overview.startsAt && overview.endsAt ? `${formatShiftTimestamp(overview.startsAt)} تا ${formatShiftTimestamp(overview.endsAt)}` : null}
          startedLabel={formatShiftTimestamp(overview.startedAt)}
          overdue={overview.overdue}
          updatedLabel={shiftUpdatedAt ? PersianCalendar.toPersian(shiftUpdatedAt, 'HH:mm:ss') : null}
          refreshing={shiftRefreshing}
          refreshFailed={Boolean(shiftError)}
          onRefresh={() => loadCurrentShift({ silent: true })}
        />
      )}

      {statsLoading && !stats ? <ErpDashboardSkeleton variant="summary" /> : statsError && !stats ? (
        <ErpInlineError message={statsError} onRetry={loadStats} />
      ) : (
        <ErpStatusSummary title="وضعیت امروز" dateLabel={PersianCalendar.formatForDisplay(today)} items={statusItems} />
      )}

      {permissionsLoading ? <ErpDashboardSkeleton variant="summary" /> : <ErpQuickAccessGrid title="دسترسی سریع" items={quickAccessItems} />}

      {attendanceLoading && !attendance ? <ErpDashboardSkeleton variant="list" /> : attendanceError && !attendance ? (
        <ErpInlineError message={attendanceError} onRetry={loadAttendance} />
      ) : (
        <ErpAttentionList
          title="نیازمند پیگیری"
          groups={[
            {
              id: 'absent',
              label: 'غایب',
              count: attention.absentTotal,
              href: absentHref,
              tone: 'danger',
              items: attention.absent.map((record) => ({
                id: record.employee.id,
                title: `${record.employee.firstName} ${record.employee.lastName}`,
                meta: record.employee.username ? `@${record.employee.username}` : undefined,
              })),
            },
            {
              id: 'late',
              label: 'تأخیر',
              count: attention.lateTotal,
              href: lateHref,
              tone: 'warning',
              items: attention.late.map((record) => ({
                id: record.employee.id,
                title: `${record.employee.firstName} ${record.employee.lastName}`,
                meta: `${(record.delayMinutes || 0).toLocaleString('fa-IR')} دقیقه تأخیر`,
              })),
            },
          ]}
        />
      )}

      {shiftAwareness?.authorized && overview?.state === 'ACTIVE' && (
        <ErpShiftTimeline
          title="گزارش‌های لحظه‌ای شیفت فعال"
          entries={shiftAwareness.recentReports || []}
          formatTimestamp={(value) => formatShiftTimestamp(value) || '-'}
          action={{ label: 'مشاهده گزارش کامل', href: '/dashboard/security/supervisor-reports' }}
          compact
        />
      )}
    </ErpWorkspacePage>
  );
}
