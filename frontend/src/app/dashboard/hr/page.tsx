'use client';

import { useCallback, useEffect, useState } from 'react';
import { FaBuilding, FaClipboardCheck, FaExclamationTriangle, FaSync, FaUserPlus, FaUserTie, FaUsers } from 'react-icons/fa';
import { ErpActionGrid, ErpBadge, ErpCard, ErpEmptyState, ErpLoading, ErpPage, ErpSection } from '@/components/erp';
import { hrAPI } from '@/lib/api';
import { apiError, HrMessage } from '@/features/hr/hrUi';

export default function HrDashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setLoading(true); setError(''); setData((await hrAPI.getDashboard()).data.data); }
    catch (err) { setError(apiError(err)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (loading) return <ErpLoading />;
  const metrics = data?.metrics || {};
  const verification = data?.verification || {};
  return <ErpPage
    eyebrow="منابع انسانی · فاز ۱"
    title="داشبورد منابع انسانی"
    description="نمای واحد ساختار سازمانی، ظرفیت جایگاه‌ها و پایه استخدام؛ بدون هم‌پوشانی با حراست یا دسترسی سامانه."
    actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: load, tone: 'neutral' }]}
    metrics={[
      { label: 'پرسنل ثبت‌شده', value: Number(metrics.personnel || 0).toLocaleString('fa-IR'), icon: FaUsers, tone: 'primary' },
      { label: 'سرانه فعال', value: Number(metrics.activeHeadcount || 0).toLocaleString('fa-IR'), icon: FaUserTie, tone: 'success' },
      { label: 'ظرفیت متعهد آینده', value: Number(metrics.committedCapacity || 0).toLocaleString('fa-IR'), icon: FaClipboardCheck, tone: 'info' },
      { label: 'ظرفیت خالی', value: Number(metrics.vacancies || 0).toLocaleString('fa-IR'), icon: FaBuilding, tone: 'warning' },
    ]}
  >
    {error && <HrMessage>{error}</HrMessage>}
    <ErpActionGrid columns={4} items={[
      { title: 'ساختار سازمانی', description: 'واحدها، محل‌های کار، مراکز هزینه، شغل‌ها و جایگاه‌های ظرفیت‌دار', href: '/dashboard/hr/structure', icon: FaBuilding, tone: 'primary' },
      { title: 'استخدام و متقاضیان', description: 'فرم متقاضی، مدارک، تأییدها، وثیقه، قرارداد و فعال‌سازی', href: '/dashboard/hr/hiring', icon: FaUserPlus, tone: 'info' },
      { title: 'پرسنل و استخدام', description: 'هویت پرسنلی، رابطه استخدامی و تخصیص‌های تاریخ‌دار', href: '/dashboard/hr/personnel', icon: FaUsers, tone: 'success' },
      { title: 'مهاجرت و تطبیق', description: 'پیش‌نمایش بدون تغییر، کنترل تعارض‌ها و انتقال قابل تکرار', href: '/dashboard/hr/migration', icon: FaClipboardCheck, tone: 'info' },
    ]} />
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <ErpSection title="کنترل کیفیت پایه" description="مواردی که پیش از شروع جذب باید تکمیل شوند." className="xl:col-span-1">
        <div className="space-y-3">
          <Check label="رابطه فاقد تخصیص اصلی" value={verification.relationshipsWithoutPrimaryAssignment} danger />
          <Check label="جایگاه سرپرستی بدون متصدی" value={verification.vacantSupervisorPositions} danger />
          <Check label="تعاریف غیرفعال" value={verification.inactiveFoundationRecords} />
          <Check label="استخدام برنامه‌ریزی‌شده" value={metrics.planned} />
          <Check label="استخدام معلق" value={metrics.suspended} />
        </div>
      </ErpSection>
      <ErpSection title="نمای ظرفیت جایگاه‌ها" description="سرانه فعال، ظرفیت متعهد و جای خالی جداگانه نمایش داده می‌شوند." className="xl:col-span-2">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(data?.positions || []).map((position: any) => <ErpCard key={position.id} className="p-4">
            <div className="flex items-start justify-between gap-3"><div><p className="font-bold">{position.title}</p><p className="mt-1 text-xs text-slate-500">{position.code} · {position.organizationalUnit?.name}</p></div><ErpBadge tone={position.vacancy ? 'warning' : 'success'}>{position.vacancy ? `${position.vacancy.toLocaleString('fa-IR')} خالی` : 'تکمیل'}</ErpBadge></div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs"><span>فعال<br/><b>{position.occupancy.active.toLocaleString('fa-IR')}</b></span><span>متعهد<br/><b>{position.occupancy.committed.toLocaleString('fa-IR')}</b></span><span>ظرفیت<br/><b>{position.capacity.toLocaleString('fa-IR')}</b></span></div>
          </ErpCard>)}
          {!data?.positions?.length && <ErpEmptyState icon={FaBuilding} title="هنوز جایگاهی تعریف نشده است" description="از ساختار سازمانی شروع کنید." />}
        </div>
      </ErpSection>
    </div>
  </ErpPage>;
}

function Check({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  const count = Number(value || 0);
  return <div className="flex items-center justify-between rounded-xl border border-slate-200 p-3 dark:border-slate-700"><span className="flex items-center gap-2 text-sm"><FaExclamationTriangle className={danger && count ? 'text-amber-500' : 'text-slate-400'} />{label}</span><ErpBadge tone={danger && count ? 'warning' : 'neutral'}>{count.toLocaleString('fa-IR')}</ErpBadge></div>;
}
