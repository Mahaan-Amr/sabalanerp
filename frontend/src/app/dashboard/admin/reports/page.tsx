'use client';

import { useEffect, useState } from 'react';
import { FaCalendarAlt, FaChartLine, FaDownload, FaFileContract, FaFileExcel, FaFilePdf, FaUsers } from 'react-icons/fa';
import { ErpActionGrid, ErpBadge, ErpButton, ErpEmptyState, ErpLoading, ErpPage, ErpSection, type ErpMetric, type ErpTone } from '@/components/erp';

interface ReportData {
  id: string;
  name: string;
  namePersian: string;
  description: string;
  type: 'pdf' | 'excel' | 'csv';
  lastGenerated: string;
  size: string;
}

export default function AdminReportsPage() {
  const [reports, setReports] = useState<ReportData[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    try {
      setLoading(true);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      setReports([
        { id: '1', name: 'user_activity_report', namePersian: 'گزارش فعالیت کاربران', description: 'گزارش ورود، خروج و فعالیت کاربران', type: 'pdf', lastGenerated: '2025-01-20T10:30:00Z', size: '2.3 MB' },
        { id: '2', name: 'contract_summary', namePersian: 'خلاصه قراردادها', description: 'گزارش وضعیت قراردادها و مبالغ فروش', type: 'excel', lastGenerated: '2025-01-20T09:15:00Z', size: '1.8 MB' },
        { id: '3', name: 'financial_summary', namePersian: 'خلاصه مالی', description: 'گزارش پرداخت‌ها و وضعیت مالی', type: 'pdf', lastGenerated: '2025-01-19T16:45:00Z', size: '3.1 MB' },
        { id: '4', name: 'security_audit', namePersian: 'ممیزی امنیتی', description: 'گزارش رخدادها و وضعیت امنیتی', type: 'pdf', lastGenerated: '2025-01-19T14:20:00Z', size: '1.5 MB' },
      ]);
    } catch (error) {
      console.error('Error loading reports:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateReport = async (reportId: string) => {
    setGenerating(reportId);
    try {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      setReports((prev) => prev.map((report) => report.id === reportId ? { ...report, lastGenerated: new Date().toISOString() } : report));
    } catch (error) {
      console.error('Error generating report:', error);
    } finally {
      setGenerating(null);
    }
  };

  const downloadReport = (reportId: string) => {
    console.log('Downloading report:', reportId);
  };

  const getTypeTone = (type: ReportData['type']): ErpTone => {
    if (type === 'pdf') return 'danger';
    if (type === 'excel') return 'success';
    return 'info';
  };

  const getTypeIcon = (type: ReportData['type']) => {
    if (type === 'pdf') return FaFilePdf;
    if (type === 'excel') return FaFileExcel;
    return FaFileContract;
  };

  if (loading) {
    return <ErpLoading />;
  }

  const metrics: ErpMetric[] = [
    { label: 'کل گزارش‌ها', value: reports.length.toLocaleString('fa-IR'), icon: FaFileContract, tone: 'primary' },
    { label: 'گزارش‌های PDF', value: reports.filter((report) => report.type === 'pdf').length.toLocaleString('fa-IR'), icon: FaFilePdf, tone: 'danger' },
    { label: 'گزارش‌های Excel', value: reports.filter((report) => report.type === 'excel').length.toLocaleString('fa-IR'), icon: FaFileExcel, tone: 'success' },
  ];

  return (
    <ErpPage
      eyebrow="مدیریت سیستم"
      title="گزارش‌ها"
      description="مدیریت گزارش‌ها، تولید خروجی و دانلود فایل‌های مدیریتی."
      metrics={metrics}
    >
      <ErpSection title="لیست گزارش‌ها" description="گزارش‌های آماده یا قابل تولید برای مدیران سیستم.">
        {reports.length === 0 ? (
          <ErpEmptyState icon={FaChartLine} title="گزارشی موجود نیست" />
        ) : (
          <div className="space-y-3">
            {reports.map((report) => {
              const Icon = getTypeIcon(report.type);
              return (
                <div key={report.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/50">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#074747]/10 text-[#074747] dark:bg-teal-900/40 dark:text-teal-100">
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-semibold text-slate-900 dark:text-white">{report.namePersian}</h3>
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{report.description}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                          <span className="inline-flex items-center gap-1"><FaCalendarAlt className="h-3 w-3" />{new Date(report.lastGenerated).toLocaleDateString('fa-IR')}</span>
                          <span>حجم: {report.size}</span>
                          <ErpBadge tone={getTypeTone(report.type)}>{report.type.toUpperCase()}</ErpBadge>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      <ErpButton
                        label={generating === report.id ? 'در حال تولید...' : 'تولید گزارش'}
                        onClick={() => generateReport(report.id)}
                        disabled={generating === report.id}
                        icon={FaChartLine}
                        tone="neutral"
                        variant="outline"
                      />
                      <ErpButton label="دانلود" onClick={() => downloadReport(report.id)} icon={FaDownload} tone="primary" variant="solid" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ErpSection>

      <ErpSection title="گزینه‌های تولید گزارش">
        <ErpActionGrid
          columns={3}
          items={[
            { title: 'گزارش فعالیت کاربران', icon: FaUsers, tone: 'info' },
            { title: 'گزارش خلاصه قراردادها', icon: FaFileContract, tone: 'primary' },
            { title: 'گزارش مالی', icon: FaChartLine, tone: 'success' },
            { title: 'گزارش روزانه', icon: FaCalendarAlt, tone: 'neutral' },
            { title: 'گزارش هفتگی', icon: FaCalendarAlt, tone: 'neutral' },
            { title: 'گزارش ماهانه', icon: FaCalendarAlt, tone: 'neutral' },
          ]}
        />
      </ErpSection>
    </ErpPage>
  );
}
