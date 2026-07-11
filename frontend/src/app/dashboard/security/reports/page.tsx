'use client';

import { useEffect, useState } from 'react';
import { FaChartLine, FaClock, FaExclamationTriangle, FaFileExcel, FaFilePdf, FaRedo, FaUsers } from 'react-icons/fa';
import { departmentsAPI, securityAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';
import PersianCalendarComponent from '@/components/PersianCalendar';
import { ErpButton, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection } from '@/components/erp';

type ReportData = any;

const inputClass = 'min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#074747] focus:bg-white focus:ring-2 focus:ring-[#074747]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white';

export default function ReportsPage() {
  const [data, setData] = useState<ReportData | null>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [dateRange, setDateRange] = useState({ startDate: PersianCalendar.now(), endDate: PersianCalendar.now() });
  const [reportType, setReportType] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [departmentId, setDepartmentId] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState<'pdf' | 'excel' | null>(null);

  const params = () => ({ startDate: PersianCalendar.toGregorian(dateRange.startDate).toISOString(), endDate: PersianCalendar.toGregorian(dateRange.endDate).toISOString(), reportType, departmentId: departmentId || undefined, shiftId: shiftId || undefined });
  const load = async () => {
    try { setLoading(true); setError(''); const result = await securityAPI.getSecurityReportSummary(params()); setData(result.data.data); }
    catch (err: any) { setError(err.response?.data?.error || 'دریافت گزارش‌های حراست ناموفق بود.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [dateRange, reportType, departmentId, shiftId]);
  useEffect(() => { Promise.all([departmentsAPI.getDepartments(), securityAPI.getShifts()]).then(([d, s]) => { setDepartments(d.data.data || []); setShifts(s.data.data || []); }).catch(() => undefined); }, []);
  const exportReport = async (format: 'pdf' | 'excel') => {
    try { setExporting(format); const result = await securityAPI.exportSecurityReport(format, params()); const url = URL.createObjectURL(new Blob([result.data])); const a = document.createElement('a'); a.href = url; a.download = format === 'pdf' ? 'security-report.pdf' : 'security-report.xlsx'; a.click(); URL.revokeObjectURL(url); }
    catch (err: any) { setError(err.response?.data?.error || 'دریافت خروجی ناموفق بود.'); }
    finally { setExporting(null); }
  };
  if (loading) return <ErpLoading />;
  if (error) return <ErpPage eyebrow="حراست" title="گزارش‌های حراست"><ErpEmptyState title="گزارش در دسترس نیست" description={error} icon={FaExclamationTriangle} action={{ label: 'تلاش مجدد', onClick: load, icon: FaRedo }} /></ErpPage>;
  const attendance = data?.attendance || {};
  const trend = data?.attendanceTrend || [];
  return <ErpPage eyebrow="حراست" title="گزارش‌های حراست" description="نمای مدیریتی حضور، غیاب، درخواست‌ها و عملیات شیفت بر اساس فیلتر انتخاب‌شده" actions={[{ label: 'به‌روزرسانی', icon: FaRedo, tone: 'neutral', onClick: load }, { label: exporting === 'pdf' ? 'در حال ساخت…' : 'PDF', icon: FaFilePdf, onClick: () => exportReport('pdf'), disabled: !!exporting }, { label: exporting === 'excel' ? 'در حال ساخت…' : 'Excel', icon: FaFileExcel, tone: 'success', onClick: () => exportReport('excel'), disabled: !!exporting }]} metrics={[{ label: 'نرخ حضور', value: `${attendance.attendanceRate || 0}%`, icon: FaUsers, tone: 'success' }, { label: 'غیبت', value: attendance.absent || 0, icon: FaExclamationTriangle, tone: 'danger' }, { label: 'شیفت تکمیل‌شده', value: data?.shifts?.completedShifts || 0, icon: FaClock, tone: 'info' }, { label: 'درخواست در انتظار', value: data?.exceptions?.pending || 0, icon: FaChartLine, tone: 'warning' }]}>
    <ErpSection title="فیلتر گزارش" description="خروجی PDF و Excel دقیقاً از همین محدوده و فیلترها ساخته می‌شود.">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5"><label><span className="mb-2 block text-sm font-medium">از تاریخ</span><PersianCalendarComponent value={dateRange.startDate} onChange={(startDate) => setDateRange((current) => ({ ...current, startDate }))} /></label><label><span className="mb-2 block text-sm font-medium">تا تاریخ</span><PersianCalendarComponent value={dateRange.endDate} onChange={(endDate) => setDateRange((current) => ({ ...current, endDate }))} /></label><label><span className="mb-2 block text-sm font-medium">بازه</span><select className={inputClass} value={reportType} onChange={(e) => setReportType(e.target.value as any)}><option value="daily">روزانه</option><option value="weekly">هفتگی</option><option value="monthly">ماهانه</option></select></label><label><span className="mb-2 block text-sm font-medium">بخش</span><select className={inputClass} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}><option value="">همه بخش‌ها</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.namePersian}</option>)}</select></label><label><span className="mb-2 block text-sm font-medium">شیفت</span><select className={inputClass} value={shiftId} onChange={(e) => setShiftId(e.target.value)}><option value="">همه شیفت‌ها</option>{shifts.map((item) => <option key={item.id} value={item.id}>{item.namePersian}</option>)}</select></label></div>
    </ErpSection>
    <ErpSection title="روند روزانه" description="داده‌های تجمیعی؛ نام کارکنان در گزارش مدیریتی اولیه نمایش یا صادر نمی‌شود."><ErpCard className="overflow-hidden p-0"><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-right text-sm"><thead className="bg-slate-50 text-slate-600 dark:bg-slate-800 dark:text-slate-200"><tr>{['تاریخ','کل','حاضر','غایب','تأخیر','ماموریت','مرخصی'].map((title) => <th key={title} className="px-4 py-3 font-semibold">{title}</th>)}</tr></thead><tbody>{trend.map((day: any) => <tr key={day.date} className="border-t border-slate-100 dark:border-slate-800"><td className="px-4 py-3 font-semibold">{new Date(day.date).toLocaleDateString('fa-IR')}</td><td className="px-4 py-3">{day.total}</td><td className="px-4 py-3 text-emerald-600">{day.present}</td><td className="px-4 py-3 text-red-600">{day.absent}</td><td className="px-4 py-3 text-amber-600">{day.late}</td><td className="px-4 py-3">{day.mission}</td><td className="px-4 py-3">{day.leave}</td></tr>)}</tbody></table></div></ErpCard></ErpSection>
  </ErpPage>;
}
