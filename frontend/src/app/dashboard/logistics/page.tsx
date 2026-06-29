'use client';

import { useEffect, useState } from 'react';
import { FaClipboardList, FaPlus, FaSync, FaTruck, FaUsers } from 'react-icons/fa';
import { ErpActionGrid, ErpLoading, ErpPage, ErpSection, type ErpMetric } from '@/components/erp';
import { logisticsAPI } from '@/lib/api';
import { StatusBadge, dateFa } from './logistics-ui';

export default function LogisticsDashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setLoading(true);
      const response = await logisticsAPI.getDashboard();
      if (response.data.success) setData(response.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading) return <ErpLoading />;

  const metrics: ErpMetric[] = [
    { label: 'پیش‌نویس‌ها', value: (data?.metrics?.drafts || 0).toLocaleString('fa-IR'), icon: FaClipboardList, tone: 'warning' },
    { label: 'نهایی‌شده', value: (data?.metrics?.finalized || 0).toLocaleString('fa-IR'), icon: FaTruck, tone: 'success' },
    { label: 'لغوشده', value: (data?.metrics?.cancelled || 0).toLocaleString('fa-IR'), icon: FaClipboardList, tone: 'danger' },
    { label: 'راننده فعال', value: (data?.metrics?.drivers || 0).toLocaleString('fa-IR'), icon: FaUsers, tone: 'info' },
  ];

  return (
    <ErpPage
      eyebrow="لجستیک"
      title="داشبورد لجستیک"
      description="مرکز کنترل بارگیری، راننده‌ها، مانده قابل ارسال پروژه‌ها و برگه‌های چاپی بارگیری."
      metrics={metrics}
      actions={[
        { label: 'به‌روزرسانی', icon: FaSync, onClick: load, tone: 'neutral' },
        { label: 'بارگیری جدید', icon: FaPlus, href: '/dashboard/logistics/loadings/new', tone: 'primary', variant: 'solid' },
      ]}
    >
      <ErpActionGrid
        columns={3}
        items={[
          { title: 'بارگیری جدید', description: 'انتخاب پروژه، تخصیص دستی ردیف‌های قرارداد و ثبت راننده.', href: '/dashboard/logistics/loadings/new', icon: FaPlus, tone: 'primary' },
          { title: 'رجیستر بارگیری‌ها', description: 'مشاهده پیش‌نویس‌ها، اسناد نهایی، لغوها و اصلاحات.', href: '/dashboard/logistics/loadings', icon: FaClipboardList, tone: 'info' },
          { title: 'راننده‌ها', description: 'تعریف راننده‌های ثابت سبلان و اطلاعات خودرو.', href: '/dashboard/logistics/drivers', icon: FaUsers, tone: 'success' },
        ]}
      />

      <ErpSection title="آخرین بارگیری‌ها">
        <div className="space-y-3">
          {(data?.recent || []).map((loading: any) => (
            <div key={loading.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <a href={`/dashboard/logistics/loadings/${loading.id}`} className="font-semibold text-[#074747] dark:text-teal-200">{loading.loadingNumber}</a>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{loading.customerName} · {loading.projectName} · {dateFa(loading.loadingDate)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={loading.status} />
                <span className="text-xs text-slate-500">{(loading.lineCount || 0).toLocaleString('fa-IR')} ردیف</span>
              </div>
            </div>
          ))}
          {(!data?.recent || data.recent.length === 0) && <p className="text-sm text-slate-500">هنوز بارگیری ثبت نشده است.</p>}
        </div>
      </ErpSection>
    </ErpPage>
  );
}
