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
    { label: 'Ù¾ÛŒØ´â€ŒÙ†ÙˆÛŒØ³â€ŒÙ‡Ø§', value: (data?.metrics?.drafts || 0).toLocaleString('fa-IR'), icon: FaClipboardList, tone: 'warning' },
    { label: 'Ù†Ù‡Ø§ÛŒÛŒâ€ŒØ´Ø¯Ù‡', value: (data?.metrics?.finalized || 0).toLocaleString('fa-IR'), icon: FaTruck, tone: 'success' },
    { label: 'Ù„ØºÙˆØ´Ø¯Ù‡', value: (data?.metrics?.cancelled || 0).toLocaleString('fa-IR'), icon: FaClipboardList, tone: 'danger' },
    { label: 'Ø±Ø§Ù†Ù†Ø¯Ù‡ ÙØ¹Ø§Ù„', value: (data?.metrics?.drivers || 0).toLocaleString('fa-IR'), icon: FaUsers, tone: 'info' },
  ];

  return (
    <ErpPage
      eyebrow="Ù„Ø¬Ø³ØªÛŒÚ©"
      title="Ø¯Ø§Ø´Ø¨ÙˆØ±Ø¯ Ù„Ø¬Ø³ØªÛŒÚ©"
      description="Ù…Ø±Ú©Ø² Ú©Ù†ØªØ±Ù„ Ø¨Ø§Ø±Ú¯ÛŒØ±ÛŒØŒ Ø±Ø§Ù†Ù†Ø¯Ù‡â€ŒÙ‡Ø§ØŒ Ù…Ø§Ù†Ø¯Ù‡ Ù‚Ø§Ø¨Ù„ Ø§Ø±Ø³Ø§Ù„ Ù¾Ø±ÙˆÚ˜Ù‡â€ŒÙ‡Ø§ Ùˆ Ø¨Ø±Ú¯Ù‡â€ŒÙ‡Ø§ÛŒ Ú†Ø§Ù¾ÛŒ Ø¨Ø§Ø±Ú¯ÛŒØ±ÛŒ."
      metrics={metrics}
      actions={[
        { label: 'Ø¨Ù‡â€ŒØ±ÙˆØ²Ø±Ø³Ø§Ù†ÛŒ', icon: FaSync, onClick: load, tone: 'neutral' },
        { label: 'Ø¨Ø§Ø±Ú¯ÛŒØ±ÛŒ Ø¬Ø¯ÛŒØ¯', icon: FaPlus, href: '/dashboard/logistics/loadings/new', tone: 'primary', variant: 'solid' },
      ]}
    >
      <ErpActionGrid
        columns={3}
        items={[
          { title: 'Ø¨Ø§Ø±Ú¯ÛŒØ±ÛŒ Ø¬Ø¯ÛŒØ¯', description: 'Ø§Ù†ØªØ®Ø§Ø¨ Ù¾Ø±ÙˆÚ˜Ù‡ØŒ ØªØ®ØµÛŒØµ Ø¯Ø³ØªÛŒ Ø±Ø¯ÛŒÙâ€ŒÙ‡Ø§ÛŒ Ù‚Ø±Ø§Ø±Ø¯Ø§Ø¯ Ùˆ Ø«Ø¨Øª Ø±Ø§Ù†Ù†Ø¯Ù‡.', href: '/dashboard/logistics/loadings/new', icon: FaPlus, tone: 'primary' },
          { title: 'Ø±Ø¬ÛŒØ³ØªØ± Ø¨Ø§Ø±Ú¯ÛŒØ±ÛŒâ€ŒÙ‡Ø§', description: 'Ù…Ø´Ø§Ù‡Ø¯Ù‡ Ù¾ÛŒØ´â€ŒÙ†ÙˆÛŒØ³â€ŒÙ‡Ø§ØŒ Ø§Ø³Ù†Ø§Ø¯ Ù†Ù‡Ø§ÛŒÛŒØŒ Ù„ØºÙˆÙ‡Ø§ Ùˆ Ø§ØµÙ„Ø§Ø­Ø§Øª.', href: '/dashboard/logistics/loadings', icon: FaClipboardList, tone: 'info' },
        ]}
      />

      <ErpSection title="Ø¢Ø®Ø±ÛŒÙ† Ø¨Ø§Ø±Ú¯ÛŒØ±ÛŒâ€ŒÙ‡Ø§">
        <div className="space-y-3">
          {(data?.recent || []).map((loading: any) => (
            <div key={loading.id} className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <a href={`/dashboard/logistics/loadings/${loading.id}`} className="font-semibold text-[#074747] dark:text-teal-200">{loading.loadingNumber}</a>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{loading.customerName} Â· {loading.projectName} Â· {dateFa(loading.loadingDate)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={loading.status} />
                <span className="text-xs text-slate-500">{(loading.lineCount || 0).toLocaleString('fa-IR')} Ø±Ø¯ÛŒÙ</span>
              </div>
            </div>
          ))}
          {(!data?.recent || data.recent.length === 0) && <p className="text-sm text-slate-500">Ù‡Ù†ÙˆØ² Ø¨Ø§Ø±Ú¯ÛŒØ±ÛŒ Ø«Ø¨Øª Ù†Ø´Ø¯Ù‡ Ø§Ø³Øª.</p>}
        </div>
      </ErpSection>
    </ErpPage>
  );
}
