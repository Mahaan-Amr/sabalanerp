'use client';

import { useState, useEffect } from 'react';
import { FaChartLine, FaDownload, FaFilePdf, FaFileExcel, FaCalendarAlt, FaUsers, FaFileContract } from 'react-icons/fa';

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
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setReports([
        {
          id: '1',
          name: 'user_activity_report',
          namePersian: '??? ??? ??',
          description: '??? ?? ??? ?? ? ???',
          type: 'pdf',
          lastGenerated: '2025-01-20T10:30:00Z',
          size: '2.3 MB'
        },
        {
          id: '2',
          name: 'contract_summary',
          namePersian: '??? ???',
          description: '??? ??? ??? ? ??? ???',
          type: 'excel',
          lastGenerated: '2025-01-20T09:15:00Z',
          size: '1.8 MB'
        },
        {
          id: '3',
          name: 'financial_summary',
          namePersian: '??? ??',
          description: '??? ?? ? ?? ???',
          type: 'pdf',
          lastGenerated: '2025-01-19T16:45:00Z',
          size: '3.1 MB'
        },
        {
          id: '4',
          name: 'security_audit',
          namePersian: '??? ???',
          description: '??? ??? ? ??? ???',
          type: 'pdf',
          lastGenerated: '2025-01-19T14:20:00Z',
          size: '1.5 MB'
        }
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
      // Simulate report generation
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Update the report's last generated time
      setReports(prev => prev.map(report => 
        report.id === reportId 
          ? { ...report, lastGenerated: new Date().toISOString() }
          : report
      ));
    } catch (error) {
      console.error('Error generating report:', error);
    } finally {
      setGenerating(null);
    }
  };

  const downloadReport = (reportId: string) => {
    // Simulate download
    console.log('Downloading report:', reportId);
  };

  const getReportIcon = (type: string) => {
    switch (type) {
      case 'pdf':
        return <FaFilePdf className="h-6 w-6 text-red-400" />;
      case 'excel':
        return <FaFileExcel className="h-6 w-6 text-green-400" />;
      case 'csv':
        return <FaFileExcel className="h-6 w-6 text-blue-400" />;
      default:
        return <FaFileContract className="h-6 w-6 text-gray-400" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-liquid-card p-6">
        <div className="flex items-center gap-4">
          <div className="glass-liquid-card p-3">
            <FaChartLine className="h-8 w-8 text-teal-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">?? ??</h1>
            <p className="text-gray-300">?? ?? ? ??? ???</p>
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">? ??</p>
              <p className="text-2xl font-bold text-white">{reports.length}</p>
            </div>
            <div className="glass-liquid-card p-3">
              <FaFileContract className="h-6 w-6 text-blue-400" />
            </div>
          </div>
        </div>

        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">?? PDF</p>
              <p className="text-2xl font-bold text-white">
                {reports.filter(r => r.type === 'pdf').length}
              </p>
            </div>
            <div className="glass-liquid-card p-3">
              <FaFilePdf className="h-6 w-6 text-red-400" />
            </div>
          </div>
        </div>

        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">?? Excel</p>
              <p className="text-2xl font-bold text-white">
                {reports.filter(r => r.type === 'excel').length}
              </p>
            </div>
            <div className="glass-liquid-card p-3">
              <FaFileExcel className="h-6 w-6 text-green-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Reports List */}
      <div className="glass-liquid-card p-6">
        <h2 className="text-xl font-semibold text-white mb-4">?? ???</h2>
        
        {reports.length === 0 ? (
          <div className="text-center py-8">
            <FaChartLine className="mx-auto text-4xl text-gray-400 mb-4" />
            <p className="text-gray-400">?? ??? ??? ??</p>
          </div>
        ) : (
          <div className="space-y-4">
            {reports.map((report) => (
              <div key={report.id} className="glass-liquid-card p-4 hover:bg-white/5 transition-all duration-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="glass-liquid-card p-3">
                      {getReportIcon(report.type)}
                    </div>
                    <div>
                      <h3 className="text-white font-semibold">{report.namePersian}</h3>
                      <p className="text-gray-400 text-sm">{report.description}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <FaCalendarAlt className="h-3 w-3" />
                          ??? ???: {new Date(report.lastGenerated).toLocaleDateString('fa-IR')}
                        </span>
                        <span>??: {report.size}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => generateReport(report.id)}
                      disabled={generating === report.id}
                      className="glass-liquid-btn px-4 py-2 flex items-center gap-2 disabled:opacity-50"
                    >
                      {generating === report.id ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      ) : (
                        <FaChartLine className="h-4 w-4" />
                      )}
                      {generating === report.id ? '? ?? ???...' : '??? ??'}
                    </button>
                    
                    <button
                      onClick={() => downloadReport(report.id)}
                      className="glass-liquid-btn-primary px-4 py-2 flex items-center gap-2"
                    >
                      <FaDownload className="h-4 w-4" />
                      ???
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Report Generation Options */}
      <div className="glass-liquid-card p-6">
        <h2 className="text-xl font-semibold text-white mb-4">??? ??? ???</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white">?? ??</h3>
            <div className="space-y-2">
              <button className="w-full glass-liquid-btn p-3 text-right flex items-center justify-between">
                <span>??? ?? ??</span>
                <FaUsers className="h-4 w-4" />
              </button>
              <button className="w-full glass-liquid-btn p-3 text-right flex items-center justify-between">
                <span>??? ??? ???</span>
                <FaFileContract className="h-4 w-4" />
              </button>
              <button className="w-full glass-liquid-btn p-3 text-right flex items-center justify-between">
                <span>??? ???</span>
                <FaChartLine className="h-4 w-4" />
              </button>
            </div>
          </div>
          
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-white">?? ?? ??</h3>
            <div className="space-y-2">
              <button className="w-full glass-liquid-btn p-3 text-right flex items-center justify-between">
                <span>??? ???</span>
                <FaCalendarAlt className="h-4 w-4" />
              </button>
              <button className="w-full glass-liquid-btn p-3 text-right flex items-center justify-between">
                <span>??? ???</span>
                <FaCalendarAlt className="h-4 w-4" />
              </button>
              <button className="w-full glass-liquid-btn p-3 text-right flex items-center justify-between">
                <span>??? ???</span>
                <FaCalendarAlt className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

