'use client';

import React, { useEffect, useState } from 'react';
import { FaBoxes, FaCog, FaTools, FaWarehouse } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpEmptyState, ErpLoading, ErpNeumorphicActionGrid, ErpPage } from '@/components/erp';
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
    { id: 'cut-types', title: 'نوع برش', icon: FaCog, prefix: 'CUT_TYPES' },
    { id: 'stone-materials', title: 'جنس سنگ', icon: FaBoxes, prefix: 'STONE_MATERIALS' },
    { id: 'cut-widths', title: 'عرض برش', icon: FaCog, prefix: 'CUT_WIDTHS' },
    { id: 'thicknesses', title: 'ضخامت', icon: FaCog, prefix: 'THICKNESSES' },
    { id: 'mines', title: 'معدن', icon: FaWarehouse, prefix: 'MINES' },
    { id: 'finish-types', title: 'نوع فرآوری', icon: FaCog, prefix: 'FINISH_TYPES' },
    { id: 'colors', title: 'رنگ/تم', icon: FaCog, prefix: 'COLORS' },
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
      <div className="sds-neumorphic-scope space-y-6">
        <ErpNeumorphicActionGrid
          title="بخش‌های اصلی انبار"
          showTitle={false}
          desktopColumns={3}
          items={[
            { id: 'products', title: 'محصولات', href: '/dashboard/sales/products', icon: FaBoxes, description: 'کاتالوگ مشترک فروش و انبار' },
            { id: 'services', title: 'خدمات', href: availability.VIEW_SERVICE?.enabled ? '/dashboard/inventory/services' : undefined, icon: FaTools, description: 'خدمات، ابزار، لایه و فرآوری', disabledReason: availability.VIEW_SERVICE?.enabled ? undefined : availability.VIEW_SERVICE?.reason || 'بدون دسترسی' },
            { id: 'master-data', title: 'داده‌های پایه', href: hasAnyMasterDataPermission ? '/dashboard/inventory/master-data' : undefined, icon: FaCog, description: 'مشخصات پایه سنگ و برش', disabledReason: hasAnyMasterDataPermission ? undefined : 'بدون دسترسی' },
          ]}
        />

      {hasAnyMasterDataPermission ? (
        <div className="space-y-3">
          <div className="flex justify-end"><ErpButton label="مشاهده همه" href="/dashboard/inventory/master-data" tone="neutral" variant="outline" /></div>
          <ErpNeumorphicActionGrid
            title="بخش‌های داده‌های پایه"
            items={masterDataSections.map((section) => ({
              id: section.id,
              title: section.title,
              href: section.canView ? `/dashboard/inventory/master-data?section=${section.id}` : undefined,
              icon: section.icon,
              disabledReason: section.canView ? undefined : 'بدون دسترسی',
            }))}
          />
        </div>
      ) : (
        <ErpEmptyState
          icon={FaWarehouse}
          title="دسترسی داده‌های پایه ندارید"
          description="برای مشاهده یا مدیریت داده‌های پایه انبار با مدیر سیستم تماس بگیرید."
        />
      )}
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--sds-text-secondary)]">
        <span>گردش موجودی</span><ErpBadge tone="neutral">به‌زودی</ErpBadge>
        <span>گزارش‌های انبار</span><ErpBadge tone="neutral">به‌زودی</ErpBadge>
      </div>
    </ErpPage>
  );
};

export default InventoryDashboard;
