'use client';

import { useEffect, useState } from 'react';
import { FaCheckCircle, FaExclamationTriangle, FaEye, FaHistory, FaLock, FaUserShield } from 'react-icons/fa';
import { ErpBadge, ErpEmptyState, ErpFieldView, ErpLoading, ErpPage, ErpSection, type ErpMetric, type ErpTone } from '@/components/erp';

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
    suspiciousActivities: 0,
  });
  const [securityLogs, setSecurityLogs] = useState<SecurityLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSecurityData();
  }, []);

  const loadSecurityData = async () => {
    try {
      setLoading(true);
      setStats({ totalLogins: 0, failedLogins: 0, activeUsers: 0, suspiciousActivities: 0 });
      setSecurityLogs([]);
    } catch (error) {
      console.error('Error loading security data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusTone = (status: SecurityLog['status']): ErpTone => {
    if (status === 'success') return 'success';
    if (status === 'failed') return 'danger';
    return 'warning';
  };

  const getStatusLabel = (status: SecurityLog['status']) => {
    if (status === 'success') return 'موفق';
    if (status === 'failed') return 'ناموفق';
    return 'هشدار';
  };

  if (loading) {
    return <ErpLoading />;
  }

  const metrics: ErpMetric[] = [
    { label: 'کل ورودها', value: stats.totalLogins.toLocaleString('fa-IR'), icon: FaEye, tone: 'info' },
    { label: 'ورودهای ناموفق', value: stats.failedLogins.toLocaleString('fa-IR'), icon: FaLock, tone: 'danger' },
    { label: 'کاربران فعال', value: stats.activeUsers.toLocaleString('fa-IR'), icon: FaUserShield, tone: 'success' },
    { label: 'فعالیت‌های مشکوک', value: stats.suspiciousActivities.toLocaleString('fa-IR'), icon: FaExclamationTriangle, tone: 'warning' },
  ];

  return (
    <ErpPage
      eyebrow="مدیریت سیستم"
      title="امنیت سیستم"
      description="نظارت بر ورودها، رخدادهای امنیتی و توصیه‌های دوره‌ای برای کاهش ریسک."
      metrics={metrics}
    >
      <ErpSection title="رخدادهای امنیتی اخیر" description="آخرین رخدادهای ثبت‌شده از ورود، مشاهده و فعالیت‌های حساس.">
        {securityLogs.length === 0 ? (
          <ErpEmptyState icon={FaHistory} title="رخداد امنیتی ثبت نشده است" />
        ) : (
          <div className="space-y-3">
            {securityLogs.map((log) => (
              <div key={log.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/50">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] lg:items-center">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-white">{log.userName}</p>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{log.action}</p>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <ErpFieldView label="آدرس IP" value={<span className="font-mono">{log.ipAddress}</span>} />
                    <ErpFieldView label="زمان" value={new Date(log.timestamp).toLocaleString('fa-IR')} />
                  </div>
                  <ErpBadge tone={getStatusTone(log.status)}>{getStatusLabel(log.status)}</ErpBadge>
                </div>
              </div>
            ))}
          </div>
        )}
      </ErpSection>

      <ErpSection title="توصیه‌های امنیتی">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <ErpFieldView label="بررسی ورودهای ناموفق" value="ورودهای ناموفق اخیر را بررسی کنید." hint="در صورت تکرار، محدودسازی دسترسی پیشنهاد می‌شود." tone="warning" />
          <ErpFieldView label="احراز هویت دومرحله‌ای" value="برای حساب‌های مدیریتی فعال بماند." tone="success" />
          <ErpFieldView label="بازبینی سطح دسترسی" value="دسترسی کاربران را دوره‌ای بررسی کنید." tone="info" />
        </div>
      </ErpSection>
    </ErpPage>
  );
}
