'use client';

import { useState, useEffect } from 'react';
import { FaUserShield, FaEye, FaLock, FaHistory, FaExclamationTriangle, FaCheckCircle } from 'react-icons/fa';

interface SecurityLog {
  id: string;
  userId: string;
  userName: string;
  action: string;
  ipAddress: string;
  userAgent: string;
  timestamp: string;
  status: 'success' | 'failed' | 'warning';
}

interface SecurityStats {
  totalLogins: number;
  failedLogins: number;
  activeUsers: number;
  suspiciousActivities: number;
}

export default function AdminSecurityPage() {
  const [stats, setStats] = useState<SecurityStats>({
    totalLogins: 0,
    failedLogins: 0,
    activeUsers: 0,
    suspiciousActivities: 0
  });

  const [securityLogs, setSecurityLogs] = useState<SecurityLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSecurityData();
  }, []);

  const loadSecurityData = async () => {
    try {
      setLoading(true);
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setStats({
        totalLogins: 156,
        failedLogins: 12,
        activeUsers: 8,
        suspiciousActivities: 3
      });

      setSecurityLogs([
        {
          id: '1',
          userId: 'user1',
          userName: 'مدیر سیستم',
          action: 'ورود به سیستم',
          ipAddress: '192.168.1.100',
          userAgent: 'Chrome/120.0.0.0',
          timestamp: '2025-01-20T10:30:00Z',
          status: 'success'
        },
        {
          id: '2',
          userId: 'user2',
          userName: 'Sales User',
          action: 'ورود ناموفق',
          ipAddress: '192.168.1.101',
          userAgent: 'Firefox/121.0.0.0',
          timestamp: '2025-01-20T09:15:00Z',
          status: 'failed'
        },
        {
          id: '3',
          userId: 'user3',
          userName: 'ماهان امیریان',
          action: 'تغییر رمز عبور',
          ipAddress: '192.168.1.102',
          userAgent: 'Safari/17.2.0',
          timestamp: '2025-01-20T08:45:00Z',
          status: 'success'
        }
      ]);
    } catch (error) {
      console.error('Error loading security data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <FaCheckCircle className="h-4 w-4 text-green-400" />;
      case 'failed':
        return <FaExclamationTriangle className="h-4 w-4 text-red-400" />;
      case 'warning':
        return <FaExclamationTriangle className="h-4 w-4 text-yellow-400" />;
      default:
        return <FaEye className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'text-green-400 bg-green-500/20';
      case 'failed':
        return 'text-red-400 bg-red-500/20';
      case 'warning':
        return 'text-yellow-400 bg-yellow-500/20';
      default:
        return 'text-gray-400 bg-gray-500/20';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-liquid-card p-6">
        <div className="flex items-center gap-4">
          <div className="glass-liquid-card p-3">
            <FaUserShield className="h-8 w-8 text-red-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">امنیت سیستم</h1>
            <p className="text-gray-300">نظارت بر امنیت و فعالیت‌های کاربران</p>
          </div>
        </div>
      </div>

      {/* Security Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">کل ورودها</p>
              <p className="text-2xl font-bold text-white">{stats.totalLogins}</p>
            </div>
            <div className="glass-liquid-card p-3">
              <FaEye className="h-6 w-6 text-blue-400" />
            </div>
          </div>
        </div>

        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">ورودهای ناموفق</p>
              <p className="text-2xl font-bold text-white">{stats.failedLogins}</p>
            </div>
            <div className="glass-liquid-card p-3">
              <FaLock className="h-6 w-6 text-red-400" />
            </div>
          </div>
        </div>

        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">کاربران فعال</p>
              <p className="text-2xl font-bold text-white">{stats.activeUsers}</p>
            </div>
            <div className="glass-liquid-card p-3">
              <FaUserShield className="h-6 w-6 text-green-400" />
            </div>
          </div>
        </div>

        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">فعالیت‌های مشکوک</p>
              <p className="text-2xl font-bold text-white">{stats.suspiciousActivities}</p>
            </div>
            <div className="glass-liquid-card p-3">
              <FaExclamationTriangle className="h-6 w-6 text-yellow-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Security Logs */}
      <div className="glass-liquid-card p-6">
        <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
          <FaHistory className="h-5 w-5 text-purple-400" />
          گزارش فعالیت‌های امنیتی
        </h2>
        
        {securityLogs.length === 0 ? (
          <div className="text-center py-8">
            <FaHistory className="mx-auto text-4xl text-gray-400 mb-4" />
            <p className="text-gray-400">هیچ فعالیت امنیتی ثبت نشده است</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-600">
                  <th className="text-right py-3 px-4 text-gray-400">کاربر</th>
                  <th className="text-right py-3 px-4 text-gray-400">عملیات</th>
                  <th className="text-right py-3 px-4 text-gray-400">آی‌پی</th>
                  <th className="text-right py-3 px-4 text-gray-400">وضعیت</th>
                  <th className="text-right py-3 px-4 text-gray-400">زمان</th>
                </tr>
              </thead>
              <tbody>
                {securityLogs.map((log) => (
                  <tr key={log.id} className="border-b border-gray-700 hover:bg-white/5">
                    <td className="py-3 px-4 text-white">{log.userName}</td>
                    <td className="py-3 px-4 text-white">{log.action}</td>
                    <td className="py-3 px-4 text-gray-400 font-mono">{log.ipAddress}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(log.status)}
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(log.status)}`}>
                          {log.status === 'success' ? 'موفق' : 
                           log.status === 'failed' ? 'ناموفق' : 'هشدار'}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-gray-400">
                      {new Date(log.timestamp).toLocaleString('fa-IR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Security Recommendations */}
      <div className="glass-liquid-card p-6">
        <h2 className="text-xl font-semibold text-white mb-4">توصیه‌های امنیتی</h2>
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <FaExclamationTriangle className="h-5 w-5 text-yellow-400 mt-0.5" />
            <div>
              <h3 className="text-white font-medium">رمزهای عبور ضعیف</h3>
              <p className="text-gray-400 text-sm">برخی کاربران از رمزهای عبور ساده استفاده می‌کنند. توصیه می‌شود سیاست رمز عبور قوی‌تری اعمال شود.</p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
            <FaCheckCircle className="h-5 w-5 text-green-400 mt-0.5" />
            <div>
              <h3 className="text-white font-medium">احراز هویت دو مرحله‌ای</h3>
              <p className="text-gray-400 text-sm">احراز هویت دو مرحله‌ای برای تمام کاربران فعال است. این امر امنیت سیستم را افزایش می‌دهد.</p>
            </div>
          </div>

          <div className="flex items-start gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <FaEye className="h-5 w-5 text-blue-400 mt-0.5" />
            <div>
              <h3 className="text-white font-medium">نظارت بر فعالیت‌ها</h3>
              <p className="text-gray-400 text-sm">تمام فعالیت‌های کاربران ثبت و نظارت می‌شود. گزارش‌های امنیتی به‌روزرسانی می‌شوند.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
