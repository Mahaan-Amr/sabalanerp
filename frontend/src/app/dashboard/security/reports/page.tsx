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
import { departmentsAPI, securityAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';
import PersianCalendarComponent from '@/components/PersianCalendar';

interface ReportData {
  attendance: {
    totalEmployeeDays: number;
    present: number;
    absent: number;
    late: number;
    mission: number;
    leave: number;
    signed: number;
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
    totalSessions: number;
    completedShifts: number;
    activeShifts: number;
    totalPersonnel: number;
    activePersonnel: number;
  };
  signatures: {
    signed: number;
    unsignedRecords: number;
  };
}

interface AttendanceTrend {
  date: string;
  present: number;
  absent: number;
  late: number;
  mission: number;
  leave: number;
  signed: number;
  total: number;
}

interface Department {
  id: string;
  namePersian: string;
}

interface Shift {
  id: string;
  namePersian: string;
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
  const [departmentId, setDepartmentId] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [exporting, setExporting] = useState<'pdf' | 'excel' | null>(null);

  useEffect(() => {
    fetchReportsData();
  }, [dateRange, reportType, departmentId, shiftId]);

  useEffect(() => {
    const loadFilters = async () => {
      try {
        const [departmentsResponse, shiftsResponse] = await Promise.all([
          departmentsAPI.getDepartments(),
          securityAPI.getShifts()
        ]);
        if (departmentsResponse.data.success) setDepartments(departmentsResponse.data.data || []);
        if (shiftsResponse.data.success) setShifts(shiftsResponse.data.data || []);
      } catch (error) {
        console.error('Error loading report filters:', error);
      }
    };
    loadFilters();
  }, []);

  const fetchReportsData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await securityAPI.getSecurityReportSummary({
        startDate: PersianCalendar.toGregorian(dateRange.startDate).toISOString(),
        endDate: PersianCalendar.toGregorian(dateRange.endDate).toISOString(),
        departmentId: departmentId || undefined,
        shiftId: shiftId || undefined,
        reportType
      });

      if (response.data.success) {
        setReportData(response.data.data);
        setAttendanceTrend(response.data.data.attendanceTrend || []);
      }
    } catch (error: any) {
      console.error('Error fetching reports data:', error);
      setError(error.response?.data?.error || 'خطا در دریافت اطلاعات');
    } finally {
      setLoading(false);
    }
  };

  const handleExportReport = async (format: 'pdf' | 'excel') => {
    try {
      setExporting(format);
      const response = await securityAPI.exportSecurityReport(format, {
        startDate: PersianCalendar.toGregorian(dateRange.startDate).toISOString(),
        endDate: PersianCalendar.toGregorian(dateRange.endDate).toISOString(),
        departmentId: departmentId || undefined,
        shiftId: shiftId || undefined,
        reportType
      });
      const url = URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = format === 'pdf' ? 'security-report.pdf' : 'security-report.xlsx';
      link.click();
      URL.revokeObjectURL(url);
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'دریافت خروجی گزارش ناموفق بود.');
    } finally {
      setExporting(null);
    }
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
          <h2 className="text-xl font-bold text-primary mb-2">ورود و خروج</h2>
          <p className="text-secondary mb-4">{error}</p>
          <button 
            onClick={fetchReportsData}
            className="glass-liquid-btn-primary px-6 py-2"
          >
            تلاش مجدد
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
              <h1 className="text-2xl font-bold text-primary">گزارش‌های حراست</h1>
              <p className="text-secondary">خلاصه حضور و غیاب، درخواست‌ها، ماموریت‌ها و امضاها</p>
            </div>
          </div>
          <div className="flex items-center space-x-4 space-x-reverse">
            <button
              onClick={() => handleExportReport('pdf')}
              className="glass-liquid-btn-primary px-4 py-2 flex items-center space-x-2 space-x-reverse"
            >
              <FaFilePdf />
              <span>{exporting === 'pdf' ? 'در حال آماده‌سازی…' : 'PDF'}</span>
            </button>
            <button
              onClick={() => handleExportReport('excel')}
              className="glass-liquid-btn px-4 py-2 flex items-center space-x-2 space-x-reverse"
            >
              <FaFileExcel />
              <span>{exporting === 'excel' ? 'در حال آماده‌سازی…' : 'Excel'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="glass-liquid-card p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div>
            <label className="block text-sm text-secondary mb-2">تاریخ شروع</label>
            <PersianCalendarComponent
              value={dateRange.startDate}
              onChange={(date) => setDateRange({ ...dateRange, startDate: date })}
              placeholder="تاریخ شروع"
            />
          </div>
          <div>
            <label className="block text-sm text-secondary mb-2">تاریخ پایان</label>
            <PersianCalendarComponent
              value={dateRange.endDate}
              onChange={(date) => setDateRange({ ...dateRange, endDate: date })}
              placeholder="تاریخ پایان"
            />
          </div>
          <div>
            <label className="block text-sm text-secondary mb-2">نوع گزارش</label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value as 'daily' | 'weekly' | 'monthly')}
              className="glass-liquid-input w-full"
            >
              <option value="daily">روزانه</option>
              <option value="weekly">هفتگی</option>
              <option value="monthly">ماهانه</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-secondary mb-2">بخش</label>
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className="glass-liquid-input w-full">
              <option value="">همه بخش‌ها</option>
              {departments.map((department) => <option key={department.id} value={department.id}>{department.namePersian}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-secondary mb-2">شیفت</label>
            <select value={shiftId} onChange={(e) => setShiftId(e.target.value)} className="glass-liquid-input w-full">
              <option value="">همه شیفت‌ها</option>
              {shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.namePersian}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={fetchReportsData}
              className="glass-liquid-btn-primary w-full px-4 py-2 flex items-center justify-center space-x-2 space-x-reverse"
            >
              <FaChartLine />
              <span>گزارش روزانه</span>
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
              <h3 className="text-lg font-bold text-primary">ورود و خروج</h3>
              <FaUsers className="h-6 w-6 text-blue-500" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-secondary">کل نفر-روز:</span>
                <span className="text-primary">{reportData.attendance.totalEmployeeDays}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary">حاضر:</span>
                <span className="text-green-500">{reportData.attendance.present}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary">غایب:</span>
                <span className="text-red-500">{reportData.attendance.absent}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary">نرخ حضور:</span>
                <span className="text-teal-500">{reportData.attendance.attendanceRate}%</span>
              </div>
            </div>
          </div>

          {/* Exceptions Summary */}
          <div className="glass-liquid-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-primary">درخواست‌ها</h3>
              <FaExclamationTriangle className="h-6 w-6 text-yellow-500" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-secondary">کل درخواست‌ها:</span>
                <span className="text-primary">{reportData.exceptions.totalRequests}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary">تایید شده:</span>
                <span className="text-green-500">{reportData.exceptions.approved}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary">رد شده:</span>
                <span className="text-red-500">{reportData.exceptions.rejected}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary">نرخ تایید:</span>
                <span className="text-teal-500">{reportData.exceptions.approvalRate}%</span>
              </div>
            </div>
          </div>

          {/* Missions Summary */}
          <div className="glass-liquid-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-primary">ماموریت‌ها</h3>
              <FaClock className="h-6 w-6 text-purple-500" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-secondary">کل درخواست‌ها:</span>
                <span className="text-primary">{reportData.missions.totalMissions}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary">تایید شده:</span>
                <span className="text-green-500">{reportData.missions.completed}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary">در انتظار:</span>
                <span className="text-yellow-500">{reportData.missions.pending}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary">نرخ تکمیل:</span>
                <span className="text-teal-500">{reportData.missions.completionRate}%</span>
              </div>
            </div>
          </div>

          {/* Shifts Summary */}
          <div className="glass-liquid-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-primary">شیفت و امضا</h3>
              <FaClock className="h-6 w-6 text-orange-500" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-secondary">جلسه شیفت:</span>
                <span className="text-primary">{reportData.shifts.totalSessions}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary">شیفت فعال:</span>
                <span className="text-green-500">{reportData.shifts.activeShifts}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary">امضا شده:</span>
                <span className="text-primary">{reportData.signatures.signed}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-secondary">نیروی فعال:</span>
                <span className="text-teal-500">{reportData.shifts.activePersonnel}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Attendance Trend Chart */}
      <div className="glass-liquid-card p-6">
        <h2 className="text-xl font-bold text-primary mb-4">جزئیات ورود و خروج</h2>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-right py-3 px-4 text-secondary">تاریخ</th>
                <th className="text-right py-3 px-4 text-secondary">حاضر</th>
                <th className="text-right py-3 px-4 text-secondary">غایب</th>
                <th className="text-right py-3 px-4 text-secondary">تاخیر</th>
                <th className="text-right py-3 px-4 text-secondary">ماموریت</th>
                <th className="text-right py-3 px-4 text-secondary">مرخصی</th>
              </tr>
            </thead>
            <tbody>
              {attendanceTrend.map((day, index) => {
                return (
                  <tr key={index} className="border-b border-gray-800 hover:bg-white/5">
                    <td className="py-3 px-4 text-primary">{new Date(day.date).toLocaleDateString('fa-IR')}</td>
                    <td className="py-3 px-4 text-green-500">{day.present}</td>
                    <td className="py-3 px-4 text-red-500">{day.absent}</td>
                    <td className="py-3 px-4 text-yellow-500">{day.late}</td>
                    <td className="py-3 px-4 text-primary">{day.mission}</td>
                    <td className="py-3 px-4 text-teal-500">{day.leave}</td>
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
            <h3 className="text-lg font-bold text-primary">خروجی اکسل</h3>
            <button
              onClick={() => handleExportReport('pdf')}
              className="glass-liquid-btn p-2"
            >
              <FaDownload />
            </button>
          </div>
          <p className="text-secondary text-sm">
            دریافت گزارش کامل حضور و غیاب به صورت فایل اکسل
          </p>
        </div>

        {/* Exception Report */}
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-primary">گزارش روزانه</h3>
            <button
              onClick={() => handleExportReport('excel')}
              className="glass-liquid-btn p-2"
            >
              <FaDownload />
            </button>
          </div>
          <p className="text-secondary text-sm">
            نمایش خلاصه حضور و غیاب روزانه
          </p>
        </div>
      </div>
    </div>
  );
}

