'use client';
import { ErpPressable } from '@/components/erp';
import { useState, useEffect } from 'react';
import {
  FaUserCheck,
  FaUserTimes,
  FaClock,
  FaExclamationTriangle,
  FaSignature,
  FaMobile,
  FaWifi,  FaBatteryFull,
  FaBatteryHalf,
  FaBatteryEmpty
} from 'react-icons/fa';
import { securityAPI } from '@/lib/api';
import { notifySecurity } from './SecurityNoticeHost';
import DigitalSignature from './DigitalSignature';
import SignatureDisplay from './SignatureDisplay';
import PersianCalendar from '@/lib/persian-calendar';

interface MobileSecurityDashboardProps {
  className?: string;
}

interface AttendanceRecord {
  id: string;
  employee: {
    firstName: string;
    lastName: string;
  };
  entryTime: string | null;
  exitTime: string | null;
  status: string;
  digitalSignature: string | null;
  createdAt: string;
}

export default function MobileSecurityDashboard({ className = '' }: MobileSecurityDashboardProps) {
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<AttendanceRecord | null>(null);
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);

  useEffect(() => {
    fetchAttendanceRecords();
    setupEventListeners();
  }, []);

  const setupEventListeners = () => {
    // Online/Offline status
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Battery API (if available)
    if ('getBattery' in navigator) {
      (navigator as any).getBattery().then((battery: any) => {
        setBatteryLevel(Math.round(battery.level * 100));
        battery.addEventListener('levelchange', () => {
          setBatteryLevel(Math.round(battery.level * 100));
        });
      });
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  };

  const fetchAttendanceRecords = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await securityAPI.getDailyAttendance();
      if (response.data.success) {
        setAttendanceRecords(response.data.data.records || []);
      } else {
        setError('خطا در دریافت اطلاعات شیفت');
      }
    } catch (err: any) {
      console.error('Error fetching attendance records:', err);
      setError(err.response?.data?.error || 'خطا در دریافت اطلاعات');
    } finally {
      setLoading(false);
    }
  };

  const handleSignatureSave = async (signatureData: string) => {
    if (!selectedRecord) return;

    try {
      await securityAPI.saveAttendanceSignature(selectedRecord.id, signatureData, 'CHECKIN');
      setShowSignatureModal(false);
      setSelectedRecord(null);
      fetchAttendanceRecords(); // Refresh data
    } catch (error: any) {
      console.error('Error saving signature:', error);
      notifySecurity(`خطا در ثبت عملیات: ${error.response?.data?.error || error.message}`, 'error');
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'PRESENT': return <FaUserCheck className="text-[var(--sds-success)]" />;
      case 'ABSENT': return <FaUserTimes className="text-[var(--sds-danger)]" />;
      case 'LATE': return <FaClock className="text-[var(--sds-warning)]" />;
      case 'MISSION': return <FaExclamationTriangle className="text-[var(--sds-info)]" />;
      default: return <FaClock className="text-[var(--sds-text-secondary)]" />;
    }
  };

  const getStatusLabel = (status: string) => {
    const statusLabels: { [key: string]: string } = {
      PRESENT: 'حاضر',
      ABSENT: 'غایب',
      LATE: 'تاخیر',
      MISSION: 'ماموریت',
      HOURLY_LEAVE: 'مرخصی ساعتی',
      SICK_LEAVE: 'مرخصی استعلاجی',
      VACATION: 'مرخصی روزانه'
    };
    return statusLabels[status] || status;
  };

  const getBatteryIcon = () => {
    if (batteryLevel === null) return <FaBatteryFull className="text-[var(--sds-text-muted)]" />;
    if (batteryLevel > 60) return <FaBatteryFull className="text-[var(--sds-success)]" />;
    if (batteryLevel > 30) return <FaBatteryHalf className="text-[var(--sds-warning)]" />;
    return <FaBatteryEmpty className="text-[var(--sds-danger)]" />;
  };

  if (loading) {
    return (
      <main className="sds-workspace flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-[var(--sds-border-strong)]"></div>
      </main>
    );
  }

  if (error) {
    return (
      <div className="text-center text-[var(--sds-danger)] text-lg p-4">
        <p>{error}</p>
        <ErpPressable type="submit" onClick={fetchAttendanceRecords} className="sds-action mt-4">
          تلاش مجدد
        </ErpPressable>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-gradient-to-br from-[var(--sds-surface-raised)] via-[var(--sds-surface-raised)] to-[var(--sds-surface-raised)] ${className}`}>
      {/* Mobile Header */}
      <div className="sds-workspace-surface mx-2 mt-2 p-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-2 space-x-reverse">
            <FaMobile className="h-6 w-6 text-[var(--sds-accent)]" />
            <h1 className="text-lg font-bold text-primary">گزارش روزانه</h1>
          </div>

          <div className="flex items-center space-x-3 space-x-reverse">
            {/* Connection Status */}
            {isOnline ? (
              <FaWifi className="h-4 w-4 text-[var(--sds-success)]" title="آنلاین" />
            ) : (
              <FaExclamationTriangle className="h-4 w-4 text-[var(--sds-danger)]" title="خطا" />
            )}

            {/* Battery Level */}
            <div className="flex items-center space-x-1 space-x-reverse">
              {getBatteryIcon()}
              {batteryLevel !== null && (
                <span className="text-xs text-[var(--sds-text-muted)]">{batteryLevel}%</span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-2 text-center">
          <span className="text-sm text-secondary">
            {PersianCalendar.formatForDisplay(PersianCalendar.now())}
          </span>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mx-2 mt-4 grid grid-cols-2 gap-3">
        <ErpPressable type="submit"
          onClick={() => {
            // Quick check-in action
            const record = attendanceRecords.find(r => !r.entryTime);
            if (record) {
              setSelectedRecord(record);
              setShowSignatureModal(true);
            } else {
              notifySecurity('رکوردی برای ثبت خروج انتخاب نشده است', 'error');
            }
          }}
          className="sds-action sds-tone-primary sds-action-solid p-4 text-center"
        >
          <FaUserCheck className="h-6 w-6 mx-auto mb-2" />
          <span className="text-sm">ثبت ورود</span>
        </ErpPressable>

        <ErpPressable type="submit"
          onClick={() => {
            // Quick check-out action
            const record = attendanceRecords.find(r => r.entryTime && !r.exitTime);
            if (record) {
              setSelectedRecord(record);
              setShowSignatureModal(true);
            } else {
              notifySecurity('رکوردی برای ثبت امضا انتخاب نشده است', 'error');
            }
          }}
          className="sds-action p-4 text-center"
        >
          <FaUserTimes className="h-6 w-6 mx-auto mb-2" />
          <span className="text-sm">ثبت خروج</span>
        </ErpPressable>
      </div>

      {/* Attendance Records */}
      <div className="mx-2 mt-4">
        <h2 className="text-lg font-bold text-primary mb-3">ورود و خروج امروز</h2>

        <div className="space-y-2">
          {attendanceRecords.length === 0 ? (
            <div className="sds-workspace-surface p-6 text-center">
              <p className="text-secondary">برای این تاریخ هیچ رکوردی ثبت نشده است</p>
            </div>
          ) : (
            attendanceRecords.map((record) => (
              <div key={record.id} className="sds-workspace-surface p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3 space-x-reverse">
                    {getStatusIcon(record.status)}
                    <div>
                      <div className="text-primary font-medium">
                        {record.employee.firstName} {record.employee.lastName}
                      </div>
                      <div className="text-sm text-secondary">
                        {getStatusLabel(record.status)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 space-x-reverse">
                    {record.digitalSignature ? (
                      <SignatureDisplay
                        signatureData={record.digitalSignature}
                        employeeName={`${record.employee.firstName} ${record.employee.lastName}`}
                        timestamp={PersianCalendar.formatForDisplay(record.createdAt)}
                      />
                    ) : (
                      <ErpPressable type="submit"
                        onClick={() => {
                          setSelectedRecord(record);
                          setShowSignatureModal(true);
                        }}
                        className="text-[var(--sds-accent)] hover:text-[var(--sds-accent)] p-2"
                        title="ثبت امضا"
                      >
                        <FaSignature className="h-4 w-4" />
                      </ErpPressable>
                    )}
                  </div>
                </div>

                <div className="mt-2 text-xs text-[var(--sds-text-muted)]">
                  {record.entryTime && `خروج: ${record.entryTime}`}
                  {record.exitTime && ` | خروج: ${record.exitTime}`}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Signature Modal */}
      {showSignatureModal && selectedRecord && (
        <div className="fixed inset-0 bg-[var(--sds-surface-overlay)] flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-md">
            <DigitalSignature
              onSave={handleSignatureSave}
              onCancel={() => {
                setShowSignatureModal(false);
                setSelectedRecord(null);
              }}
              width={350}
              height={150}
            />
          </div>
        </div>
      )}

      {/* Offline Notice */}
      {!isOnline && (
        <div className="fixed bottom-4 left-4 right-4 sds-workspace-surface p-3 bg-[var(--sds-warning-surface)] border border-[var(--sds-warning-border)]">
          <div className="flex items-center space-x-2 space-x-reverse">
            <FaExclamationTriangle className="h-4 w-4 text-[var(--sds-warning)]" />
            <span className="text-sm text-[var(--sds-warning)]">
              نسخه موبایل - ورود و خروج سریع گارد
            </span>
          </div>
        </div>
      )}
    </div>
  );
}


