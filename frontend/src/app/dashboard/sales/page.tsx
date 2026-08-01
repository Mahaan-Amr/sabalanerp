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
  description: string;
  href: string;
  icon: typeof FaFileContract;
}> = [
  {
    title: 'مشاهده قراردادها',
    description: 'لیست قراردادها، وضعیت امضا، چاپ و تایید',
    href: '/dashboard/sales/contracts',
    icon: FaFileContract,
  },
  {
    title: 'ایجاد قرارداد جدید',
    description: 'شروع ثبت قرارداد با جریان موبایل‌فرست',
    href: '/dashboard/sales/contracts/create',
    icon: FaPlus,
  },
  {
    title: 'ایجاد مشتری',
    description: 'ثبت مشتری جدید و تکمیل اطلاعات CRM',
    href: '/dashboard/crm/customers/create',
    icon: FaUsers,
  },
  {
    title: 'ایجاد محصول',
    description: 'افزودن سنگ، ابعاد و قیمت پایه فروش',
    href: '/dashboard/sales/products/create',
    icon: FaBox,
  },
  {
    title: 'گزارش فروش',
    description: 'مرور عملکرد و وضعیت قراردادهای فروش',
    href: '/dashboard/sales/reports',
    icon: FaChartLine,
  },
];

export default function SalesWorkspacePage() {
  return (
    <ErpWorkspacePage title="داشبورد فروش" className="pb-24 lg:pb-2">
      <ErpNeumorphicActionGrid
        title="دسترسی سریع"
        desktopColumns={5}
        items={salesActions.map((action) => ({
          id: action.href,
          title: action.title,
          description: action.description,
          href: action.href,
          icon: action.icon,
        }))}
      />
    </ErpWorkspacePage>
  );
}
