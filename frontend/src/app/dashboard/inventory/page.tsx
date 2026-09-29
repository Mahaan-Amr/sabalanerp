'use client';

import React, { useEffect, useState } from 'react';
import { FaBoxes, FaClipboardList, FaCog, FaTools, FaWarehouse } from 'react-icons/fa';
import { ErpActionGrid, ErpBadge, ErpEmptyState, ErpLoading, ErpPage, ErpSection } from '@/components/erp';
import { dashboardAPI } from '@/lib/api';

type Availability = Record<string, { visible: boolean; enabled: boolean; reason: string | null }>;

const InventoryDashboard: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [availability, setAvailability] = useState<Availability>({});

  useEffect(() => {
    const loadAvailability = async () => {
      try {
        const response = await dashboardAPI.getActionAvailability('inventory');
        if (response.data.success) {
          setAvailability(response.data.data as Availability);
        }
      } catch (error) {
        console.error('Error loading user profile:', error);
      } finally {
        setLoading(false);
      }
    };

    loadAvailability();
  }, []);

  if (loading) {
    return <ErpLoading />;
  }

  const masterDataSections = [
    { id: 'cut-types', title: 'نوع برش', description: 'مدیریت انواع برش سنگ', icon: FaCog, prefix: 'CUT_TYPES', href: '/dashboard/inventory/master-data/cut-types' },
    { id: 'stone-materials', title: 'جنس سنگ', description: 'مدیریت جنس‌های سنگ', icon: FaBoxes, prefix: 'STONE_MATERIALS', href: '/dashboard/inventory/master-data/stone-materials' },
    { id: 'cut-widths', title: 'عرض برش', description: 'مدیریت عرض‌های برش', icon: FaCog, prefix: 'CUT_WIDTHS', href: '/dashboard/inventory/master-data/cut-widths' },
    { id: 'thicknesses', title: 'ضخامت', description: 'مدیریت ضخامت سنگ', icon: FaCog, prefix: 'THICKNESSES', href: '/dashboard/inventory/master-data/thicknesses' },
    { id: 'mines', title: 'معدن', description: 'مدیریت معادن سنگ', icon: FaWarehouse, prefix: 'MINES', href: '/dashboard/inventory/master-data/mines' },
    { id: 'finish-types', title: 'نوع فرآوری', description: 'مدیریت نوع فرآوری سنگ', icon: FaCog, prefix: 'FINISH_TYPES', href: '/dashboard/inventory/master-data/finish-types' },
    { id: 'colors', title: 'رنگ/تم', description: 'مدیریت رنگ و تم سنگ', icon: FaCog, prefix: 'COLORS', href: '/dashboard/inventory/master-data/colors' },
  ].map((section) => ({
    ...section,
    canView: availability[`VIEW_${section.prefix}`]?.enabled === true,
    canCreate: availability[`CREATE_${section.prefix}`]?.enabled === true,
  }));

  const hasAnyMasterDataPermission = masterDataSections.some((section) => section.canView);

  return (
    <ErpPage
      eyebrow="انبار"
      title="مدیریت انبار"
    >
      <ErpSection title="">
        <ErpActionGrid
          columns={3}
          items={[
            { title: 'محصولات', href: '/dashboard/sales/products', icon: FaBoxes, tone: 'primary', description: 'کاتالوگ مشترک فروش و انبار' },
            { title: 'خدمات', href: availability.VIEW_SERVICE?.enabled ? '/dashboard/inventory/services' : undefined, icon: FaTools, tone: 'primary', description: 'خدمات، ابزار، لایه و فرآوری', disabled: !availability.VIEW_SERVICE?.enabled, meta: availability.VIEW_SERVICE?.reason || undefined },
            { title: 'داده‌های پایه', href: hasAnyMasterDataPermission ? '/dashboard/inventory/master-data' : undefined, icon: FaCog, tone: 'primary', description: 'مشخصات پایه سنگ و برش', disabled: !hasAnyMasterDataPermission, meta: hasAnyMasterDataPermission ? undefined : 'بدون دسترسی' },
          ]}
        />
      </ErpSection>

      {hasAnyMasterDataPermission ? (
        <ErpSection
          title="بخش‌های داده‌های پایه"
          actions={[{ label: 'مشاهده همه', href: '/dashboard/inventory/master-data', tone: 'neutral', variant: 'outline' }]}
        >
          <ErpActionGrid
            columns={4}
            compact
            items={masterDataSections.map((section) => ({
              title: section.title,
              href: section.canView ? `/dashboard/inventory/master-data?section=${section.id}` : undefined,
              icon: section.icon,
              tone: 'primary',
              disabled: !section.canView,
              badge: !section.canView ? <ErpBadge tone="neutral">بدون دسترسی</ErpBadge> : undefined,
            }))}
          />
        </ErpSection>
      ) : (
        <ErpEmptyState
          icon={FaWarehouse}
          title="دسترسی داده‌های پایه ندارید"
          description="برای مشاهده یا مدیریت داده‌های پایه انبار با مدیر سیستم تماس بگیرید."
        />
      )}
      <ErpSection title="وظایف بین‌واحدی" actions={[{ label: 'مشاهده وظایف', href: '/dashboard/inventory/duties', icon: FaClipboardList, tone: 'neutral', variant: 'outline' }]}>{null}</ErpSection>
      <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--sds-text-secondary)]">
        <span>گردش موجودی</span><ErpBadge tone="neutral">به‌زودی</ErpBadge>
        <span>گزارش‌های انبار</span><ErpBadge tone="neutral">به‌زودی</ErpBadge>
      </div>
    </ErpPage>
  );
};

export default InventoryDashboard;
