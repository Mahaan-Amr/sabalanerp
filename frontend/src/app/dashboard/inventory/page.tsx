'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { FaWarehouse, FaBoxes, FaClipboardList, FaChartLine, FaCog, FaPlus, FaTools, FaCut } from 'react-icons/fa';
import { dashboardAPI } from '@/lib/api';
import { getInventoryMasterDataPermissions } from '@/lib/permissions';

interface User {
  id: string;
  role: string;
  departmentId?: string;
  permissions?: {
    features: Array<{
      feature: string;
      permissionLevel: string;
      workspace: string;
    }>;
    workspaces: Array<{
      workspace: string;
      permissionLevel: string;
    }>;
  };
}

const InventoryDashboard: React.FC = () => {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [inventoryPermissions, setInventoryPermissions] = useState<any>(null);

  useEffect(() => {
    const loadUserProfile = async () => {
      try {
        const response = await dashboardAPI.getProfile();
        if (response.data.success) {
          setCurrentUser(response.data.data);
          setInventoryPermissions(getInventoryMasterDataPermissions(response.data.data));
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
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-600"></div>
      </div>
    );
  }

  const hasAnyMasterDataPermission = inventoryPermissions && (
    inventoryPermissions.cutTypes.canView ||
    inventoryPermissions.stoneMaterials.canView ||
    inventoryPermissions.cutWidths.canView ||
    inventoryPermissions.thicknesses.canView ||
    inventoryPermissions.mines.canView ||
    inventoryPermissions.finishTypes.canView ||
    inventoryPermissions.colors.canView
  );

  const masterDataSections = [
    {
      id: 'cut-types',
      title: 'نوع برش',
      titlePersian: 'نوع برش',
      description: 'مدیریت انواع برش سنگ (تایل، اسلب، حجیم، و...)',
      icon: FaCog,
      canView: inventoryPermissions?.cutTypes.canView || false,
      canCreate: inventoryPermissions?.cutTypes.canCreate || false,
      href: '/dashboard/inventory/master-data/cut-types'
    },
    {
      id: 'stone-materials',
      title: 'جنس سنگ',
      titlePersian: 'جنس سنگ',
      description: 'مدیریت جنس‌های مختلف سنگ (کریستال، مرمریت، گرانیت، و...)',
      icon: FaBoxes,
      canView: inventoryPermissions?.stoneMaterials.canView || false,
      canCreate: inventoryPermissions?.stoneMaterials.canCreate || false,
      href: '/dashboard/inventory/master-data/stone-materials'
    },
    {
      id: 'cut-widths',
      title: 'عرض برش',
      titlePersian: 'عرض برش',
      description: 'مدیریت عرض‌های مختلف برش (60 سانتی‌متر، 40 سانتی‌متر، و...)',
      icon: FaCog,
      canView: inventoryPermissions?.cutWidths.canView || false,
      canCreate: inventoryPermissions?.cutWidths.canCreate || false,
      href: '/dashboard/inventory/master-data/cut-widths'
    },
    {
      id: 'thicknesses',
      title: 'ضخامت',
      titlePersian: 'ضخامت',
      description: 'مدیریت ضخامت‌های مختلف (2 سانتی‌متر، 3 سانتی‌متر، و...)',
      icon: FaCog,
      canView: inventoryPermissions?.thicknesses.canView || false,
      canCreate: inventoryPermissions?.thicknesses.canCreate || false,
      href: '/dashboard/inventory/master-data/thicknesses'
    },
    {
      id: 'mines',
      title: 'معدن',
      titlePersian: 'معدن',
      description: 'مدیریت معادن مختلف (ازنا، نی ریز، الیگودرز، و...)',
      icon: FaWarehouse,
      canView: inventoryPermissions?.mines.canView || false,
      canCreate: inventoryPermissions?.mines.canCreate || false,
      href: '/dashboard/inventory/master-data/mines'
    },
    {
      id: 'finish-types',
      title: 'نوع پرداخت',
      titlePersian: 'نوع پرداخت',
      description: 'مدیریت انواع پرداخت (صیقل، سندبلاست، و...)',
      icon: FaCog,
      canView: inventoryPermissions?.finishTypes.canView || false,
      canCreate: inventoryPermissions?.finishTypes.canCreate || false,
      href: '/dashboard/inventory/master-data/finish-types'
    },
    {
      id: 'colors',
      title: 'رنگ/خصوصیات',
      titlePersian: 'رنگ/خصوصیات',
      description: 'مدیریت رنگ‌ها و خصوصیات (مشکی، سفید، و...)',
      icon: FaCog,
      canView: inventoryPermissions?.colors.canView || false,
      canCreate: inventoryPermissions?.colors.canCreate || false,
      href: '/dashboard/inventory/master-data/colors'
    },
    {
      id: 'cutting-types',
      title: 'انواع برش',
      titlePersian: 'انواع برش',
      description: 'مدیریت انواع برش (طولی، عرضی، و...)',
      icon: FaCut,
      canView: inventoryPermissions?.cuttingTypes?.canView || false,
      canCreate: inventoryPermissions?.cuttingTypes?.canCreate || false,
      href: '/dashboard/inventory/master-data/cutting-types'
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-200 mb-2">
            داشبورد موجودی
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            مدیریت موجودی و انبار - سبلان استون
          </p>
        </div>

        {/* Main Actions Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {/* Master Data Management */}
          <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-xl p-6 border border-slate-200/50 dark:border-slate-700/50 shadow-lg hover:shadow-xl transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3 space-x-reverse">
                <div className="p-3 bg-orange-100 dark:bg-orange-900/30 rounded-lg">
                  <FaCog className="w-6 h-6 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
                    کد کالا
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    مدیریت داده‌های پایه
                  </p>
                </div>
              </div>
            </div>
            
            <p className="text-slate-600 dark:text-slate-400 mb-4 text-sm">
              مدیریت انواع برش، جنس سنگ، ابعاد، معادن، نوع پرداخت و رنگ‌ها
            </p>
            
            {hasAnyMasterDataPermission ? (
              <button
                onClick={() => router.push('/dashboard/inventory/master-data')}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg transition-colors duration-200 flex items-center justify-center space-x-2 space-x-reverse"
              >
                <FaCog className="w-4 h-4" />
                <span>مدیریت داده‌های پایه</span>
              </button>
            ) : (
              <div className="w-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-4 py-2 rounded-lg text-center">
                دسترسی محدود
              </div>
            )}
          </div>

          {/* Products */}
          <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-xl p-6 border border-slate-200/50 dark:border-slate-700/50 shadow-lg hover:shadow-xl transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3 space-x-reverse">
                <div className="p-3 bg-teal-100 dark:bg-teal-900/30 rounded-lg">
                  <FaBoxes className="w-6 h-6 text-teal-600 dark:text-teal-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
                    محصولات
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    کاتالوگ محصولات
                  </p>
                </div>
              </div>
            </div>
            
            <p className="text-slate-600 dark:text-slate-400 mb-4 text-sm">
              مشاهده و مدیریت کاتالوگ کامل محصولات
            </p>
            
            <button
              onClick={() => router.push('/dashboard/sales/products')}
              className="w-full bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-lg transition-colors duration-200 flex items-center justify-center space-x-2 space-x-reverse"
            >
              <FaBoxes className="w-4 h-4" />
              <span>مشاهده محصولات</span>
            </button>
          </div>

          {/* Stock Movements */}
          <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-xl p-6 border border-slate-200/50 dark:border-slate-700/50 shadow-lg hover:shadow-xl transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3 space-x-reverse">
                <div className="p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                  <FaClipboardList className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
                    حرکات موجودی
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    ورود و خروج کالا
                  </p>
                </div>
              </div>
            </div>
            
            <p className="text-slate-600 dark:text-slate-400 mb-4 text-sm">
              ردیابی ورود و خروج کالا از انبار
            </p>
            
            <div className="w-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-4 py-2 rounded-lg text-center">
              در حال توسعه
            </div>
          </div>

          {/* Services */}
          <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-xl p-6 border border-slate-200/50 dark:border-slate-700/50 shadow-lg hover:shadow-xl transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3 space-x-reverse">
                <div className="p-3 bg-green-100 dark:bg-green-900/30 rounded-lg">
                  <FaTools className="w-6 h-6 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
                    خدمات
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    مدیریت خدمات برش
                  </p>
                </div>
              </div>
            </div>
            
            <p className="text-slate-600 dark:text-slate-400 mb-4 text-sm">
              مدیریت انواع خدمات برش و خدمات ارائه شده به مشتریان
            </p>
            
            <button
              onClick={() => router.push('/dashboard/inventory/services')}
              className="w-full bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition-colors duration-200 flex items-center justify-center space-x-2 space-x-reverse"
            >
              <FaTools className="w-4 h-4" />
              <span>مدیریت خدمات</span>
            </button>
          </div>

          {/* Reports */}
          <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-xl p-6 border border-slate-200/50 dark:border-slate-700/50 shadow-lg hover:shadow-xl transition-all duration-300">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3 space-x-reverse">
                <div className="p-3 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
                  <FaChartLine className="w-6 h-6 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
                    گزارشات موجودی
                  </h3>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    آمار و گزارشات
                  </p>
                </div>
              </div>
            </div>
            
            <p className="text-slate-600 dark:text-slate-400 mb-4 text-sm">
              گزارشات جامع از وضعیت موجودی
            </p>
            
            <div className="w-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 px-4 py-2 rounded-lg text-center">
              در حال توسعه
            </div>
          </div>
        </div>

        {/* Master Data Sections Preview */}
        {hasAnyMasterDataPermission && (
          <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-xl p-6 border border-slate-200/50 dark:border-slate-700/50 shadow-lg">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200">
                بخش‌های داده‌های پایه
              </h2>
              <button
                onClick={() => router.push('/dashboard/inventory/master-data')}
                className="text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 text-sm font-medium"
              >
                مشاهده همه
              </button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {masterDataSections.map((section) => {
                const IconComponent = section.icon;
                return (
                  <div
                    key={section.id}
                    className={`p-4 rounded-lg border transition-all duration-200 ${
                      section.canView
                        ? 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer'
                        : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 opacity-60'
                    }`}
                    onClick={() => section.canView && router.push(section.href)}
                  >
                    <div className="flex items-center space-x-3 space-x-reverse mb-2">
                      <IconComponent className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                      <h3 className="font-medium text-slate-800 dark:text-slate-200 text-sm">
                        {section.titlePersian}
                      </h3>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">
                      {section.description}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs px-2 py-1 rounded ${
                        section.canView
                          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                      }`}>
                        {section.canView ? 'دسترسی دارد' : 'بدون دسترسی'}
                      </span>
                      {section.canCreate && (
                        <FaPlus className="w-3 h-3 text-orange-500" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default InventoryDashboard;
