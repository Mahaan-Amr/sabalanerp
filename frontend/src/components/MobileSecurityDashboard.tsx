'use client';

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
        setError('?? ? ??? ?? ?? ? ??');
      }
    } catch (err: any) {
      console.error('Error fetching attendance records:', err);
      setError(err.response?.data?.error || '?? ? ??? ? ??');
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
      alert(`?? ? ??? ??: ${error.response?.data?.error || error.message}`);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'PRESENT': return <FaUserCheck className="text-green-500" />;
      case 'ABSENT': return <FaUserTimes className="text-red-500" />;
      case 'LATE': return <FaClock className="text-yellow-500" />;
      case 'MISSION': return <FaExclamationTriangle className="text-blue-500" />;
      default: return <FaClock className="text-gray-500" />;
    }
  };

  const getStatusLabel = (status: string) => {
    const statusLabels: { [key: string]: string } = {
      PRESENT: '??',
      ABSENT: '??',
      LATE: '???',
      MISSION: '??',
      HOURLY_LEAVE: '??? ???',
      SICK_LEAVE: '??? ??',
      VACATION: '??? ??'
    };
    return statusLabels[status] || status;
  };

  const getBatteryIcon = () => {
    if (batteryLevel === null) return <FaBatteryFull className="text-gray-400" />;
    if (batteryLevel > 60) return <FaBatteryFull className="text-green-500" />;
    if (batteryLevel > 30) return <FaBatteryHalf className="text-yellow-500" />;
    return <FaBatteryEmpty className="text-red-500" />;
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-teal-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center text-red-500 text-lg p-4">
        <p>{error}</p>
        <button onClick={fetchAttendanceRecords} className="glass-liquid-btn mt-4">
          ?? ??
        </button>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 ${className}`}>
      {/* Mobile Header */}
      <div className="glass-liquid-card mx-2 mt-2 p-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-2 space-x-reverse">
            <FaMobile className="h-6 w-6 text-teal-400" />
            <h1 className="text-lg font-bold text-primary">??? ???</h1>
          </div>
          
          <div className="flex items-center space-x-3 space-x-reverse">
            {/* Connection Status */}
            {isOnline ? (
              <FaWifi className="h-4 w-4 text-green-500" title="???" />
            ) : (
              <FaExclamationTriangle className="h-4 w-4 text-red-500" title="???" />
            )}
            
            {/* Battery Level */}
            <div className="flex items-center space-x-1 space-x-reverse">
              {getBatteryIcon()}
              {batteryLevel !== null && (
                <span className="text-xs text-gray-400">{batteryLevel}%</span>
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
        <button
          onClick={() => {
            // Quick check-in action
            const record = attendanceRecords.find(r => !r.entryTime);
            if (record) {
              setSelectedRecord(record);
              setShowSignatureModal(true);
            } else {
              alert('?? ?? ??? ?? ?? ? ?? ??');
            }
          }}
          className="glass-liquid-btn-primary p-4 text-center"
        >
          <FaUserCheck className="h-6 w-6 mx-auto mb-2" />
          <span className="text-sm">?? ??</span>
        </button>
        
        <button
          onClick={() => {
            // Quick check-out action
            const record = attendanceRecords.find(r => r.entryTime && !r.exitTime);
            if (record) {
              setSelectedRecord(record);
              setShowSignatureModal(true);
            } else {
              alert('?? ?? ?? ?? ??? ??');
            }
          }}
          className="glass-liquid-btn p-4 text-center"
        >
          <FaUserTimes className="h-6 w-6 mx-auto mb-2" />
          <span className="text-sm">?? ??</span>
        </button>
      </div>

      {/* Attendance Records */}
      <div className="mx-2 mt-4">
        <h2 className="text-lg font-bold text-primary mb-3">?? ? ?? ???</h2>
        
        <div className="space-y-2">
          {attendanceRecords.length === 0 ? (
            <div className="glass-liquid-card p-6 text-center">
              <p className="text-secondary">?? ??? ?? ? ??? ?? ??? ?? ???</p>
            </div>
          ) : (
            attendanceRecords.map((record) => (
              <div key={record.id} className="glass-liquid-card p-4">
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
                      <button
                        onClick={() => {
                          setSelectedRecord(record);
                          setShowSignatureModal(true);
                        }}
                        className="text-teal-400 hover:text-teal-300 p-2"
                        title="?? ??"
                      >
                        <FaSignature className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
                
                <div className="mt-2 text-xs text-gray-400">
                  {record.entryTime && `??: ${record.entryTime}`}
                  {record.exitTime && ` | ??: ${record.exitTime}`}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Signature Modal */}
      {showSignatureModal && selectedRecord && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
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
        <div className="fixed bottom-4 left-4 right-4 glass-liquid-card p-3 bg-yellow-500/20 border border-yellow-500/50">
          <div className="flex items-center space-x-2 space-x-reverse">
            <FaExclamationTriangle className="h-4 w-4 text-yellow-500" />
            <span className="text-sm text-yellow-500">
              ?? ??? - ?? ? ?? ??? ?? ??? ??? ?
            </span>
          </div>
        </div>
      )}
    </div>
  );
}


