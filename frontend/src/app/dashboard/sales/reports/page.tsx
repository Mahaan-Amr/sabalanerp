'use client';

import React from 'react';
import { 
  FaChartLine, 
  FaFileContract, 
  FaDollarSign, 
  FaUsers, 
  FaCalendarAlt,
  FaDownload,
  FaPrint
} from 'react-icons/fa';

export default function SalesReportsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">گزارشات فروش</h1>
          <p className="text-gray-300">مشاهده آمار و گزارشات فروش</p>
        </div>

        {/* Report Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="glass-liquid-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">کل فروش ماه</p>
                <p className="text-2xl font-bold text-white">0 ریال</p>
              </div>
              <div className="glass-liquid-card p-3">
                <FaDollarSign className="h-6 w-6 text-green-400" />
              </div>
            </div>
          </div>

          <div className="glass-liquid-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">قراردادهای امضا شده</p>
                <p className="text-2xl font-bold text-white">0</p>
              </div>
              <div className="glass-liquid-card p-3">
                <FaFileContract className="h-6 w-6 text-blue-400" />
              </div>
            </div>
          </div>

          <div className="glass-liquid-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">مشتریان جدید</p>
                <p className="text-2xl font-bold text-white">0</p>
              </div>
              <div className="glass-liquid-card p-3">
                <FaUsers className="h-6 w-6 text-purple-400" />
              </div>
            </div>
          </div>

          <div className="glass-liquid-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">نرخ تکمیل</p>
                <p className="text-2xl font-bold text-white">0%</p>
              </div>
              <div className="glass-liquid-card p-3">
                <FaChartLine className="h-6 w-6 text-orange-400" />
              </div>
            </div>
          </div>
        </div>

        {/* Report Sections */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Sales Performance */}
          <div className="glass-liquid-card p-6">
            <h2 className="text-xl font-semibold text-white mb-4">عملکرد فروش</h2>
            <div className="text-center py-12">
              <FaChartLine className="mx-auto text-4xl text-gray-400 mb-4" />
              <p className="text-gray-400">گزارش عملکرد فروش در حال توسعه است</p>
            </div>
          </div>

          {/* Contract Status */}
          <div className="glass-liquid-card p-6">
            <h2 className="text-xl font-semibold text-white mb-4">وضعیت قراردادها</h2>
            <div className="text-center py-12">
              <FaFileContract className="mx-auto text-4xl text-gray-400 mb-4" />
              <p className="text-gray-400">گزارش وضعیت قراردادها در حال توسعه است</p>
            </div>
          </div>

          {/* Customer Analysis */}
          <div className="glass-liquid-card p-6">
            <h2 className="text-xl font-semibold text-white mb-4">تحلیل مشتریان</h2>
            <div className="text-center py-12">
              <FaUsers className="mx-auto text-4xl text-gray-400 mb-4" />
              <p className="text-gray-400">گزارش تحلیل مشتریان در حال توسعه است</p>
            </div>
          </div>

          {/* Export Options */}
          <div className="glass-liquid-card p-6">
            <h2 className="text-xl font-semibold text-white mb-4">گزینه‌های خروجی</h2>
            <div className="space-y-4">
              <button className="w-full glass-liquid-btn p-4 flex items-center gap-3 hover:bg-white/10 transition-all duration-200">
                <FaDownload className="h-5 w-5" />
                <span>دانلود گزارش Excel</span>
              </button>
              <button className="w-full glass-liquid-btn p-4 flex items-center gap-3 hover:bg-white/10 transition-all duration-200">
                <FaPrint className="h-5 w-5" />
                <span>چاپ گزارش</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
