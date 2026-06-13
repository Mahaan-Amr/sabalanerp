'use client';

import React, { useEffect, useState } from 'react';
import { FaBoxes, FaChartLine, FaClipboardList, FaCog, FaCut, FaPlus, FaTools, FaWarehouse } from 'react-icons/fa';
import { ErpActionGrid, ErpBadge, ErpEmptyState, ErpLoading, ErpPage, ErpSection, type ErpMetric } from '@/components/erp';
import { dashboardAPI } from '@/lib/api';
import { getInventoryMasterDataPermissions } from '@/lib/permissions';

interface User {
  id: string;
  role: string;
  departmentId?: string;
  permissions?: {
    features: Array<{ feature: string; permissionLevel: string; workspace: string }>;
    workspaces: Array<{ workspace: string; permissionLevel: string }>;
  };
}

const InventoryDashboard: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [inventoryPermissions, setInventoryPermissions] = useState<any>(null);

  useEffect(() => {
    const loadUserProfile = async () => {
      try {
        const response = await dashboardAPI.getProfile();
        if (response.data.success) {
          setInventoryPermissions(getInventoryMasterDataPermissions(response.data.data as User));
        }
      } catch (error) {
        console.error('Error loading user profile:', error);
      } finally {
        setLoading(false);
      }
    };

    loadUserProfile();
  }, []);

  if (loading) {
    return <ErpLoading />;
  }

  const masterDataSections = [
    { id: 'cut-types', title: 'نوع برش', description: 'مدیریت انواع برش سنگ', icon: FaCog, canView: inventoryPermissions?.cutTypes.canView || false, canCreate: inventoryPermissions?.cutTypes.canCreate || false, href: '/dashboard/inventory/master-data/cut-types' },
    { id: 'stone-materials', title: 'جنس سنگ', description: 'مدیریت جنس‌های سنگ', icon: FaBoxes, canView: inventoryPermissions?.stoneMaterials.canView || false, canCreate: inventoryPermissions?.stoneMaterials.canCreate || false, href: '/dashboard/inventory/master-data/stone-materials' },
    { id: 'cut-widths', title: 'عرض برش', description: 'مدیریت عرض‌های برش', icon: FaCog, canView: inventoryPermissions?.cutWidths.canView || false, canCreate: inventoryPermissions?.cutWidths.canCreate || false, href: '/dashboard/inventory/master-data/cut-widths' },
    { id: 'thicknesses', title: 'ضخامت', description: 'مدیریت ضخامت سنگ', icon: FaCog, canView: inventoryPermissions?.thicknesses.canView || false, canCreate: inventoryPermissions?.thicknesses.canCreate || false, href: '/dashboard/inventory/master-data/thicknesses' },
    { id: 'mines', title: 'معدن', description: 'مدیریت معادن سنگ', icon: FaWarehouse, canView: inventoryPermissions?.mines.canView || false, canCreate: inventoryPermissions?.mines.canCreate || false, href: '/dashboard/inventory/master-data/mines' },
    { id: 'finish-types', title: 'نوع فرآوری', description: 'مدیریت نوع فرآوری سنگ', icon: FaCog, canView: inventoryPermissions?.finishTypes.canView || false, canCreate: inventoryPermissions?.finishTypes.canCreate || false, href: '/dashboard/inventory/master-data/finish-types' },
    { id: 'colors', title: 'رنگ/تم', description: 'مدیریت رنگ و تم سنگ', icon: FaCog, canView: inventoryPermissions?.colors.canView || false, canCreate: inventoryPermissions?.colors.canCreate || false, href: '/dashboard/inventory/master-data/colors' },
    { id: 'cutting-types', title: 'نوع ابزار', description: 'مدیریت انواع ابزار و برش‌های خدماتی', icon: FaCut, canView: inventoryPermissions?.cuttingTypes?.canView || false, canCreate: inventoryPermissions?.cuttingTypes?.canCreate || false, href: '/dashboard/inventory/master-data/cutting-types' },
  ];

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
      description="مدیریت داده‌های پایه سنگ، کاتالوگ محصولات، خدمات و مسیرهای عملیاتی انبار."
      metrics={metrics}
    >
      <ErpSection title="عملیات اصلی" description="ورود به بخش‌های اصلی انبار و سرویس‌ها با الگوی ERP جدید.">
        <ErpActionGrid
          columns={3}
          items={[
            {
              title: 'داده‌های پایه',
              description: 'تعریف مشخصات سنگ، برش، ضخامت، معدن، رنگ و فرآوری',
              href: hasAnyMasterDataPermission ? '/dashboard/inventory/master-data' : undefined,
              icon: FaCog,
              tone: 'warning',
              disabled: !hasAnyMasterDataPermission,
              meta: hasAnyMasterDataPermission ? 'قابل دسترسی' : 'بدون دسترسی',
            },
            { title: 'محصولات', description: 'مشاهده و مدیریت محصولات قابل استفاده در قراردادها', href: '/dashboard/sales/products', icon: FaBoxes, tone: 'primary', meta: 'کاتالوگ فروش' },
            { title: 'گردش موجودی', description: 'ثبت ورود، خروج و انتقال موجودی', icon: FaClipboardList, tone: 'info', disabled: true, meta: 'به‌زودی' },
            { title: 'خدمات', description: 'مدیریت خدمات، ابزارها و هزینه‌های وابسته', href: '/dashboard/inventory/services', icon: FaTools, tone: 'success' },
            { title: 'گزارش‌ها', description: 'گزارش‌های موجودی، محصولات و خدمات', icon: FaChartLine, tone: 'purple', disabled: true, meta: 'به‌زودی' },
          ]}
        />
      </ErpSection>

      {hasAnyMasterDataPermission ? (
        <ErpSection
          title="بخش‌های داده‌های پایه"
          description="نمای سریع از دسترسی شما به داده‌های پایه انبار."
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
