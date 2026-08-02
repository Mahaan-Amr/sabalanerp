'use client';
import {
  FaBox,
  FaChartLine,
  FaFileContract,
  FaPlus,
  FaUsers,
} from 'react-icons/fa';
import { ErpNeumorphicActionGrid, ErpWorkspacePage } from '@/components/erp';

const salesActions: Array<{
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
