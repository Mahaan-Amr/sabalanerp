'use client';

import { useEffect, useState } from 'react';
import {
  FaCalendarDay,
  FaChartLine,
  FaClock,
  FaExclamationTriangle,
  FaFileAlt,
  FaFingerprint,
  FaPlane,
  FaShieldAlt,
  FaSignature,
  FaSignInAlt,
  FaSignOutAlt,
  FaTruck,
  FaUserCheck,
  FaUserClock,
  FaUsers,
  FaUserTimes,
} from 'react-icons/fa';
import {
  ErpActionGrid,
  ErpBadge,
  ErpButton,
  ErpEmptyState,
  ErpLoading,
  ErpPage,
  ErpSection,
} from '@/components/erp';
import DigitalSignature from '@/components/DigitalSignature';
import ExceptionRequestForm from '@/components/ExceptionRequestForm';
import MissionAssignmentForm from '@/components/MissionAssignmentForm';
import MobileSecurityDashboard from '@/components/MobileSecurityDashboard';
import PersianCalendarComponent from '@/components/PersianCalendar';
import { securityAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';

interface SecurityStats {
  currentShift: {
    id: string;
    name: string;
    namePersian: string;
    startTime: string;
    endTime: string;
    duration: number;
  };
  securityPersonnel: {
    name: string;
    position: string;
    department: string;
  };
  todayStats: {
    totalEmployees: number;
    present: number;
    absent: number;
    late: number;
    mission: number;
    leave: number;
  };
  recentActivity: Array<{
    id?: string;
    employeeId: string;
    entryTime: string | null;
    exitTime: string | null;
    status: string;
    exceptionType: string | null;
    digitalSignature?: string | null;
  }>;
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
}

interface AttendanceRecord {
  employee: Employee;
  attendance: {
    id: string;
    entryTime: string | null;
    exitTime: string | null;
    status: string;
    exceptionType: string | null;
    notes: string | null;
  } | null;
  status: string;
}

interface DailyAttendance {
  date: string;
  shift: {
    id: string;
    name: string;
    namePersian: string;
  };
  attendanceSummary: AttendanceRecord[];
  totalEmployees: number;
  presentCount: number;
  absentCount: number;
  exceptionCount: number;
}

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
      return 'Ø­Ø§Ø¶Ø±';
    case 'ABSENT':
      return 'ØºØ§ÛŒØ¨';
    case 'LATE':
      return 'ØªØ§Ø®ÛŒØ±';
    case 'MISSION':
      return 'Ù…Ø§Ù…ÙˆØ±ÛŒØª';
    case 'HOURLY_LEAVE':
      return 'Ù…Ø±Ø®ØµÛŒ Ø³Ø§Ø¹ØªÛŒ';
    case 'SICK_LEAVE':
      return 'Ù…Ø±Ø®ØµÛŒ Ø§Ø³ØªØ¹Ù„Ø§Ø¬ÛŒ';
    case 'VACATION':
      return 'Ù…Ø±Ø®ØµÛŒ Ø±ÙˆØ²Ø§Ù†Ù‡';
    default:
      return 'Ù†Ø§Ù…Ø´Ø®Øµ';
  }
};

const getRequestStatusBadge = (status: string) => {
  if (status === 'PENDING') return <ErpBadge tone="warning">Ø¯Ø± Ø§Ù†ØªØ¸Ø§Ø±</ErpBadge>;
  if (status === 'APPROVED') return <ErpBadge tone="success">ØªØ§ÛŒÛŒØ¯ Ø´Ø¯Ù‡</ErpBadge>;
  return <ErpBadge tone="danger">Ø±Ø¯ Ø´Ø¯Ù‡</ErpBadge>;
};

export default function SecurityDashboardPage() {
  const [stats, setStats] = useState<SecurityStats | null>(null);
  const [dailyAttendance, setDailyAttendance] = useState<DailyAttendance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState(PersianCalendar.now());
  const [showExceptionForm, setShowExceptionForm] = useState(false);
  const [showMissionForm, setShowMissionForm] = useState(false);
  const [exceptionRequests, setExceptionRequests] = useState<any[]>([]);
  const [missionAssignments, setMissionAssignments] = useState<any[]>([]);
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [isMobile, setIsMobile] = useState(false);

  const fetchSecurityData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [statsResponse, attendanceResponse] = await Promise.all([
        securityAPI.getDashboardStats(),
        securityAPI.getDailyAttendance(PersianCalendar.toGregorian(selectedDate).toISOString()),
      ]);

      if (statsResponse.data.success) setStats(statsResponse.data.data);
      if (attendanceResponse.data.success) setDailyAttendance(attendanceResponse.data.data);
    } catch (requestError: any) {
      console.error('Error fetching security data:', requestError);
      setError(requestError.response?.data?.error || 'Ø®Ø·Ø§ Ø¯Ø± Ø¯Ø±ÛŒØ§ÙØª Ø§Ø·Ù„Ø§Ø¹Ø§Øª');
    } finally {
      setLoading(false);
    }
  };

  const fetchExceptionRequests = async () => {
    try {
      const response = await securityAPI.getExceptionRequests({ limit: 5 });
      if (response.data.success) setExceptionRequests(response.data.data);
    } catch (requestError) {
      console.error('Error fetching exception requests:', requestError);
    }
  };

  const fetchMissionAssignments = async () => {
    try {
      const response = await securityAPI.getMissionAssignments({ limit: 5 });
      if (response.data.success) setMissionAssignments(response.data.data);
    } catch (requestError) {
      console.error('Error fetching mission assignments:', requestError);
    }
  };

  useEffect(() => {
    const updateMobileState = () => setIsMobile(window.innerWidth < 768);
    updateMobileState();
    window.addEventListener('resize', updateMobileState);
    return () => window.removeEventListener('resize', updateMobileState);
  }, []);

  useEffect(() => {
    fetchSecurityData();
  }, [selectedDate]);

  useEffect(() => {
    fetchExceptionRequests();
    fetchMissionAssignments();
  }, []);

  const handleCheckIn = async () => {
    if (!selectedEmployee) {
      alert('Ù„Ø·ÙØ§ Ú©Ø§Ø±Ù…Ù†Ø¯ Ø±Ø§ Ø§Ù†ØªØ®Ø§Ø¨ Ú©Ù†ÛŒØ¯');
      return;
    }

    try {
      setActionLoading(true);
      const response = await securityAPI.checkIn(selectedEmployee);
      if (response.data.success) {
        alert('ÙˆØ±ÙˆØ¯ Ø¨Ø§ Ù…ÙˆÙÙ‚ÛŒØª Ø«Ø¨Øª Ø´Ø¯');
        setSelectedEmployee('');
        fetchSecurityData();
      }
    } catch (requestError: any) {
      console.error('Check-in error:', requestError);
      alert(requestError.response?.data?.error || 'Ø®Ø·Ø§ Ø¯Ø± Ø«Ø¨Øª Ø¹Ù…Ù„ÛŒØ§Øª');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCheckOut = async () => {
    if (!selectedEmployee) {
      alert('Ù„Ø·ÙØ§ Ú©Ø§Ø±Ù…Ù†Ø¯ Ø±Ø§ Ø§Ù†ØªØ®Ø§Ø¨ Ú©Ù†ÛŒØ¯');
      return;
    }

    try {
      setActionLoading(true);
      const response = await securityAPI.checkOut(selectedEmployee);
      if (response.data.success) {
        alert('Ø®Ø±ÙˆØ¬ Ø¨Ø§ Ù…ÙˆÙÙ‚ÛŒØª Ø«Ø¨Øª Ø´Ø¯');
        setSelectedEmployee('');
        fetchSecurityData();
      }
    } catch (requestError: any) {
      console.error('Check-out error:', requestError);
      alert(requestError.response?.data?.error || 'Ø®Ø·Ø§ Ø¯Ø± Ø«Ø¨Øª Ø¹Ù…Ù„ÛŒØ§Øª');
    } finally {
      setActionLoading(false);
    }
  };

  const handleExceptionRequest = async (data: any) => {
    try {
      setActionLoading(true);
      await securityAPI.createExceptionRequest(data);
      alert('Ø¯Ø±Ø®ÙˆØ§Ø³Øª Ø¨Ø§ Ù…ÙˆÙÙ‚ÛŒØª Ø«Ø¨Øª Ø´Ø¯');
      setShowExceptionForm(false);
      fetchExceptionRequests();
    } catch (requestError: any) {
      alert(`Ø®Ø·Ø§ Ø¯Ø± Ø«Ø¨Øª Ø¹Ù…Ù„ÛŒØ§Øª: ${requestError.response?.data?.error || requestError.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleMissionAssignment = async (data: any) => {
    try {
      setActionLoading(true);
      await securityAPI.createMissionAssignment(data);
      alert('Ù…Ø§Ù…ÙˆØ±ÛŒØª Ø¨Ø§ Ù…ÙˆÙÙ‚ÛŒØª Ø«Ø¨Øª Ø´Ø¯');
      setShowMissionForm(false);
      fetchMissionAssignments();
    } catch (requestError: any) {
      alert(`Ø®Ø·Ø§ Ø¯Ø± Ø«Ø¨Øª Ø¹Ù…Ù„ÛŒØ§Øª: ${requestError.response?.data?.error || requestError.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSignatureSave = async (signatureData: string) => {
    if (!selectedRecord) return;

    try {
      await securityAPI.saveAttendanceSignature(selectedRecord.id, signatureData, 'CHECKIN');
      setShowSignatureModal(false);
      setSelectedRecord(null);
      fetchSecurityData();
    } catch (requestError: any) {
      console.error('Error saving signature:', requestError);
      alert(`Ø®Ø·Ø§ Ø¯Ø± Ø«Ø¨Øª Ø¹Ù…Ù„ÛŒØ§Øª: ${requestError.response?.data?.error || requestError.message}`);
    }
  };

  if (loading) return <ErpLoading />;

  if (error) {
    return (
      <ErpPage
        eyebrow="Security"
        title="Ø­Ø±Ø§Ø³Øª"
        description="Ø¯Ø§Ø´Ø¨ÙˆØ±Ø¯ ÙˆØ±ÙˆØ¯ Ùˆ Ø®Ø±ÙˆØ¬ Ùˆ Ú©Ù†ØªØ±Ù„ Ø´ÛŒÙØªâ€ŒÙ‡Ø§"
        metrics={[]}
      >
        <ErpEmptyState
          icon={FaExclamationTriangle}
          title="Ø§Ø·Ù„Ø§Ø¹Ø§Øª Ø­Ø±Ø§Ø³Øª Ø¯Ø±ÛŒØ§ÙØª Ù†Ø´Ø¯"
          description={error}
          action={{ label: 'ØªÙ„Ø§Ø´ Ù…Ø¬Ø¯Ø¯', onClick: fetchSecurityData, icon: FaClock, variant: 'solid' }}
        />
      </ErpPage>
    );
  }

  if (isMobile) return <MobileSecurityDashboard />;

  const attendanceRows = dailyAttendance?.attendanceSummary || [];
  const currentShift = stats?.currentShift;

  return (
    <ErpPage
      eyebrow="Security"
      title="Ø­Ø±Ø§Ø³Øª"
      description={`${stats?.securityPersonnel.name || 'Ú©Ø§Ø±Ø¨Ø± Ø­Ø±Ø§Ø³Øª'} - ${stats?.securityPersonnel.position || 'Ø§Ù¾Ø±Ø§ØªÙˆØ± Ø´ÛŒÙØª'}`}
      actions={[
        { label: 'Ø¯Ø±Ø®ÙˆØ§Ø³Øª Ø§Ø³ØªØ«Ù†Ø§', onClick: () => setShowExceptionForm(true), icon: FaExclamationTriangle, tone: 'warning' },
        { label: 'Ù…Ø§Ù…ÙˆØ±ÛŒØª Ø¬Ø¯ÛŒØ¯', onClick: () => setShowMissionForm(true), icon: FaPlane, tone: 'info' },
      ]}
      metrics={[
        { label: 'Ú©Ù„ Ú©Ø§Ø±Ú©Ù†Ø§Ù†', value: stats?.todayStats.totalEmployees || 0, icon: FaUsers, tone: 'neutral' },
        { label: 'Ø­Ø§Ø¶Ø±', value: stats?.todayStats.present || 0, icon: FaUserCheck, tone: 'success' },
        { label: 'ØºØ§ÛŒØ¨', value: stats?.todayStats.absent || 0, icon: FaUserTimes, tone: 'danger' },
        { label: 'ØªØ§Ø®ÛŒØ±', value: stats?.todayStats.late || 0, icon: FaUserClock, tone: 'warning' },
        { label: 'Ù…Ø§Ù…ÙˆØ±ÛŒØª', value: stats?.todayStats.mission || 0, icon: FaPlane, tone: 'info' },
        { label: 'Ù…Ø±Ø®ØµÛŒ', value: stats?.todayStats.leave || 0, icon: FaCalendarDay, tone: 'purple' },
      ]}
    >
      <ErpSection
        title="Ø´ÛŒÙØª Ùˆ Ø¯Ø³ØªØ±Ø³ÛŒ Ø³Ø±ÛŒØ¹"
        description={currentShift ? `${currentShift.namePersian} Ø§Ø² ${currentShift.startTime} ØªØ§ ${currentShift.endTime}` : 'Ø´ÛŒÙØª Ø¬Ø§Ø±ÛŒ Ø«Ø¨Øª Ù†Ø´Ø¯Ù‡ Ø§Ø³Øª'}
      >
        <ErpActionGrid
          columns={4}
          compact
          items={[
            { title: 'Ø­Ø¶ÙˆØ± Ùˆ ØºÛŒØ§Ø¨', description: 'Ù„ÛŒØ³Øª Ø±ÙˆØ²Ø§Ù†Ù‡ ÙˆØ±ÙˆØ¯ Ùˆ Ø®Ø±ÙˆØ¬', href: '/dashboard/security/attendance', icon: FaClock, tone: 'primary' },
            { title: 'خودرویی', description: 'رجیستر راننده/خودرو، ورود خودروی پر و خروج فروش', href: '/dashboard/security/vehicles', icon: FaTruck, tone: 'info' },
            { title: 'Ú©Ø§Ø±Ú©Ù†Ø§Ù† Ø­Ø±Ø§Ø³Øª', description: 'Ù…Ø¯ÛŒØ±ÛŒØª Ù¾Ø±Ø³Ù†Ù„ Ùˆ Ù†Ù‚Ø´â€ŒÙ‡Ø§', href: '/dashboard/security/personnel', icon: FaShieldAlt, tone: 'neutral' },
            { title: 'Ø´ÛŒÙØªâ€ŒÙ‡Ø§', description: 'ØªØ¹Ø±ÛŒÙ Ø¨Ø±Ù†Ø§Ù…Ù‡ Ú©Ø§Ø±ÛŒ', href: '/dashboard/security/shifts', icon: FaCalendarDay, tone: 'info' },
            { title: 'گزارش سرپرست', description: 'ثبت گزارش شیفت، رخدادها و پیگیری‌ها', href: '/dashboard/security/supervisor-reports', icon: FaFileAlt, tone: 'success' },
            { title: 'Ú¯Ø²Ø§Ø±Ø´â€ŒÙ‡Ø§', description: 'Ø®Ø±ÙˆØ¬ÛŒ Ùˆ ØªØ­Ù„ÛŒÙ„ ØªØ±Ø¯Ø¯', href: '/dashboard/security/reports', icon: FaChartLine, tone: 'success' },
            { title: 'Ø§Ø³ØªØ«Ù†Ø§Ù‡Ø§', description: 'ØªØ§Ø®ÛŒØ±ØŒ Ù…Ø±Ø®ØµÛŒ Ùˆ Ø§ØµÙ„Ø§Ø­ ØªØ±Ø¯Ø¯', href: '/dashboard/security/exceptions', icon: FaFileAlt, tone: 'warning' },
          ]}
        />
      </ErpSection>

      <ErpSection title="Ø«Ø¨Øª ÙˆØ±ÙˆØ¯ Ùˆ Ø®Ø±ÙˆØ¬" description="Ø¨Ø±Ø§ÛŒ Ø«Ø¨Øª Ø¯Ø³ØªÛŒ Ø¹Ù…Ù„ÛŒØ§ØªØŒ Ø§Ø¨ØªØ¯Ø§ Ú©Ø§Ø±Ù…Ù†Ø¯ Ø±Ø§ Ø§Ø² Ù„ÛŒØ³Øª Ù‡Ù…Ø§Ù† Ø±ÙˆØ² Ø§Ù†ØªØ®Ø§Ø¨ Ú©Ù†ÛŒØ¯.">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <label className="block">
            <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">Ø§Ù†ØªØ®Ø§Ø¨ Ú©Ø§Ø±Ù…Ù†Ø¯</span>
            <select
              value={selectedEmployee}
              onChange={(event) => setSelectedEmployee(event.target.value)}
              className="min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#074747] focus:bg-white focus:ring-2 focus:ring-[#074747]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-500 dark:focus:bg-slate-900"
            >
              <option value="">Ú©Ø§Ø±Ù…Ù†Ø¯ Ø±Ø§ Ø§Ù†ØªØ®Ø§Ø¨ Ú©Ù†ÛŒØ¯</option>
              {attendanceRows.map((record) => (
                <option key={record.employee.id} value={record.employee.id}>
                  {record.employee.firstName} {record.employee.lastName}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <ErpButton label="Ø«Ø¨Øª ÙˆØ±ÙˆØ¯" onClick={handleCheckIn} disabled={actionLoading || !selectedEmployee} icon={FaSignInAlt} variant="solid" />
            <ErpButton label="Ø«Ø¨Øª Ø®Ø±ÙˆØ¬" onClick={handleCheckOut} disabled={actionLoading || !selectedEmployee} icon={FaSignOutAlt} tone="neutral" />
          </div>
        </div>
      </ErpSection>

      <ErpSection
        title="ÙˆØ±ÙˆØ¯ Ùˆ Ø®Ø±ÙˆØ¬ Ø±ÙˆØ²Ø§Ù†Ù‡"
        description={`Ú¯Ø²Ø§Ø±Ø´ Ø±ÙˆØ² ${PersianCalendar.formatForDisplay(selectedDate)}`}
        actions={[{ label: 'Ø¨Ù‡â€ŒØ±ÙˆØ²Ø±Ø³Ø§Ù†ÛŒ', onClick: fetchSecurityData, icon: FaClock, tone: 'neutral' }]}
      >
        <div className="mb-4 max-w-xs">
          <PersianCalendarComponent value={selectedDate} onChange={setSelectedDate} placeholder="ØªØ§Ø±ÛŒØ® Ú¯Ø²Ø§Ø±Ø´" />
        </div>

        {attendanceRows.length === 0 ? (
          <ErpEmptyState icon={FaClock} title="Ø±Ú©ÙˆØ±Ø¯ÛŒ Ø¨Ø±Ø§ÛŒ Ø§ÛŒÙ† Ø±ÙˆØ² Ø«Ø¨Øª Ù†Ø´Ø¯Ù‡ Ø§Ø³Øª" description="Ù¾Ø³ Ø§Ø² Ø«Ø¨Øª ÙˆØ±ÙˆØ¯ ÛŒØ§ Ø§Ù†ØªØ®Ø§Ø¨ ØªØ§Ø±ÛŒØ® Ø¯ÛŒÚ¯Ø±ØŒ Ù„ÛŒØ³Øª Ø§ÛŒÙ† Ø¨Ø®Ø´ Ø¨Ù‡â€ŒØ±ÙˆØ²Ø±Ø³Ø§Ù†ÛŒ Ù…ÛŒâ€ŒØ´ÙˆØ¯." />
        ) : (
          <>
            <div className="space-y-3 lg:hidden">
              {attendanceRows.map((record) => (
                <div key={record.employee.id} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/70">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">
                        {record.employee.firstName} {record.employee.lastName}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">@{record.employee.username}</p>
                    </div>
                    <ErpBadge tone={getStatusTone(record.status)}>{getStatusLabel(record.status)}</ErpBadge>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <dt className="text-xs text-slate-500 dark:text-slate-400">ÙˆØ±ÙˆØ¯</dt>
                      <dd className="font-medium text-slate-900 dark:text-white">{record.attendance?.entryTime || '-'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500 dark:text-slate-400">Ø®Ø±ÙˆØ¬</dt>
                      <dd className="font-medium text-slate-900 dark:text-white">{record.attendance?.exitTime || '-'}</dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{record.attendance?.notes || record.attendance?.exceptionType || 'Ø¨Ø¯ÙˆÙ† ØªÙˆØ¶ÛŒØ­'}</p>
                </div>
              ))}
            </div>

            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">Ú©Ø§Ø±Ù…Ù†Ø¯</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">ÙˆØ±ÙˆØ¯</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">Ø®Ø±ÙˆØ¬</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">ÙˆØ¶Ø¹ÛŒØª</th>
                    <th className="px-3 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">ØªÙˆØ¶ÛŒØ­Ø§Øª</th>
                  </tr>
                </thead>
                <tbody>
                  {attendanceRows.map((record) => (
                    <tr key={record.employee.id} className="border-b border-slate-100 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60">
                      <td className="px-3 py-4">
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {record.employee.firstName} {record.employee.lastName}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">@{record.employee.username}</div>
                      </td>
                      <td className="px-3 py-4 text-slate-800 dark:text-slate-100">{record.attendance?.entryTime || '-'}</td>
                      <td className="px-3 py-4 text-slate-800 dark:text-slate-100">{record.attendance?.exitTime || '-'}</td>
                      <td className="px-3 py-4"><ErpBadge tone={getStatusTone(record.status)}>{getStatusLabel(record.status)}</ErpBadge></td>
                      <td className="px-3 py-4 text-slate-500 dark:text-slate-400">{record.attendance?.notes || record.attendance?.exceptionType || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </ErpSection>

      {stats?.recentActivity?.length ? (
        <ErpSection title="ÙØ¹Ø§Ù„ÛŒØªâ€ŒÙ‡Ø§ÛŒ Ø§Ø®ÛŒØ±" description="Ø¢Ø®Ø±ÛŒÙ† Ø±Ø®Ø¯Ø§Ø¯Ù‡Ø§ÛŒ Ø«Ø¨Øªâ€ŒØ´Ø¯Ù‡ Ø¨Ø±Ø§ÛŒ Ø´ÛŒÙØª Ø¬Ø§Ø±ÛŒ">
          <div className="space-y-3">
            {stats.recentActivity.map((activity, index) => (
              <div key={`${activity.employeeId}-${index}`} className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/70 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#074747]/10 text-[#074747] dark:bg-teal-900/40 dark:text-teal-200">
                    <FaFingerprint className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {activity.entryTime && `ÙˆØ±ÙˆØ¯: ${activity.entryTime}`}
                      {activity.exitTime && `${activity.entryTime ? ' | ' : ''}Ø®Ø±ÙˆØ¬: ${activity.exitTime}`}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <ErpBadge tone={getStatusTone(activity.status)}>{getStatusLabel(activity.status)}</ErpBadge>
                      {activity.exceptionType && <ErpBadge tone="info">{activity.exceptionType}</ErpBadge>}
                    </div>
                  </div>
                </div>
                {!activity.digitalSignature && (
                  <ErpButton
                    label="Ø«Ø¨Øª Ø§Ù…Ø¶Ø§"
                    onClick={() => {
                      setSelectedRecord(activity);
                      setShowSignatureModal(true);
                    }}
                    icon={FaSignature}
                    tone="neutral"
                  />
                )}
              </div>
            ))}
          </div>
        </ErpSection>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ErpSection title="Ø¯Ø±Ø®ÙˆØ§Ø³Øªâ€ŒÙ‡Ø§ÛŒ Ø§Ø³ØªØ«Ù†Ø§" actions={[{ label: 'Ø¯Ø±Ø®ÙˆØ§Ø³Øª Ø¬Ø¯ÛŒØ¯', onClick: () => setShowExceptionForm(true), icon: FaExclamationTriangle, tone: 'warning' }]}>
          <div className="space-y-3">
            {exceptionRequests.length === 0 ? (
              <p className="text-center text-sm text-slate-500 dark:text-slate-400">Ø¯Ø±Ø®ÙˆØ§Ø³ØªÛŒ Ø«Ø¨Øª Ù†Ø´Ø¯Ù‡ Ø§Ø³Øª</p>
            ) : (
              exceptionRequests.map((request) => (
                <div key={request.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {request.employee.firstName} {request.employee.lastName}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{request.exceptionType} - {request.reason}</p>
                  </div>
                  {getRequestStatusBadge(request.status)}
                </div>
              ))
            )}
          </div>
        </ErpSection>

        <ErpSection title="Ù…Ø§Ù…ÙˆØ±ÛŒØªâ€ŒÙ‡Ø§" actions={[{ label: 'Ù…Ø§Ù…ÙˆØ±ÛŒØª Ø¬Ø¯ÛŒØ¯', onClick: () => setShowMissionForm(true), icon: FaPlane, tone: 'info' }]}>
          <div className="space-y-3">
            {missionAssignments.length === 0 ? (
              <p className="text-center text-sm text-slate-500 dark:text-slate-400">Ù…Ø§Ù…ÙˆØ±ÛŒØªÛŒ Ø«Ø¨Øª Ù†Ø´Ø¯Ù‡ Ø§Ø³Øª</p>
            ) : (
              missionAssignments.map((mission) => (
                <div key={mission.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {mission.employee.firstName} {mission.employee.lastName}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{mission.missionType} - {mission.missionLocation}</p>
                  </div>
                  {getRequestStatusBadge(mission.status)}
                </div>
              ))
            )}
          </div>
        </ErpSection>
      </div>

      {showExceptionForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg">
            <ExceptionRequestForm onSubmit={handleExceptionRequest} onCancel={() => setShowExceptionForm(false)} loading={actionLoading} />
          </div>
        </div>
      )}

      {showMissionForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg">
            <MissionAssignmentForm onSubmit={handleMissionAssignment} onCancel={() => setShowMissionForm(false)} loading={actionLoading} />
          </div>
        </div>
      )}

      {showSignatureModal && selectedRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md rounded-lg">
            <DigitalSignature
              onSave={handleSignatureSave}
              onCancel={() => {
                setShowSignatureModal(false);
                setSelectedRecord(null);
              }}
              width={400}
              height={200}
            />
          </div>
        </div>
      )}
    </ErpPage>
  );
}
