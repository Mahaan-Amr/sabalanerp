'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { FaChartLine, FaClock, FaExclamationTriangle, FaFileExcel, FaFilePdf, FaHistory, FaRedo, FaShieldAlt, FaUsers } from 'react-icons/fa';
import EnhancedDropdown from '@/components/EnhancedDropdown';
import PersianCalendarComponent from '@/components/PersianCalendar';
import { ErpButton, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection, ErpSegmentedControl } from '@/components/erp';
import { departmentsAPI, securityAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';

type Scope = 'attendance' | 'performance';

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

export default function ReportsPage() {
  const [scope, setScope] = useState<Scope>('attendance');
  const [data, setData] = useState<any>(null);
  const [performance, setPerformance] = useState<any>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [personnel, setPersonnel] = useState<any[]>([]);
  const [range, setRange] = useState({ startDate: PersianCalendar.now(), endDate: PersianCalendar.now() });
  const [departmentId, setDepartmentId] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [personnelId, setPersonnelId] = useState('');
  const [sessionStatus, setSessionStatus] = useState('');
  const [coverageStatus, setCoverageStatus] = useState('');
  const [activityType, setActivityType] = useState('');
  const [latestShiftReport, setLatestShiftReport] = useState<{ authorized: boolean; available: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState<'attendance-pdf' | 'excel' | 'performance-pdf' | 'latest-shift-pdf' | null>(null);

  const baseParams = () => ({
    startDate: PersianCalendar.toGregorianDateOnly(range.startDate),
    endDate: PersianCalendar.toGregorianDateOnly(range.endDate),
    departmentId: departmentId || undefined,
    shiftId: shiftId || undefined
  });

  const performanceParams = () => ({
    ...baseParams(),
    personnelId: personnelId || undefined,
    sessionStatus: sessionStatus || undefined,
    coverageStatus: coverageStatus || undefined,
    activityType: activityType || undefined
  });

  const load = async () => {
    try {
      setLoading(true);
      setError('');
      if (scope === 'attendance') {
        const result = await securityAPI.getSecurityReportSummary(baseParams());
        setData(result.data.data);
      } else {
        const result = await securityAPI.getSecurityPersonnelPerformance(performanceParams());
        setPerformance(result.data.data);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'دریافت گزارش ناموفق بود.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [scope, range, departmentId, shiftId, personnelId, sessionStatus, coverageStatus, activityType]);

  useEffect(() => {
    Promise.all([departmentsAPI.getDepartments(), securityAPI.getShifts(), securityAPI.getOperationalPersonnel()])
      .then(([departmentResponse, shiftResponse, personnelResponse]) => {
        setDepartments(departmentResponse.data.data || []);
        setShifts(shiftResponse.data.data || []);
        setPersonnel(personnelResponse.data.data || []);
      })
      .catch(() => undefined);
  }, []);

  const loadLatestShiftStatus = async () => {
    try {
      const result = await securityAPI.getLatestCompletedShiftReportStatus();
      setLatestShiftReport({ authorized: true, available: Boolean(result.data.data?.available) });
    } catch (err: any) {
      if (err.response?.status === 403) setLatestShiftReport({ authorized: false, available: false });
    }
  };

  useEffect(() => {
    void loadLatestShiftStatus();
  }, []);

  const preset = (days: number) => {
    const end = new Date();
    setRange({
      startDate: PersianCalendar.toPersian(new Date(end.getTime() - (days - 1) * 86400000)),
      endDate: PersianCalendar.toPersian(end)
    });
  };

  const exportAttendance = async (format: 'pdf' | 'excel') => {
    try {
      setExporting(format === 'pdf' ? 'attendance-pdf' : 'excel');
      const result = await securityAPI.exportSecurityReport(format, baseParams());
      downloadBlob(result.data, `security-attendance-report.${format === 'pdf' ? 'pdf' : 'xlsx'}`);
    } catch (err: any) {
      setError(err.response?.data?.error || 'ساخت خروجی ناموفق بود.');
    } finally {
      setExporting(null);
    }
  };

  const exportPerformancePdf = async () => {
    try {
      setExporting('performance-pdf');
      const result = await securityAPI.downloadSecurityPersonnelPerformancePdf(performanceParams());
      downloadBlob(result.data, 'security-personnel-performance.pdf');
    } catch (err: any) {
      setError(err.response?.data?.error || 'ساخت PDF عملکرد نیروهای حراست ناموفق بود.');
    } finally {
      setExporting(null);
    }
  };

  const exportLatestShiftPdf = async () => {
    try {
      setExporting('latest-shift-pdf');
      const result = await securityAPI.downloadLatestCompletedShiftPdf();
      downloadBlob(result.data, 'security-latest-completed-shift.pdf');
    } catch (err: any) {
      setError(err.response?.data?.error || 'ساخت PDF شیفت قبل ناموفق بود.');
    } finally {
      setExporting(null);
    }
  };

  const attendance = data?.attendance || {};
  const trend = data?.attendanceTrend || [];
  const summaries = performance?.summaries || [];

  const metrics = scope === 'attendance'
    ? [
        { label: 'نرخ حضور', value: `${attendance.attendanceRate || 0}%`, icon: FaUsers, tone: 'success' as const },
        { label: 'غیبت', value: attendance.absent || 0, icon: FaExclamationTriangle, tone: 'danger' as const },
        { label: 'شیفت تکمیل‌شده', value: data?.shifts?.completedShifts || 0, icon: FaClock, tone: 'info' as const },
        { label: 'درخواست در انتظار', value: data?.exceptions?.pending || 0, icon: FaChartLine, tone: 'warning' as const },
      ]
    : [
        { label: 'نیروها', value: summaries.length, icon: FaUsers, tone: 'info' as const },
        { label: 'تکمیل‌شده', value: summaries.reduce((n: number, item: any) => n + item.completed, 0), icon: FaClock, tone: 'success' as const },
        { label: 'عدم حضور', value: summaries.reduce((n: number, item: any) => n + item.noShows, 0), icon: FaExclamationTriangle, tone: 'danger' as const },
        { label: 'گزارش‌ها', value: summaries.reduce((n: number, item: any) => n + item.logEntries, 0), icon: FaShieldAlt, tone: 'warning' as const },
      ];

  const actions = [
    { label: 'به‌روزرسانی', icon: FaRedo, tone: 'neutral' as const, onClick: () => { void load(); void loadLatestShiftStatus(); } },
    ...(latestShiftReport?.authorized ? [{
      label: exporting === 'latest-shift-pdf' ? 'در حال ساخت...' : 'گزارش‌های حراست شیفت قبل',
      icon: FaFilePdf,
      tone: 'info' as const,
      onClick: exportLatestShiftPdf,
      disabled: !!exporting || !latestShiftReport.available,
      title: latestShiftReport.available ? undefined : 'هنوز شیفت پایان‌یافته‌ای برای دریافت گزارش وجود ندارد'
    }] : []),
    ...(scope === 'attendance'
      ? [
          { label: exporting === 'attendance-pdf' ? 'در حال ساخت...' : 'PDF حضور و غیاب', icon: FaFilePdf, onClick: () => exportAttendance('pdf'), disabled: !!exporting },
          { label: exporting === 'excel' ? 'در حال ساخت...' : 'Excel', icon: FaFileExcel, tone: 'success' as const, onClick: () => exportAttendance('excel'), disabled: !!exporting },
        ]
      : [
          { label: exporting === 'performance-pdf' ? 'در حال ساخت...' : 'PDF عملکرد نیروها', icon: FaFilePdf, onClick: exportPerformancePdf, disabled: !!exporting },
        ])
  ];

  const departmentOptions = [{ value: '', label: 'همه بخش‌ها' }, ...departments.map((department) => ({ value: department.id, label: department.namePersian }))];
  const shiftOptions = [{ value: '', label: 'همه شیفت‌ها' }, ...shifts.map((shift) => ({ value: shift.id, label: shift.namePersian }))];
  const personnelOptions = [{ value: '', label: 'همه نیروها' }, ...personnel.map((item) => ({ value: item.id, label: `${item.user.firstName} ${item.user.lastName}` }))];
  const statusOptions = [
    { value: '', label: 'همه وضعیت‌ها' },
    { value: 'CLOSED', label: 'تکمیل‌شده' },
    { value: 'FORCE_CLOSED', label: 'بسته‌شده مدیر' },
    { value: 'ACTIVE', label: 'فعال' },
  ];
  const coverageOptions = [
    { value: '', label: 'همه پوشش‌ها' },
    { value: 'COVERED', label: 'کامل' },
    { value: 'NEEDS_REPLACEMENT', label: 'جایگزین' },
    { value: 'EMERGENCY_UNCOVERED', label: 'اضطراری' },
  ];

  if (loading) return <ErpLoading />;

  if (error) {
    return (
      <ErpPage eyebrow="حراست" title="گزارش‌های حراست">
        <ErpEmptyState title="گزارش در دسترس نیست" description={error} icon={FaExclamationTriangle} action={{ label: 'تلاش مجدد', icon: FaRedo, onClick: load }} />
      </ErpPage>
    );
  }

  return (
    <ErpPage eyebrow="حراست" title="گزارش‌های حراست" description="حضور کارکنان و عملکرد عملیاتی نیروهای حراست" metrics={metrics} actions={actions}>
      <ErpSegmentedControl value={scope} onChange={setScope} options={[
        { value: 'attendance', label: 'حضور و غیاب کارکنان', icon: FaUsers },
        { value: 'performance', label: 'عملکرد نیروهای حراست', icon: FaShieldAlt }
      ]} />

      <ErpSection title="فیلتر گزارش" description="فیلترها و بازه زمانی در گزارش و تاریخچه شیفت‌ها حفظ می‌شوند.">
        <div className="mb-3 flex flex-wrap gap-2">
          <ErpButton label="امروز" variant="soft" onClick={() => preset(1)} />
          <ErpButton label="۷ روز اخیر" variant="soft" onClick={() => preset(7)} />
          <ErpButton label="۳۰ روز اخیر" variant="soft" onClick={() => preset(30)} />
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label><span className="mb-2 block text-sm font-medium">از تاریخ</span><PersianCalendarComponent value={range.startDate} onChange={(startDate) => setRange((old) => ({ ...old, startDate }))} /></label>
          <label><span className="mb-2 block text-sm font-medium">تا تاریخ</span><PersianCalendarComponent value={range.endDate} onChange={(endDate) => setRange((old) => ({ ...old, endDate }))} /></label>
          {scope === 'attendance' ? (
            <>
              <EnhancedDropdown label="بخش" value={departmentId} onChange={setDepartmentId} options={departmentOptions} searchable clearable={false} />
              <EnhancedDropdown label="شیفت" value={shiftId} onChange={setShiftId} options={shiftOptions} searchable clearable={false} />
            </>
          ) : (
            <>
              <EnhancedDropdown label="نیروی حراست" value={personnelId} onChange={setPersonnelId} options={personnelOptions} searchable clearable={false} />
              <EnhancedDropdown label="وضعیت شیفت" value={sessionStatus} onChange={setSessionStatus} options={statusOptions} searchable clearable={false} />
              <EnhancedDropdown label="پوشش" value={coverageStatus} onChange={setCoverageStatus} options={coverageOptions} searchable clearable={false} />
            </>
          )}
        </div>
      </ErpSection>

      {scope === 'attendance' ? (
        <ErpSection title="روند روزانه">
          <ErpCard className="overflow-x-auto p-0">
            <table className="w-full min-w-[650px] text-right text-sm">
              <thead className="bg-slate-50"><tr>{['تاریخ','کل','حاضر','غایب','تأخیر','ماموریت','مرخصی'].map((heading) => <th key={heading} className="px-4 py-3">{heading}</th>)}</tr></thead>
              <tbody>{trend.map((item: any) => <tr key={item.date} className="border-t"><td className="px-4 py-3">{new Date(item.date).toLocaleDateString('fa-IR')}</td><td className="px-4 py-3">{item.total}</td><td className="px-4 py-3 text-emerald-600">{item.present}</td><td className="px-4 py-3 text-red-600">{item.absent}</td><td className="px-4 py-3 text-amber-600">{item.late}</td><td className="px-4 py-3">{item.mission}</td><td className="px-4 py-3">{item.leave}</td></tr>)}</tbody>
            </table>
          </ErpCard>
        </ErpSection>
      ) : (
        <ErpSection title="خلاصه عملکرد نیروها" description="با دکمه تاریخچه، جزئیات کامل شیفت‌های همان نیرو را ببینید. PDF این بخش فقط شیفت‌های پایان‌یافته را خروجی می‌گیرد.">
          <ErpCard className="overflow-x-auto p-0">
            <table className="w-full min-w-[980px] text-right text-sm">
              <thead className="bg-slate-50"><tr>{['نیرو','شیفت','برنامه','حضور','تأخیر','عدم حضور','تکمیل','بسته مدیر','گشت','گزارش',''].map((heading, index) => <th key={`${heading}-${index}`} className="px-4 py-3">{heading}</th>)}</tr></thead>
              <tbody>{summaries.map((item: any) => <tr key={item.id} className="border-t"><td className="px-4 py-3 font-semibold">{item.name}</td><td className="px-4 py-3">{item.shift}</td><td className="px-4 py-3">{item.plannedSlots}</td><td className="px-4 py-3">{item.attended}</td><td className="px-4 py-3 text-amber-600">{item.late}</td><td className="px-4 py-3 text-red-600">{item.noShows}</td><td className="px-4 py-3 text-emerald-600">{item.completed}</td><td className="px-4 py-3 text-red-600">{item.forceClosed}</td><td className="px-4 py-3">{item.patrols}</td><td className="px-4 py-3">{item.logEntries}</td><td className="px-4 py-3"><Link href={`/dashboard/security/reports/${item.id}?startDate=${encodeURIComponent(range.startDate)}&endDate=${encodeURIComponent(range.endDate)}`} className="inline-flex items-center gap-2 rounded-lg border border-[#074747]/30 px-3 py-2 text-xs font-semibold text-[#074747]"><FaHistory />تاریخچه شیفت‌ها</Link></td></tr>)}</tbody>
            </table>
          </ErpCard>
        </ErpSection>
      )}
    </ErpPage>
  );
}
