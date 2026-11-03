'use client';

import React, { useEffect, useState } from 'react';
import { FaBoxes, FaChartLine, FaClipboardList, FaCog, FaPlus, FaTools, FaWarehouse } from 'react-icons/fa';
import { ErpActionGrid, ErpBadge, ErpEmptyState, ErpLoading, ErpPage, ErpSection, type ErpMetric } from '@/components/erp';
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

  const metrics: ErpMetric[] = [
    { label: 'بخش‌های داده پایه', value: masterDataSections.length.toLocaleString('fa-IR'), icon: FaCog, tone: 'primary' },
    { label: 'قابل مشاهده', value: masterDataSections.filter((section) => section.canView).length.toLocaleString('fa-IR'), icon: FaWarehouse, tone: 'success' },
    { label: 'قابل ایجاد', value: masterDataSections.filter((section) => section.canCreate).length.toLocaleString('fa-IR'), icon: FaPlus, tone: 'info' },
    { label: 'بدون دسترسی', value: masterDataSections.filter((section) => !section.canView).length.toLocaleString('fa-IR'), icon: FaClipboardList, tone: 'warning' },
  ];

  return (
    <ErpPage
      eyebrow="انبار"
      title="مدیریت انبار"
      metrics={metrics}
    >
      <ErpSection title="عملیات اصلی">
        <ErpActionGrid
          columns={3}
          items={[
            {
              title: 'داده‌های پایه',
              href: hasAnyMasterDataPermission ? '/dashboard/inventory/master-data' : undefined,
              icon: FaCog,
              tone: 'warning',
              disabled: !hasAnyMasterDataPermission,
              meta: hasAnyMasterDataPermission ? 'قابل دسترسی' : 'بدون دسترسی',
            },
            { title: 'محصولات', href: '/dashboard/sales/products', icon: FaBoxes, tone: 'primary', meta: 'کاتالوگ فروش' },
            { title: 'گردش موجودی', icon: FaClipboardList, tone: 'info', disabled: true, meta: 'به‌زودی' },
            { title: 'خدمات', href: availability.VIEW_SERVICE?.enabled ? '/dashboard/inventory/services' : undefined, icon: FaTools, tone: 'success', disabled: !availability.VIEW_SERVICE?.enabled, meta: availability.VIEW_SERVICE?.reason || undefined },
            { title: 'گزارش‌ها', icon: FaChartLine, tone: 'purple', disabled: true, meta: 'به‌زودی' },
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
              description: section.description,
              href: section.canView ? section.href : undefined,
              icon: section.icon,
              tone: section.canView ? 'success' : 'danger',
              disabled: !section.canView,
              badge: <ErpBadge tone={section.canView ? 'success' : 'danger'}>{section.canView ? 'قابل مشاهده' : 'بدون دسترسی'}</ErpBadge>,
              meta: section.canCreate ? 'ایجاد مجاز' : undefined,
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
    </ErpPage>
  );
};

export default InventoryDashboard;
