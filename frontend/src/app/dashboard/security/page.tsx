'use client';

import { useState, useEffect } from 'react';
import { 
  FaClock, 
  FaUserCheck, 
  FaUserTimes, 
  FaExclamationTriangle,
  FaSignInAlt,
  FaSignOutAlt,
  FaCalendarDay,
  FaShieldAlt,
  FaUsers,
  FaChartLine,
  FaSignature
} from 'react-icons/fa';
import { securityAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';
import PersianCalendarComponent from '@/components/PersianCalendar';
import ExceptionRequestForm from '@/components/ExceptionRequestForm';
import MissionAssignmentForm from '@/components/MissionAssignmentForm';
import DigitalSignature from '@/components/DigitalSignature';
import SignatureDisplay from '@/components/SignatureDisplay';
import MobileSecurityDashboard from '@/components/MobileSecurityDashboard';

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

export default function SecurityDashboardPage() {
  const [stats, setStats] = useState<SecurityStats | null>(null);
  const [dailyAttendance, setDailyAttendance] = useState<DailyAttendance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<string>('');
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>(PersianCalendar.now());
  const [showExceptionForm, setShowExceptionForm] = useState(false);
  const [showMissionForm, setShowMissionForm] = useState(false);
  const [exceptionRequests, setExceptionRequests] = useState<any[]>([]);
  const [missionAssignments, setMissionAssignments] = useState<any[]>([]);
  const [showSignatureModal, setShowSignatureModal] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    fetchSecurityData();
    checkMobileDevice();
  }, []);

  const checkMobileDevice = () => {
    const isMobileDevice = window.innerWidth < 768;
    setIsMobile(isMobileDevice);
    
    // Listen for resize events
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  };

  useEffect(() => {
    if (selectedDate) {
      fetchSecurityData();
    }
  }, [selectedDate]);

  const fetchSecurityData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [statsResponse, attendanceResponse] = await Promise.all([
        securityAPI.getDashboardStats(),
        securityAPI.getDailyAttendance(PersianCalendar.toGregorian(selectedDate).toISOString())
      ]);
      
      if (statsResponse.data.success) {
        setStats(statsResponse.data.data);
      }
      
      if (attendanceResponse.data.success) {
        setDailyAttendance(attendanceResponse.data.data);
      }
    } catch (error: any) {
      console.error('Error fetching security data:', error);
      setError(error.response?.data?.error || '?? ? ??? ? ??');
    } finally {
      setLoading(false);
    }
  };

  const handleCheckIn = async () => {
    if (!selectedEmployee) {
      alert('??? ??? ? ??? ??');
      return;
    }

    try {
      setActionLoading(true);
      const response = await securityAPI.checkIn(selectedEmployee);
      
      if (response.data.success) {
        alert('?? ??? ? ??? ?? ?');
        setSelectedEmployee('');
        fetchSecurityData(); // Refresh data
      }
    } catch (error: any) {
      console.error('Check-in error:', error);
      alert(error.response?.data?.error || '?? ? ?? ??');
    } finally {
      setActionLoading(false);
    }
  };

  const handleCheckOut = async () => {
    if (!selectedEmployee) {
      alert('??? ??? ? ??? ??');
      return;
    }

    try {
      setActionLoading(true);
      const response = await securityAPI.checkOut(selectedEmployee);
      
      if (response.data.success) {
        alert('?? ??? ? ??? ?? ?');
        setSelectedEmployee('');
        fetchSecurityData(); // Refresh data
      }
    } catch (error: any) {
      console.error('Check-out error:', error);
      alert(error.response?.data?.error || '?? ? ?? ??');
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PRESENT': return 'text-green-500 bg-green-500/20';
      case 'ABSENT': return 'text-red-500 bg-red-500/20';
      case 'LATE': return 'text-yellow-500 bg-yellow-500/20';
      case 'MISSION': return 'text-blue-500 bg-blue-500/20';
      case 'HOURLY_LEAVE': return 'text-purple-500 bg-purple-500/20';
      default: return 'text-gray-500 bg-gray-500/20';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'PRESENT': return '??';
      case 'ABSENT': return '??';
      case 'LATE': return '???';
      case 'MISSION': return '??';
      case 'HOURLY_LEAVE': return '??? ???';
      case 'SICK_LEAVE': return '??? ??';
      case 'VACATION': return '??? ??';
      default: return '???';
    }
  };

  const handleExceptionRequest = async (data: any) => {
    try {
      setActionLoading(true);
      await securityAPI.createExceptionRequest(data);
      alert('?? ??? ? ??? ??? ?!');
      setShowExceptionForm(false);
      fetchExceptionRequests();
    } catch (error: any) {
      alert(`?? ? ??? ??: ${error.response?.data?.error || error.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleMissionAssignment = async (data: any) => {
    try {
      setActionLoading(true);
      await securityAPI.createMissionAssignment(data);
      alert('?? ? ??? ??? ?!');
      setShowMissionForm(false);
      fetchMissionAssignments();
    } catch (error: any) {
      alert(`?? ? ??? ??: ${error.response?.data?.error || error.message}`);
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
      fetchSecurityData(); // Refresh data
    } catch (error: any) {
      console.error('Error saving signature:', error);
      alert(`?? ? ??? ??: ${error.response?.data?.error || error.message}`);
    }
  };

  const openSignatureModal = (record: any) => {
    setSelectedRecord(record);
    setShowSignatureModal(true);
  };

  const fetchExceptionRequests = async () => {
    try {
      const response = await securityAPI.getExceptionRequests({ limit: 5 });
      if (response.data.success) {
        setExceptionRequests(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching exception requests:', error);
    }
  };

  const fetchMissionAssignments = async () => {
    try {
      const response = await securityAPI.getMissionAssignments({ limit: 5 });
      if (response.data.success) {
        setMissionAssignments(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching mission assignments:', error);
    }
  };

  useEffect(() => {
    fetchExceptionRequests();
    fetchMissionAssignments();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="glass-liquid-card p-8 text-center">
          <FaExclamationTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-primary mb-2">?? ? ??</h2>
          <p className="text-secondary mb-4">{error}</p>
          <button 
            onClick={fetchSecurityData}
            className="glass-liquid-btn-primary px-6 py-2"
          >
            ?? ??
          </button>
        </div>
      </div>
    );
  }

  // Render mobile dashboard for mobile devices
  if (isMobile) {
    return <MobileSecurityDashboard />;
  }

  return (
    <div className="space-y-6">
        {/* Header */}
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4 space-x-reverse">
              <FaShieldAlt className="h-8 w-8 text-teal-500" />
              <div>
                <h1 className="text-2xl font-bold text-primary">?? ???</h1>
                <p className="text-secondary">
                  {stats?.securityPersonnel.name} - {stats?.securityPersonnel.position}
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-secondary">?? ??</div>
              <div className="text-lg font-bold text-primary">
                {stats?.currentShift.namePersian}
              </div>
              <div className="text-sm text-secondary">
                {stats?.currentShift.startTime} - {stats?.currentShift.endTime}
              </div>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="glass-liquid-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-secondary">? ??</p>
                <p className="text-2xl font-bold text-primary">
                  {stats?.todayStats.totalEmployees}
                </p>
              </div>
              <FaUsers className="h-8 w-8 text-blue-500" />
            </div>
          </div>

          <div className="glass-liquid-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-secondary">??</p>
                <p className="text-2xl font-bold text-green-500">
                  {stats?.todayStats.present}
                </p>
              </div>
              <FaUserCheck className="h-8 w-8 text-green-500" />
            </div>
          </div>

          <div className="glass-liquid-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-secondary">??</p>
                <p className="text-2xl font-bold text-red-500">
                  {stats?.todayStats.absent}
                </p>
              </div>
              <FaUserTimes className="h-8 w-8 text-red-500" />
            </div>
          </div>

          <div className="glass-liquid-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-secondary">??</p>
                <p className="text-2xl font-bold text-blue-500">
                  {stats?.todayStats.mission}
                </p>
              </div>
              <FaExclamationTriangle className="h-8 w-8 text-blue-500" />
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="glass-liquid-card p-6">
          <h2 className="text-xl font-bold text-primary mb-4">??? ??</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-secondary mb-2">??? ???</label>
              <select
                value={selectedEmployee}
                onChange={(e) => setSelectedEmployee(e.target.value)}
                className="glass-liquid-input w-full"
              >
                <option value="">??? ? ??? ??</option>
                {dailyAttendance?.attendanceSummary.map((record) => (
                  <option key={record.employee.id} value={record.employee.id}>
                    {record.employee.firstName} {record.employee.lastName}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex space-x-4 space-x-reverse">
              <button
                onClick={handleCheckIn}
                disabled={actionLoading || !selectedEmployee}
                className="glass-liquid-btn-primary flex-1 flex items-center justify-center space-x-2 space-x-reverse"
              >
                <FaSignInAlt />
                <span>??</span>
              </button>
              <button
                onClick={handleCheckOut}
                disabled={actionLoading || !selectedEmployee}
                className="glass-liquid-btn flex-1 flex items-center justify-center space-x-2 space-x-reverse"
              >
                <FaSignOutAlt />
                <span>??</span>
              </button>
            </div>
          </div>
        </div>

        {/* Daily Attendance Table */}
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-primary">?? ? ?? ???</h2>
            <div className="flex items-center space-x-4 space-x-reverse">
              <PersianCalendarComponent
                value={selectedDate}
                onChange={setSelectedDate}
                placeholder="??? ???"
                className="w-64"
              />
              <div className="flex items-center space-x-2 space-x-reverse text-sm text-secondary">
                <FaCalendarDay />
                <span>{PersianCalendar.formatForDisplay(selectedDate)}</span>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-right py-3 px-4 text-secondary">?? ???</th>
                  <th className="text-right py-3 px-4 text-secondary">?? ??</th>
                  <th className="text-right py-3 px-4 text-secondary">?? ??</th>
                  <th className="text-right py-3 px-4 text-secondary">???</th>
                  <th className="text-right py-3 px-4 text-secondary">??</th>
                </tr>
              </thead>
              <tbody>
                {dailyAttendance?.attendanceSummary.map((record) => (
                  <tr key={record.employee.id} className="border-b border-gray-800">
                    <td className="py-3 px-4">
                      <div>
                        <div className="font-medium text-primary">
                          {record.employee.firstName} {record.employee.lastName}
                        </div>
                        <div className="text-sm text-secondary">
                          @{record.employee.username}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-primary">
                      {record.attendance?.entryTime || '-'}
                    </td>
                    <td className="py-3 px-4 text-primary">
                      {record.attendance?.exitTime || '-'}
                    </td>
                    <td className="py-3 px-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(record.status)}`}>
                        {getStatusLabel(record.status)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-secondary text-sm">
                      {record.attendance?.notes || record.attendance?.exceptionType || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Activity */}
        {stats?.recentActivity && stats.recentActivity.length > 0 && (
          <div className="glass-liquid-card p-6">
            <h2 className="text-xl font-bold text-primary mb-4">??? ??</h2>
            <div className="space-y-3">
              {stats.recentActivity.map((activity, index) => (
                <div key={index} className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
                  <div className="flex items-center space-x-3 space-x-reverse">
                    <FaClock className="h-4 w-4 text-teal-500" />
                    <div>
                      <div className="text-sm text-primary">
                        {activity.entryTime && `??: ${activity.entryTime}`}
                        {activity.exitTime && ` | ??: ${activity.exitTime}`}
                      </div>
                      <div className="text-xs text-secondary">
                        ???: {getStatusLabel(activity.status)}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2 space-x-reverse">
                    {activity.exceptionType && (
                      <span className="text-xs text-blue-500 bg-blue-500/20 px-2 py-1 rounded">
                        {activity.exceptionType}
                      </span>
                    )}
                    
                    {/* Signature Display/Add Button */}
                    {activity.digitalSignature ? (
                      <SignatureDisplay
                        signatureData={activity.digitalSignature}
                        employeeName={`??? ${index + 1}`}
                        timestamp={activity.entryTime || activity.exitTime || undefined}
                      />
                    ) : (
                      <button
                        onClick={() => openSignatureModal(activity)}
                        className="text-teal-400 hover:text-teal-300 p-1"
                        title="?? ??"
                      >
                        <FaSignature className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Exception Management Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Exception Requests */}
          <div className="glass-liquid-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-primary">?? ???</h2>
              <button
                onClick={() => setShowExceptionForm(true)}
                className="glass-liquid-btn-primary px-4 py-2 text-sm"
              >
                ?? ??
              </button>
            </div>
            
            <div className="space-y-3">
              {exceptionRequests.length === 0 ? (
                <p className="text-secondary text-center py-4">?? ?? ?? ?? ???</p>
              ) : (
                exceptionRequests.map((request) => (
                  <div key={request.id} className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
                    <div>
                      <div className="text-sm text-primary">
                        {request.employee.firstName} {request.employee.lastName}
                      </div>
                      <div className="text-xs text-secondary">
                        {request.exceptionType} - {request.reason}
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs ${
                      request.status === 'PENDING' ? 'bg-yellow-500/20 text-yellow-500' :
                      request.status === 'APPROVED' ? 'bg-green-500/20 text-green-500' :
                      'bg-red-500/20 text-red-500'
                    }`}>
                      {request.status === 'PENDING' ? '? ???' :
                       request.status === 'APPROVED' ? '??? ??' : '? ??'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Mission Assignments */}
          <div className="glass-liquid-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-primary">???</h2>
              <button
                onClick={() => setShowMissionForm(true)}
                className="glass-liquid-btn-primary px-4 py-2 text-sm"
              >
                ??? ??
              </button>
            </div>
            
            <div className="space-y-3">
              {missionAssignments.length === 0 ? (
                <p className="text-secondary text-center py-4">?? ?? ??? ??</p>
              ) : (
                missionAssignments.map((mission) => (
                  <div key={mission.id} className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg">
                    <div>
                      <div className="text-sm text-primary">
                        {mission.employee.firstName} {mission.employee.lastName}
                      </div>
                      <div className="text-xs text-secondary">
                        {mission.missionType} - {mission.missionLocation}
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs ${
                      mission.status === 'PENDING' ? 'bg-yellow-500/20 text-yellow-500' :
                      mission.status === 'APPROVED' ? 'bg-green-500/20 text-green-500' :
                      'bg-red-500/20 text-red-500'
                    }`}>
                      {mission.status === 'PENDING' ? '? ???' :
                       mission.status === 'APPROVED' ? '??? ??' : '? ??'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Exception Request Form Modal */}
        {showExceptionForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <ExceptionRequestForm
                onSubmit={handleExceptionRequest}
                onCancel={() => setShowExceptionForm(false)}
                loading={actionLoading}
              />
            </div>
          </div>
        )}

        {/* Mission Assignment Form Modal */}
        {showMissionForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <MissionAssignmentForm
                onSubmit={handleMissionAssignment}
                onCancel={() => setShowMissionForm(false)}
                loading={actionLoading}
              />
            </div>
          </div>
        )}

        {/* Digital Signature Modal */}
        {showSignatureModal && selectedRecord && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="w-full max-w-md">
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
    </div>
  );
}


