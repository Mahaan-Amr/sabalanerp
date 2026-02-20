'use client';

import { useState, useEffect } from 'react';
import { 
  FaCalendarAlt, 
  FaUserCheck, 
  FaUserTimes, 
  FaClock,
  FaSearch,
  FaFilter,
  FaDownload,
  FaSignature
} from 'react-icons/fa';
import { securityAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';
import PersianCalendarComponent from '@/components/PersianCalendar';

interface AttendanceRecord {
  id: string;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    username: string;
    department?: {
      name: string;
      namePersian: string;
    };
  };
  entryTime: string | null;
  exitTime: string | null;
  status: string;
  exceptionType: string | null;
  notes: string | null;
  digitalSignature: string | null;
  createdAt: string;
}

interface AttendanceStats {
  totalEmployees: number;
  present: number;
  absent: number;
  late: number;
  mission: number;
  leave: number;
}

export default function AttendancePage() {
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [stats, setStats] = useState<AttendanceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(PersianCalendar.now());
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  useEffect(() => {
    fetchAttendanceData();
  }, [selectedDate]);

  const fetchAttendanceData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [attendanceResponse, statsResponse] = await Promise.all([
        securityAPI.getDailyAttendance(PersianCalendar.toGregorian(selectedDate).toISOString()),
        securityAPI.getDashboardStats()
      ]);
      
      if (attendanceResponse.data.success) {
        setAttendanceRecords(attendanceResponse.data.data.attendanceSummary || []);
      }
      
      if (statsResponse.data.success) {
        setStats(statsResponse.data.data.todayStats);
      }
    } catch (error: any) {
      console.error('Error fetching attendance data:', error);
      setError(error.response?.data?.error || '?? ? ??? ? ??');
    } finally {
      setLoading(false);
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

  const filteredRecords = attendanceRecords.filter(record => {
    const matchesSearch = record.employee.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         record.employee.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         record.employee.username.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'ALL' || record.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

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
          <h2 className="text-xl font-bold text-primary mb-2">?? ? ??</h2>
          <p className="text-secondary mb-4">{error}</p>
          <button 
            onClick={fetchAttendanceData}
            className="glass-liquid-btn-primary px-6 py-2"
          >
            ?? ??
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-liquid-card p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4 space-x-reverse">
            <FaCalendarAlt className="h-8 w-8 text-teal-500" />
            <div>
              <h1 className="text-2xl font-bold text-primary">?? ? ??</h1>
              <p className="text-secondary">??? ?? ? ?? ??</p>
            </div>
          </div>
          <div className="flex items-center space-x-4 space-x-reverse">
            <PersianCalendarComponent
              value={selectedDate}
              onChange={setSelectedDate}
              placeholder="??? ???"
              className="w-64"
            />
            <button className="glass-liquid-btn-primary px-4 py-2 flex items-center space-x-2 space-x-reverse">
              <FaDownload />
              <span>???</span>
            </button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
          <div className="glass-liquid-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-secondary">? ??</p>
                <p className="text-xl font-bold text-primary">{stats.totalEmployees}</p>
              </div>
              <FaUserCheck className="h-6 w-6 text-blue-500" />
            </div>
          </div>
          <div className="glass-liquid-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-secondary">??</p>
                <p className="text-xl font-bold text-green-500">{stats.present}</p>
              </div>
              <FaUserCheck className="h-6 w-6 text-green-500" />
            </div>
          </div>
          <div className="glass-liquid-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-secondary">??</p>
                <p className="text-xl font-bold text-red-500">{stats.absent}</p>
              </div>
              <FaUserTimes className="h-6 w-6 text-red-500" />
            </div>
          </div>
          <div className="glass-liquid-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-secondary">???</p>
                <p className="text-xl font-bold text-yellow-500">{stats.late}</p>
              </div>
              <FaClock className="h-6 w-6 text-yellow-500" />
            </div>
          </div>
          <div className="glass-liquid-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-secondary">??</p>
                <p className="text-xl font-bold text-blue-500">{stats.mission}</p>
              </div>
              <FaClock className="h-6 w-6 text-blue-500" />
            </div>
          </div>
          <div className="glass-liquid-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-secondary">???</p>
                <p className="text-xl font-bold text-purple-500">{stats.leave}</p>
              </div>
              <FaClock className="h-6 w-6 text-purple-500" />
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="glass-liquid-card p-6">
        <div className="flex items-center space-x-4 space-x-reverse">
          <div className="flex-1">
            <div className="relative">
              <FaSearch className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="??? ? ?? ??..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="glass-liquid-input w-full pr-10"
              />
            </div>
          </div>
          <div className="flex items-center space-x-2 space-x-reverse">
            <FaFilter className="text-gray-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="glass-liquid-input"
            >
              <option value="ALL">?? ??</option>
              <option value="PRESENT">??</option>
              <option value="ABSENT">??</option>
              <option value="LATE">???</option>
              <option value="MISSION">??</option>
              <option value="HOURLY_LEAVE">??? ???</option>
            </select>
          </div>
        </div>
      </div>

      {/* Attendance Table */}
      <div className="glass-liquid-card p-6">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-right py-3 px-4 text-secondary">?? ???</th>
                <th className="text-right py-3 px-4 text-secondary">??</th>
                <th className="text-right py-3 px-4 text-secondary">?? ??</th>
                <th className="text-right py-3 px-4 text-secondary">?? ??</th>
                <th className="text-right py-3 px-4 text-secondary">???</th>
                <th className="text-right py-3 px-4 text-secondary">??</th>
                <th className="text-right py-3 px-4 text-secondary">??</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map((record) => (
                <tr key={record.id} className="border-b border-gray-800 hover:bg-white/5">
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
                  <td className="py-3 px-4 text-secondary">
                    {record.employee.department?.namePersian || '-'}
                  </td>
                  <td className="py-3 px-4 text-primary">
                    {record.entryTime ? new Date(record.entryTime).toLocaleTimeString('fa-IR') : '-'}
                  </td>
                  <td className="py-3 px-4 text-primary">
                    {record.exitTime ? new Date(record.exitTime).toLocaleTimeString('fa-IR') : '-'}
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(record.status)}`}>
                      {getStatusLabel(record.status)}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-secondary text-sm">
                    {record.notes || record.exceptionType || '-'}
                  </td>
                  <td className="py-3 px-4">
                    {record.digitalSignature ? (
                      <FaSignature className="h-4 w-4 text-green-500" />
                    ) : (
                      <span className="text-gray-400">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {filteredRecords.length === 0 && (
          <div className="text-center py-8">
            <p className="text-secondary">?? ??? ?? ? ??? ?? ??</p>
          </div>
        )}
      </div>
    </div>
  );
}

