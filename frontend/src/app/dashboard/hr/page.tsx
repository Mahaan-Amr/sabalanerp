'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  FaBuilding,
  FaClipboardCheck,
  FaExchangeAlt,
  FaHome,
  FaSitemap,
  FaSync,
  FaUserPlus,
  FaUserTie,
  FaUsers,
} from 'react-icons/fa';
import {
  ErpBadge,
  ErpButton,
  ErpCapacityProgress,
  ErpEmptyState,
  ErpLoading,
  ErpMobileBottomNavigation,
  ErpNeumorphicActionGrid,
  ErpNeumorphicCard,
  ErpNeumorphicMetricGrid,
  ErpWorkList,
} from '@/components/erp';
import { positionCapacityCoverage } from '@/features/hr/hrDashboardViewModel';
import { apiError, HrMessage } from '@/features/hr/hrUi';
import { hrAPI } from '@/lib/api';

export default function HrDashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      setData((await hrAPI.getDashboard()).data.data);
    } catch (err) {
      setError(apiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <ErpLoading />;

  const metrics = data?.metrics || {};
  const verification = data?.verification || {};
  const coverage = positionCapacityCoverage(
    Number(metrics.committedCapacity || 0),
    Number(metrics.vacancies || 0),
  );

  return (
    <main dir="rtl" lang="fa" className="sds-neumorphic-scope mx-auto w-full max-w-7xl space-y-6 pb-24 lg:pb-2">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold tracking-wide text-[var(--sds-accent)]">منابع انسانی · فاز ۱</p>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-[var(--sds-text-primary)] sm:text-3xl">داشبورد منابع انسانی</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--sds-text-secondary)]">
            نمای واحد ساختار سازمانی، ظرفیت جایگاه‌ها و پایه استخدام؛ بدون هم‌پوشانی با گارد یا دسترسی سامانه.
          </p>
        </div>
        <ErpButton label="به‌روزرسانی" icon={FaSync} onClick={load} tone="neutral" variant="soft" />
      </header>

      {error && <HrMessage>{error}</HrMessage>}

      <ErpNeumorphicMetricGrid
        items={[
          {
            id: 'personnel',
            label: 'پرسنل ثبت‌شده',
            value: Number(metrics.personnel || 0).toLocaleString('fa-IR'),
            icon: FaUsers,
            tone: 'primary',
          },
          {
            id: 'active-headcount',
            label: 'سرانه فعال',
            value: Number(metrics.activeHeadcount || 0).toLocaleString('fa-IR'),
            icon: FaUserTie,
            tone: 'success',
          },
          {
            id: 'committed-capacity',
            label: 'ظرفیت متعهد آینده',
            value: Number(metrics.committedCapacity || 0).toLocaleString('fa-IR'),
            icon: FaClipboardCheck,
            tone: 'info',
          },
          {
            id: 'vacancies',
            label: 'ظرفیت خالی',
            value: Number(metrics.vacancies || 0).toLocaleString('fa-IR'),
            icon: FaBuilding,
            tone: 'warning',
          },
        ]}
      />

      <ErpNeumorphicActionGrid
        title="دسترسی سریع"
        items={[
          {
            id: 'structure',
            title: 'ساختار سازمانی',
            description: 'واحدها، محل‌های کار، مراکز هزینه، شغل‌ها و جایگاه‌ها',
            href: '/dashboard/hr/structure',
            icon: FaBuilding,
          },
          {
            id: 'hiring',
            title: 'جذب و پرونده‌های متقاضیان',
            description: 'فرم، مدارک، تأییدها، وثیقه، قرارداد و فعال‌سازی',
            href: '/dashboard/hr/hiring',
            icon: FaUserPlus,
          },
          {
            id: 'personnel',
            title: 'پرسنل و روابط استخدامی',
            description: 'هویت پرسنلی، روابط استخدامی و تخصیص‌های تاریخ‌دار',
            href: '/dashboard/hr/personnel',
            icon: FaUsers,
          },
          {
            id: 'migration',
            title: 'مهاجرت و تطبیق',
            description: 'پیش‌نمایش، کنترل تعارض‌ها و انتقال قابل تکرار',
            href: '/dashboard/hr/migration',
            icon: FaExchangeAlt,
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="xl:col-span-1">
          <ErpWorkList
            title="وظایف و موارد نیازمند پیگیری"
            items={[
              {
                id: 'relationships-without-primary-assignment',
                label: 'رابطه فاقد تخصیص اصلی',
                count: Number(verification.relationshipsWithoutPrimaryAssignment || 0),
                href: '/dashboard/hr/personnel',
                tone: 'danger',
              },
              {
                id: 'vacant-supervisor-positions',
                label: 'جایگاه سرپرستی بدون متصدی',
                count: Number(verification.vacantSupervisorPositions || 0),
                href: '/dashboard/hr/structure',
                tone: 'danger',
              },
              {
                id: 'inactive-foundation-records',
                label: 'تعاریف غیرفعال',
                count: Number(verification.inactiveFoundationRecords || 0),
                href: '/dashboard/hr/structure',
                tone: 'warning',
              },
              {
                id: 'planned-hiring',
                label: 'استخدام برنامه‌ریزی‌شده',
                count: Number(metrics.planned || 0),
                href: '/dashboard/hr/personnel',
                tone: 'info',
              },
              {
                id: 'suspended-hiring',
                label: 'استخدام معلق',
                count: Number(metrics.suspended || 0),
                href: '/dashboard/hr/personnel',
                tone: 'warning',
              },
            ]}
          />
        </div>

        <div className="xl:col-span-2">
          <ErpCapacityProgress
            title="بررسی سریع"
            label="پوشش ظرفیت جایگاه‌ها"
            percentage={coverage.percentage}
            committed={coverage.committed}
            total={coverage.total}
          />
        </div>

        <ErpNeumorphicCard className="p-4 sm:p-5 xl:col-span-3">
            <div className="mb-4">
              <h2 className="text-lg font-black text-[var(--sds-text-primary)] sm:text-xl">نمای ظرفیت جایگاه‌ها</h2>
              <p className="mt-1 text-sm leading-6 text-[var(--sds-text-secondary)]">
                سرانه فعال، ظرفیت متعهد و جای خالی جداگانه نمایش داده می‌شوند.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {(data?.positions || []).map((position: any) => (
                <ErpNeumorphicCard key={position.id} as="article" className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-[var(--sds-text-primary)]">{position.title}</p>
                      <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{position.code} · {position.organizationalUnit?.name}</p>
                    </div>
                    <ErpBadge tone={position.vacancy ? 'warning' : 'success'}>
                      {position.vacancy ? `${position.vacancy.toLocaleString('fa-IR')} خالی` : 'تکمیل'}
                    </ErpBadge>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs text-[var(--sds-text-secondary)]">
                    <span>فعال<br /><b className="text-[var(--sds-text-primary)]">{position.occupancy.active.toLocaleString('fa-IR')}</b></span>
                    <span>متعهد<br /><b className="text-[var(--sds-text-primary)]">{position.occupancy.committed.toLocaleString('fa-IR')}</b></span>
                    <span>ظرفیت<br /><b className="text-[var(--sds-text-primary)]">{position.capacity.toLocaleString('fa-IR')}</b></span>
                  </div>
                </ErpNeumorphicCard>
              ))}
              {!data?.positions?.length && (
                <ErpEmptyState icon={FaBuilding} title="هنوز جایگاهی تعریف نشده است" description="از ساختار سازمانی شروع کنید." />
              )}
            </div>
        </ErpNeumorphicCard>
      </div>

      <ErpMobileBottomNavigation
        items={[
          { id: 'dashboard', label: 'داشبورد', href: '/dashboard/hr', icon: FaHome },
          { id: 'structure', label: 'ساختار', href: '/dashboard/hr/structure', icon: FaSitemap },
          { id: 'hiring', label: 'جذب', href: '/dashboard/hr/hiring', icon: FaUserPlus },
          { id: 'personnel', label: 'پرسنل', href: '/dashboard/hr/personnel', icon: FaUsers },
          { id: 'migration', label: 'مهاجرت', href: '/dashboard/hr/migration', icon: FaExchangeAlt },
        ]}
      />
    </main>
  );
}
