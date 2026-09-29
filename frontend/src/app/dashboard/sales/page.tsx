'use client';
import { useEffect, useState } from 'react';
import {
  FaBox,
  FaChartLine,
  FaFileContract,
  FaPlus,
  FaUsers,
} from 'react-icons/fa';
import { ErpNeumorphicActionGrid, ErpWorkspacePage } from '@/components/erp';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace, WORKSPACE_PERMISSIONS, WORKSPACES } from '@/contexts/WorkspaceContext';
import { dashboardAPI } from '@/lib/api';

const baseSalesActions: Array<{
  title: string;
  href: string;
  icon: typeof FaFileContract;
}> = [
  {
    title: 'مشاهده قراردادها',
    href: '/dashboard/sales/contracts',
    icon: FaFileContract,
  },
  {
    title: 'ایجاد قرارداد جدید',
    href: '/dashboard/sales/contracts/create',
    icon: FaPlus,
  },
  {
    title: 'ایجاد مشتری',
    href: '/dashboard/crm/customers/create',
    icon: FaUsers,
  },
  {
    title: 'ایجاد محصول',
    href: '/dashboard/sales/products/create',
    icon: FaBox,
  },
  {
    title: 'گزارش فروش',
    href: '/dashboard/sales/reports',
    icon: FaChartLine,
  },
];

export default function SalesWorkspacePage() {
  const { user } = useAuth();
  const { hasPermission } = useWorkspace();
  const [canViewPartnerCases, setCanViewPartnerCases] = useState(false);
  useEffect(() => {
    let active = true;
    setCanViewPartnerCases(false);
    if (user) void dashboardAPI.getRouteAvailability('/dashboard/sales/partner-cases')
      .then(response => { if (active) setCanViewPartnerCases(response.data.data.allowed === true); })
      .catch(() => { if (active) setCanViewPartnerCases(false); });
    return () => { active = false; };
  }, [user?.id]);
  const canViewSellerComparisons = user?.role === 'ADMIN' || hasPermission(WORKSPACES.SALES, WORKSPACE_PERMISSIONS.ADMIN);
  const salesActions = [
    ...baseSalesActions,
    ...(canViewPartnerCases ? [{
      title: 'پیش‌نویس‌ها و پرونده‌های من',
      href: '/dashboard/sales/partner-cases',
      icon: FaFileContract,
    }] : []),
    ...(canViewSellerComparisons ? [{
      title: 'ثبت حسابداری فروشندگان',
      href: '/dashboard/sales/reports?view=accounting-registered&period=month',
      icon: FaChartLine,
    }] : []),
  ];

  return (
    <ErpWorkspacePage title="داشبورد فروش" className="sds-sales-dashboard-scope pb-24 lg:pb-2">
      <ErpNeumorphicActionGrid
        title="دسترسی سریع"
        showTitle={false}
        desktopColumns={5}
        items={salesActions.map((action) => ({
          id: action.href,
          title: action.title,
          href: action.href,
          icon: action.icon,
        }))}
      />
    </ErpWorkspacePage>
  );
}
