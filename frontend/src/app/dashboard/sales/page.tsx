'use client';

import Link from 'next/link';
import { 
  FaFileContract, 
  FaUsers, 
  FaChartLine, 
  FaPlus,
  FaHandshake,
  FaBox
} from 'react-icons/fa';

export default function SalesWorkspacePage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-white mb-4">فضای کاری فروش</h1>
          <p className="text-gray-300 text-lg">انتخاب عملیات مورد نظر خود</p>
        </div>

        {/* 5 Main Action Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
          {/* 1. مشاهده سفارشات (View Orders) */}
          <Link 
            href="/dashboard/sales/contracts" 
            className="glass-liquid-card p-8 text-center hover:bg-teal-500/20 transition-all duration-300 group"
          >
            <div className="glass-liquid-card p-6 mb-6 mx-auto w-fit group-hover:scale-110 transition-transform duration-300">
              <FaFileContract className="h-12 w-12 text-teal-400" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">مشاهده سفارشات</h3>
            <p className="text-gray-400 text-sm">مشاهده تمام سفارشات و قراردادها</p>
          </Link>

          {/* 2. ثبت سفارش جدید (Create New Order) */}
          <Link 
            href="/dashboard/sales/contracts/create" 
            className="glass-liquid-card p-8 text-center hover:bg-green-500/20 transition-all duration-300 group"
          >
            <div className="glass-liquid-card p-6 mb-6 mx-auto w-fit group-hover:scale-110 transition-transform duration-300">
              <FaPlus className="h-12 w-12 text-green-400" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">ثبت سفارش جدید</h3>
            <p className="text-gray-400 text-sm">ایجاد سفارش و قرارداد جدید</p>
          </Link>

          {/* 3. تعریف مشتری (Create New Client) */}
          <Link 
            href="/dashboard/crm/customers/create" 
            className="glass-liquid-card p-8 text-center hover:bg-blue-500/20 transition-all duration-300 group"
          >
            <div className="glass-liquid-card p-6 mb-6 mx-auto w-fit group-hover:scale-110 transition-transform duration-300">
              <FaUsers className="h-12 w-12 text-blue-400" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">تعریف مشتری</h3>
            <p className="text-gray-400 text-sm">افزودن مشتری جدید به سیستم</p>
          </Link>

          {/* 4. تعریف کالا (Create New Product) */}
          <Link 
            href="/dashboard/sales/products/create" 
            className="glass-liquid-card p-8 text-center hover:bg-purple-500/20 transition-all duration-300 group"
          >
            <div className="glass-liquid-card p-6 mb-6 mx-auto w-fit group-hover:scale-110 transition-transform duration-300">
              <FaBox className="h-12 w-12 text-purple-400" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">تعریف کالا</h3>
            <p className="text-gray-400 text-sm">افزودن محصول جدید به کاتالوگ</p>
          </Link>

          {/* 5. گزارشات فروش (Sales Reports) */}
          <Link 
            href="/dashboard/sales/reports" 
            className="glass-liquid-card p-8 text-center hover:bg-orange-500/20 transition-all duration-300 group"
          >
            <div className="glass-liquid-card p-6 mb-6 mx-auto w-fit group-hover:scale-110 transition-transform duration-300">
              <FaChartLine className="h-12 w-12 text-orange-400" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">گزارشات فروش</h3>
            <p className="text-gray-400 text-sm">مشاهده آمار و گزارشات فروش</p>
          </Link>
        </div>
      </div>
    </div>
  );
}
