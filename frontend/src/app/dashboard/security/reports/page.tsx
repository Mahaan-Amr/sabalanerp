'use client';

import { useState, useEffect } from 'react';
import { 
  FaChartLine, 
  FaDownload, 
  FaCalendarAlt,
  FaUsers,
  FaClock,
  FaExclamationTriangle,
  FaFilePdf,
  FaFileExcel
} from 'react-icons/fa';
import { securityAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';
import PersianCalendarComponent from '@/components/PersianCalendar';

interface ReportData {
  attendance: {
    totalEmployees: number;
    present: number;
    absent: number;
    late: number;
    mission: number;
    leave: number;
    attendanceRate: number;
  };
  exceptions: {
    totalRequests: number;
    approved: number;
    rejected: number;
    pending: number;
    approvalRate: number;
  };
  missions: {
    totalMissions: number;
    completed: number;
    pending: number;
    completionRate: number;
  };
  shifts: {
    totalShifts: number;
    activeShifts: number;
    totalPersonnel: number;
    activePersonnel: number;
  };
}

interface AttendanceTrend {
  date: string;
  present: number;
  absent: number;
  late: number;
  total: number;
}

export default function ReportsPage() {
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [attendanceTrend, setAttendanceTrend] = useState<AttendanceTrend[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState({
    startDate: PersianCalendar.now(),
    endDate: PersianCalendar.now()
  });
  const [reportType, setReportType] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  useEffect(() => {
    fetchReportsData();
  }, [dateRange, reportType]);

  const fetchReportsData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // This would need new API endpoints for reports
      // For now, we'll simulate the data structure
      const mockData: ReportData = {
        attendance: {
          totalEmployees: 45,
          present: 38,
          absent: 4,
          late: 2,
          mission: 1,
          leave: 0,
          attendanceRate: 84.4
        },
        exceptions: {
          totalRequests: 12,
          approved: 8,
          rejected: 2,
          pending: 2,
          approvalRate: 80.0
        },
        missions: {
          totalMissions: 5,
          completed: 4,
          pending: 1,
          completionRate: 80.0
        },
        shifts: {
          totalShifts: 2,
          activeShifts: 1,
          totalPersonnel: 8,
          activePersonnel: 6
        }
      };

      const mockTrend: AttendanceTrend[] = [
        { date: '1403/07/01', present: 40, absent: 3, late: 2, total: 45 },
        { date: '1403/07/02', present: 38, absent: 5, late: 2, total: 45 },
        { date: '1403/07/03', present: 42, absent: 2, late: 1, total: 45 },
        { date: '1403/07/04', present: 39, absent: 4, late: 2, total: 45 },
        { date: '1403/07/05', present: 41, absent: 3, late: 1, total: 45 },
        { date: '1403/07/06', present: 37, absent: 6, late: 2, total: 45 },
        { date: '1403/07/07', present: 40, absent: 3, late: 2, total: 45 }
      ];

      setReportData(mockData);
      setAttendanceTrend(mockTrend);
    } catch (error: any) {
      console.error('Error fetching reports data:', error);
      setError(error.response?.data?.error || '?? ? ??? ? ??');
    } finally {
      setLoading(false);
    }
  };

  const handleExportReport = (format: 'pdf' | 'excel') => {
    // This would trigger the actual export functionality
    alert(`??? ${format.toUpperCase()} ? ?? ??? ??...`);
  };

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
            onClick={fetchReportsData}
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
            <FaChartLine className="h-8 w-8 text-teal-500" />
            <div>
              <h1 className="text-2xl font-bold text-primary">?? ???</h1>
              <p className="text-secondary">?? ?? ??? ??? ? ?? ? ??</p>
            </div>
          </div>
          <div className="flex items-center space-x-4 space-x-reverse">
            <button
              onClick={() => handleExportReport('pdf')}
              className="glass-liquid-btn-primary px-4 py-2 flex items-center space-x-2 space-x-reverse"
            >
              <FaFilePdf />
              <span>PDF</span>
            </button>
            <button
              onClick={() => handleExportReport('excel')}
              className="glass-liquid-btn px-4 py-2 flex items-center space-x-2 space-x-reverse"
            >
              <FaFileExcel />
              <span>Excel</span>
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="glass-liquid-card p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm text-secondary mb-2">??? ??</label>
            <PersianCalendarComponent
              value={dateRange.startDate}
              onChange={(date) => setDateRange({ ...dateRange, startDate: date })}
              placeholder="??? ??? ??"
            />
          </div>
          <div>
            <label className="block text-sm text-secondary mb-2">??? ???</label>
            <PersianCalendarComponent
              value={dateRange.endDate}
              onChange={(date) => setDateRange({ ...dateRange, endDate: date })}
              placeholder="??? ??? ???"
            />
          </div>
          <div>
            <label className="block text-sm text-secondary mb-2">?? ???</label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value as 'daily' | 'weekly' | 'monthly')}
              className="glass-liquid-input w-full"
            >
              <option value="daily">???</option>
              <option value="weekly">???</option>
              <option value="monthly">???</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={fetchReportsData}
              className="glass-liquid-btn-primary w-full px-4 py-2 flex items-center justify-center space-x-2 space-x-reverse"
            >
              <FaChartLine />
              <span>??? ???</span>
            </button>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      {reportData && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Attendance Summary */}
          <div className="glass-liquid-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-primary">?? ? ??</h3>
              <FaUsers className="h-6 w-6 text-blue-500" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-secondary">? ??:</span>
                <span className="text-primary">{reportData.attendance.totalEmployees}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary">??:</span>
                <span className="text-green-500">{reportData.attendance.present}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary">??:</span>
                <span className="text-red-500">{reportData.attendance.absent}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary">?? ??:</span>
                <span className="text-teal-500">{reportData.attendance.attendanceRate}%</span>
              </div>
            </div>
          </div>

          {/* Exceptions Summary */}
          <div className="glass-liquid-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-primary">???</h3>
              <FaExclamationTriangle className="h-6 w-6 text-yellow-500" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-secondary">? ???:</span>
                <span className="text-primary">{reportData.exceptions.totalRequests}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary">??? ??:</span>
                <span className="text-green-500">{reportData.exceptions.approved}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary">? ??:</span>
                <span className="text-red-500">{reportData.exceptions.rejected}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary">?? ???:</span>
                <span className="text-teal-500">{reportData.exceptions.approvalRate}%</span>
              </div>
            </div>
          </div>

          {/* Missions Summary */}
          <div className="glass-liquid-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-primary">???</h3>
              <FaClock className="h-6 w-6 text-purple-500" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-secondary">? ???:</span>
                <span className="text-primary">{reportData.missions.totalMissions}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary">??? ??:</span>
                <span className="text-green-500">{reportData.missions.completed}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary">? ???:</span>
                <span className="text-yellow-500">{reportData.missions.pending}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary">?? ???:</span>
                <span className="text-teal-500">{reportData.missions.completionRate}%</span>
              </div>
            </div>
          </div>

          {/* Shifts Summary */}
          <div className="glass-liquid-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-primary">??</h3>
              <FaClock className="h-6 w-6 text-orange-500" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-secondary">? ??:</span>
                <span className="text-primary">{reportData.shifts.totalShifts}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary">??:</span>
                <span className="text-green-500">{reportData.shifts.activeShifts}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary">? ???:</span>
                <span className="text-primary">{reportData.shifts.totalPersonnel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary">??? ??:</span>
                <span className="text-teal-500">{reportData.shifts.activePersonnel}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Attendance Trend Chart */}
      <div className="glass-liquid-card p-6">
        <h2 className="text-xl font-bold text-primary mb-4">?? ?? ? ??</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-right py-3 px-4 text-secondary">???</th>
                <th className="text-right py-3 px-4 text-secondary">??</th>
                <th className="text-right py-3 px-4 text-secondary">??</th>
                <th className="text-right py-3 px-4 text-secondary">???</th>
                <th className="text-right py-3 px-4 text-secondary">?</th>
                <th className="text-right py-3 px-4 text-secondary">?? ??</th>
              </tr>
            </thead>
            <tbody>
              {attendanceTrend.map((day, index) => {
                const attendanceRate = ((day.present / day.total) * 100).toFixed(1);
                return (
                  <tr key={index} className="border-b border-gray-800 hover:bg-white/5">
                    <td className="py-3 px-4 text-primary">{day.date}</td>
                    <td className="py-3 px-4 text-green-500">{day.present}</td>
                    <td className="py-3 px-4 text-red-500">{day.absent}</td>
                    <td className="py-3 px-4 text-yellow-500">{day.late}</td>
                    <td className="py-3 px-4 text-primary">{day.total}</td>
                    <td className="py-3 px-4 text-teal-500">{attendanceRate}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detailed Reports */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Attendance Report */}
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-primary">??? ??? ??</h3>
            <button
              onClick={() => handleExportReport('pdf')}
              className="glass-liquid-btn p-2"
            >
              <FaDownload />
            </button>
          </div>
          <p className="text-secondary text-sm">
            ??? ??? ?? ? ?? ?? ? ?? ??? ??
          </p>
        </div>

        {/* Exception Report */}
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-primary">??? ???</h3>
            <button
              onClick={() => handleExportReport('excel')}
              className="glass-liquid-btn p-2"
            >
              <FaDownload />
            </button>
          </div>
          <p className="text-secondary text-sm">
            ??? ?? ??? ? ??? ??? ??
          </p>
        </div>
      </div>
    </div>
  );
}

