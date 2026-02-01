'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Product } from '@/types/product';
import { salesAPI, dashboardAPI } from '@/lib/api';
import { canDeleteProducts, canCreateProducts, canEditProducts, canImportProducts, canExportProducts, User as PermissionUser } from '@/lib/permissions';
import { FaTrash, FaEdit, FaEye, FaPlus, FaTh, FaList, FaToggleOn, FaToggleOff, FaEyeSlash, FaFileExcel } from 'react-icons/fa';
import Link from 'next/link';
import SuccessModal from '@/components/SuccessModal';
import ErrorModal from '@/components/ErrorModal';
import ProductImportExportModal from '@/components/ProductImportExportModal';
import EnhancedDropdown, { DropdownOption } from '@/components/EnhancedDropdown';
import { formatPrice, formatDimensions } from '@/lib/numberFormat';

// Product name generation utilities
const generateFullProductName = (product: Product): string => {
  const parts = [
    product.stoneTypeNamePersian,
    product.cuttingDimensionNamePersian,
    `عرض ${product.widthValue}×ضخامت ${product.thicknessValue}cm`,
    product.mineNamePersian,
    product.finishNamePersian,
    product.colorNamePersian,
    product.qualityNamePersian
  ].filter(part => part && part.trim() !== '');
  
  return parts.join(' - ');
};

const ProductsPage: React.FC = () => {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterMine, setFilterMine] = useState('all');
  const [filterFinish, setFilterFinish] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showDeleted, setShowDeleted] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalProducts, setTotalProducts] = useState(0);
  const [currentUser, setCurrentUser] = useState<PermissionUser | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ show: boolean; product: Product | null }>({ show: false, product: null });
  const [deleting, setDeleting] = useState(false);
  
  // Modal state
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [modalMessage, setModalMessage] = useState('');
  const [modalDetails, setModalDetails] = useState('');
  
  // View toggle state
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('table');
  
  // Import/Export modal state
  const [showImportExportModal, setShowImportExportModal] = useState(false);
  
  const itemsPerPage = 20;

  // Fetch products and user
  useEffect(() => {
    fetchProducts();
    loadCurrentUser();
  }, [currentPage, searchTerm, filterType, filterMine, filterFinish, filterStatus, showDeleted]);

  const loadCurrentUser = async () => {
    try {
      const response = await dashboardAPI.getProfile();
      if (response.data.success) {
        setCurrentUser(response.data.data);
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  };

  const fetchProducts = async () => {
    try {
      console.log('Fetching products...', { showDeleted, currentPage });
      setLoading(true);
      
      // Build server-side pagination parameters
      const params: any = {
        page: currentPage,
        limit: itemsPerPage
      };
      
      if (showDeleted) {
        params.includeDeleted = true;
      }
      
      // Add search parameter if there's a search term
      if (searchTerm) {
        params.search = searchTerm;
      }
      
      // Add filter parameters
      if (filterType !== 'all') {
        params.stoneType = filterType;
      }
      if (filterMine !== 'all') {
        params.mine = filterMine;
      }
      if (filterFinish !== 'all') {
        params.finish = filterFinish;
      }
      if (filterStatus !== 'all') {
        params.isActive = filterStatus === 'active';
      }
      
      const response = await salesAPI.getProducts(params);
      console.log('Products fetch response:', response.data);

      if (response.data.success) {
        const productsData = response.data.data || [];
        const pagination = response.data.pagination || {};
        
        console.log('Setting products:', productsData);
        console.log('Pagination info:', pagination);
        
        setProducts(productsData);
        setTotalPages(pagination.pages || 1);
        setTotalProducts(pagination.total || 0);
      } else {
        console.error('Failed to fetch products');
      }
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      setLoading(false);
    }
  };

  // No client-side filtering needed - server handles all filtering
  const paginatedProducts = products;

  // Get unique values for filters
  const stoneTypes = Array.from(new Set(products.map(p => p.stoneTypeNamePersian)));
  const mines = Array.from(new Set(products.map(p => p.mineNamePersian)));
  const finishes = Array.from(new Set(products.map(p => p.finishNamePersian)));

  // Filter change handlers that reset to page 1
  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const handleFilterTypeChange = (value: string) => {
    setFilterType(value);
    setCurrentPage(1);
  };

  const handleFilterMineChange = (value: string) => {
    setFilterMine(value);
    setCurrentPage(1);
  };

  const handleFilterFinishChange = (value: string) => {
    setFilterFinish(value);
    setCurrentPage(1);
  };

  const handleFilterStatusChange = (value: string) => {
    setFilterStatus(value);
    setCurrentPage(1);
  };

  const handleProductClick = (productId: string) => {
    router.push(`/dashboard/sales/products/${productId}`);
  };

  const handleDeleteClick = (product: Product, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent event bubbling to parent card
    setDeleteConfirm({ show: true, product });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm.product) return;

    try {
      setDeleting(true);
      const response = await salesAPI.deleteProduct(deleteConfirm.product.id);
      
      if (response.data.success) {
        setModalMessage('محصول با موفقیت حذف شد');
        setShowSuccessModal(true);
        setDeleteConfirm({ show: false, product: null });
        fetchProducts(); // Refresh the list
      } else {
        setModalMessage('خطا در حذف محصول');
        setModalDetails(response.data.error);
        setShowErrorModal(true);
      }
    } catch (error: any) {
      console.error('Error deleting product:', error);
      if (error.response?.data?.error) {
        setModalMessage('خطا در حذف محصول');
        setModalDetails(error.response.data.error);
        setShowErrorModal(true);
      } else {
        setModalMessage('خطا در حذف محصول');
        setModalDetails('خطای غیرمنتظره رخ داده است');
        setShowErrorModal(true);
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteConfirm({ show: false, product: null });
  };

  const handleToggleStatus = async (product: Product) => {
    console.log('Toggle status clicked for product:', product.namePersian, 'Current isActive:', product.isActive);
    console.log('User permissions:', currentUser?.permissions);
    console.log('Can edit products:', canEditProducts(currentUser));
    
    if (!canEditProducts(currentUser)) {
      console.log('User does not have edit permissions');
      return;
    }

    setDeleting(true);
    try {
      const updateData = { isActive: !product.isActive };
      console.log('Sending update request:', updateData);
      
      const response = await salesAPI.updateProduct(product.id, updateData);
      console.log('Update response:', response.data);
      
      if (response.data.success) {
        setModalMessage(`وضعیت ${product.namePersian} با موفقیت تغییر کرد`);
        setShowSuccessModal(true);
        fetchProducts(); // Refresh the list
      } else {
        setModalMessage('خطا در تغییر وضعیت');
        setModalDetails(response.data.error || 'خطای غیرمنتظره رخ داده است');
        setShowErrorModal(true);
      }
    } catch (error: any) {
      console.error('Error toggling status:', error);
      setModalMessage('خطا در تغییر وضعیت');
      setModalDetails(error.response?.data?.error || 'خطای غیرمنتظره رخ داده است');
      setShowErrorModal(true);
    } finally {
      setDeleting(false);
    }
  };

  // Using centralized formatPrice from numberFormat utility

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-200 mb-2">
                کاتالوگ محصولات
              </h1>
              <p className="text-slate-600 dark:text-slate-400">
                مدیریت و مشاهده تمام محصولات موجود در سیستم
              </p>
            </div>
            
            {/* Action Buttons */}
            <div className="flex items-center gap-3">
              {/* Import/Export Button */}
              {(canImportProducts(currentUser) || canExportProducts(currentUser)) && (
                <button
                  onClick={() => setShowImportExportModal(true)}
                  className="glass-liquid-btn-secondary px-4 py-3 text-slate-700 dark:text-slate-300 font-medium hover:scale-105 transition-all duration-200 flex items-center gap-2"
                >
                  <FaFileExcel className="w-4 h-4" />
                  <span>وارد/صادر کردن</span>
                </button>
              )}
              
              {/* Create Product Button */}
              {canCreateProducts(currentUser) && (
                <Link href="/dashboard/sales/products/create">
                  <button className="glass-liquid-btn-primary px-6 py-3 text-white font-medium hover:scale-105 transition-all duration-200 flex items-center gap-2">
                    <FaPlus className="w-4 h-4" />
                    <span>ایجاد محصول جدید</span>
                  </button>
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Filters and View Toggle */}
        <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-2xl p-6 mb-6 border border-white/20 dark:border-slate-700/50">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 flex-1">
              {/* Search */}
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  جستجو
                </label>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="جستجو در نام، کد یا توضیحات..."
                  className="w-full px-4 py-2 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>

              {/* Stone Type Filter */}
              <div>
                <EnhancedDropdown
                  label="نوع سنگ"
                  value={filterType}
                  onChange={handleFilterTypeChange}
                  placeholder="همه انواع"
                  options={[
                    { value: 'all', label: 'همه انواع' },
                    ...stoneTypes.map(type => ({ value: type, label: type }))
                  ]}
                  searchable={true}
                  clearable={false}
                />
              </div>

              {/* Mine Filter */}
              <div>
                <EnhancedDropdown
                  label="معدن"
                  value={filterMine}
                  onChange={handleFilterMineChange}
                  placeholder="همه معادن"
                  options={[
                    { value: 'all', label: 'همه معادن' },
                    ...mines.map(mine => ({ value: mine, label: mine }))
                  ]}
                  searchable={true}
                  clearable={false}
                />
              </div>

              {/* Finish Filter */}
              <div>
                <EnhancedDropdown
                  label="نوع پرداخت"
                  value={filterFinish}
                  onChange={handleFilterFinishChange}
                  placeholder="همه انواع"
                  options={[
                    { value: 'all', label: 'همه انواع' },
                    ...finishes.map(finish => ({ value: finish, label: finish }))
                  ]}
                  searchable={true}
                  clearable={false}
                />
              </div>

              {/* Status Filter */}
              <div>
                <EnhancedDropdown
                  label="وضعیت"
                  value={filterStatus}
                  onChange={handleFilterStatusChange}
                  placeholder="همه وضعیت‌ها"
                  options={[
                    { value: 'all', label: 'همه وضعیت‌ها' },
                    { value: 'active', label: 'فعال' },
                    { value: 'inactive', label: 'غیرفعال' }
                  ]}
                  searchable={false}
                  clearable={false}
                />
              </div>
            </div>

            {/* View Toggle and Options */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              {/* Show Deleted Toggle */}
              {currentUser?.role === 'ADMIN' && (
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    حذف شده‌ها:
                  </label>
                  <div className="flex bg-slate-100 dark:bg-slate-700 rounded-lg p-1 shadow-sm">
                    <button
                      onClick={() => setShowDeleted(false)}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${
                        !showDeleted
                          ? 'bg-white dark:bg-slate-600 text-teal-600 dark:text-teal-400 shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                      }`}
                      title="مخفی کردن محصولات حذف شده"
                    >
                      <FaEyeSlash className="w-3 h-3" />
                      مخفی
                    </button>
                    <button
                      onClick={() => setShowDeleted(true)}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-colors flex items-center gap-1 ${
                        showDeleted
                          ? 'bg-white dark:bg-slate-600 text-teal-600 dark:text-teal-400 shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                      }`}
                      title="نمایش محصولات حذف شده"
                    >
                      <FaEye className="w-3 h-3" />
                      نمایش
                    </button>
                  </div>
                </div>
              )}
              
              {/* View Toggle */}
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
                  نمایش:
                </label>
                <div className="flex bg-slate-100 dark:bg-slate-700 rounded-lg p-1 shadow-sm">
                  <button
                    onClick={() => setViewMode('grid')}
                    className={`p-2 rounded-md transition-colors ${
                      viewMode === 'grid'
                        ? 'bg-white dark:bg-slate-600 text-teal-600 dark:text-teal-400 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                    title="نمایش شبکه‌ای"
                  >
                    <FaTh className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setViewMode('table')}
                    className={`p-2 rounded-md transition-colors ${
                      viewMode === 'table'
                        ? 'bg-white dark:bg-slate-600 text-teal-600 dark:text-teal-400 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                    title="نمایش جدولی"
                  >
                    <FaList className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Products Display */}
        {viewMode === 'grid' ? (
          /* Grid View */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {paginatedProducts.map((product) => (
              <div
                key={product.id}
                onClick={() => handleProductClick(product.id)}
                className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-2xl p-6 border border-white/20 dark:border-slate-700/50 hover:shadow-lg hover:scale-105 transition-all duration-300 cursor-pointer group"
              >
                {/* Full Product Name */}
                <div className="text-sm text-slate-700 dark:text-slate-300 mb-2 font-medium leading-relaxed">
                  {generateFullProductName(product)}
                </div>

                {/* Product Name */}
                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-3 group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors">
                  {product.namePersian}
                </h3>

                {/* Product Details */}
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-400">ابعاد:</span>
                    <span className="text-slate-800 dark:text-slate-200 font-medium">
                      {formatDimensions(product.widthValue, product.thicknessValue, 'سانتی‌متر')}
                    </span>
                  </div>
                  
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-400">معدن:</span>
                    <span className="text-slate-800 dark:text-slate-200 font-medium">
                      {product.mineNamePersian}
                    </span>
                  </div>
                  
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-400">پرداخت:</span>
                    <span className="text-slate-800 dark:text-slate-200 font-medium">
                      {product.finishNamePersian}
                    </span>
                  </div>
                  
                  <div className="flex justify-between">
                    <span className="text-slate-600 dark:text-slate-400">قیمت:</span>
                    <span className="text-slate-800 dark:text-slate-200 font-medium">
                      {formatPrice(product.basePrice)}
                    </span>
                  </div>
                </div>

                {/* Status Badge and Actions */}
                <div className="mt-4 flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      product.isAvailable 
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                    }`}>
                      {product.isAvailable ? 'موجود' : 'ناموجود'}
                    </span>
                    
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                      product.isActive 
                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                        : 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
                    }`}>
                      {product.isActive ? 'فعال' : 'غیرفعال'}
                    </span>
                    
                    {product.deletedAt && (
                      <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                        حذف شده
                      </span>
                    )}
                    
                    {canEditProducts(currentUser) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleStatus(product);
                        }}
                        className={`p-1 transition-colors ${
                          product.isActive
                            ? 'text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300'
                            : 'text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300'
                        }`}
                        title={product.isActive ? 'غیرفعال کردن' : 'فعال کردن'}
                        disabled={deleting}
                      >
                        {product.isActive ? (
                          <FaToggleOn className="w-4 h-4" />
                        ) : (
                          <FaToggleOff className="w-4 h-4" />
                        )}
                      </button>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-2">
                    {product.leadTime && (
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        {product.leadTime} روز
                      </span>
                    )}
                    
                    {/* Action Buttons */}
                    <div className="flex gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation(); // Prevent event bubbling to parent card
                          handleProductClick(product.id);
                        }}
                        className="p-1.5 text-slate-500 hover:text-teal-600 dark:text-slate-400 dark:hover:text-teal-400 transition-colors"
                        title="مشاهده جزئیات"
                      >
                        <FaEye className="w-3 h-3" />
                      </button>
                      
                      {canDeleteProducts(currentUser) && (
                        <button
                          onClick={(e) => handleDeleteClick(product, e)}
                          className="p-1.5 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 transition-colors"
                          title="حذف محصول"
                        >
                          <FaTrash className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Table View */
          <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-2xl border border-white/20 dark:border-slate-700/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 dark:bg-slate-700/50">
                  <tr>
                    <th className="text-right py-4 px-6 font-medium text-slate-800 dark:text-slate-200">نام کامل محصول</th>
                    <th className="text-right py-4 px-6 font-medium text-slate-800 dark:text-slate-200">نام محصول</th>
                    <th className="text-right py-4 px-6 font-medium text-slate-800 dark:text-slate-200">ابعاد</th>
                    <th className="text-right py-4 px-6 font-medium text-slate-800 dark:text-slate-200">معدن</th>
                    <th className="text-right py-4 px-6 font-medium text-slate-800 dark:text-slate-200">پرداخت</th>
                    <th className="text-right py-4 px-6 font-medium text-slate-800 dark:text-slate-200">قیمت</th>
                    <th className="text-right py-4 px-6 font-medium text-slate-800 dark:text-slate-200">وضعیت</th>
                    <th className="text-right py-4 px-6 font-medium text-slate-800 dark:text-slate-200">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedProducts.map((product) => (
                    <tr 
                      key={product.id} 
                      className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
                      onClick={() => handleProductClick(product.id)}
                    >
                      <td className="py-4 px-6">
                        <div className="text-sm text-slate-700 dark:text-slate-300 font-medium leading-relaxed">
                          {generateFullProductName(product)}
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <div className="font-medium text-slate-800 dark:text-slate-200">
                          {product.namePersian}
                        </div>
                        {product.name && (
                          <div className="text-sm text-slate-600 dark:text-slate-400">
                            {product.name}
                          </div>
                        )}
                      </td>
                      <td className="py-4 px-6 text-slate-800 dark:text-slate-200">
                        {formatDimensions(product.widthValue, product.thicknessValue, 'سانتی‌متر')}
                      </td>
                      <td className="py-4 px-6 text-slate-800 dark:text-slate-200">
                        {product.mineNamePersian}
                      </td>
                      <td className="py-4 px-6 text-slate-800 dark:text-slate-200">
                        {product.finishNamePersian}
                      </td>
                      <td className="py-4 px-6 text-slate-800 dark:text-slate-200">
                        {formatPrice(product.basePrice)}
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-2">
                          <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                            product.isAvailable 
                              ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                          }`}>
                            {product.isAvailable ? 'موجود' : 'ناموجود'}
                          </span>
                          
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            product.isActive 
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
                              : 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
                          }`}>
                            {product.isActive ? 'فعال' : 'غیرفعال'}
                          </span>
                          
                          {product.deletedAt && (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                              حذف شده
                            </span>
                          )}
                          
                          {canEditProducts(currentUser) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleStatus(product);
                              }}
                              className={`p-1 transition-colors ${
                                product.isActive
                                  ? 'text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300'
                                  : 'text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300'
                              }`}
                              title={product.isActive ? 'غیرفعال کردن' : 'فعال کردن'}
                              disabled={deleting}
                            >
                              {product.isActive ? (
                                <FaToggleOn className="w-4 h-4" />
                              ) : (
                                <FaToggleOff className="w-4 h-4" />
                              )}
                            </button>
                          )}
                          
                          {product.leadTime && (
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {product.leadTime} روز
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleProductClick(product.id);
                            }}
                            className="p-2 text-slate-500 hover:text-teal-600 dark:text-slate-400 dark:hover:text-teal-400 transition-colors"
                            title="مشاهده جزئیات"
                          >
                            <FaEye className="w-4 h-4" />
                          </button>
                          
                          {canDeleteProducts(currentUser) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteClick(product, e);
                              }}
                              className="p-2 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 transition-colors"
                              title="حذف محصول"
                            >
                              <FaTrash className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-8 flex justify-center">
            <div className="flex items-center space-x-1 space-x-reverse">
              {/* Previous Button */}
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="px-3 py-2 bg-white/70 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm"
              >
                قبلی
              </button>
              
              {/* Smart Pagination Logic */}
              {totalPages <= 7 ? (
                // Show all pages if 7 or fewer
                Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`px-3 py-2 rounded-lg transition-colors text-sm ${
                      currentPage === page
                        ? 'bg-teal-500 text-white'
                        : 'bg-white/70 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    {page}
                  </button>
                ))
              ) : (
                // Smart pagination for more than 7 pages
                <>
                  {/* First Page */}
                  {currentPage > 3 && (
                    <>
                      <button
                        onClick={() => setCurrentPage(1)}
                        className="px-3 py-2 bg-white/70 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm"
                      >
                        1
                      </button>
                      {currentPage > 4 && (
                        <span className="px-2 text-slate-500 dark:text-slate-400">...</span>
                      )}
                    </>
                  )}
                  
                  {/* Page Numbers Around Current Page */}
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter(page => {
                      // Show pages around current page (2 pages before and after)
                      return page >= Math.max(1, currentPage - 2) && 
                             page <= Math.min(totalPages, currentPage + 2);
                    })
                    .map(page => (
                      <button
                        key={page}
                        onClick={() => setCurrentPage(page)}
                        className={`px-3 py-2 rounded-lg transition-colors text-sm ${
                          currentPage === page
                            ? 'bg-teal-500 text-white'
                            : 'bg-white/70 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700'
                        }`}
                      >
                        {page}
                      </button>
                    ))}
                  
                  {/* Last Page */}
                  {currentPage < totalPages - 2 && (
                    <>
                      {currentPage < totalPages - 3 && (
                        <span className="px-2 text-slate-500 dark:text-slate-400">...</span>
                      )}
                      <button
                        onClick={() => setCurrentPage(totalPages)}
                        className="px-3 py-2 bg-white/70 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm"
                      >
                        {totalPages}
                      </button>
                    </>
                  )}
                </>
              )}
              
              {/* Next Button */}
              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="px-3 py-2 bg-white/70 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-600 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors text-sm"
              >
                بعدی
              </button>
            </div>
          </div>
        )}

        {/* Results Summary */}
        <div className="mt-6 text-center text-slate-600 dark:text-slate-400">
          نمایش {((currentPage - 1) * itemsPerPage) + 1} تا {Math.min(currentPage * itemsPerPage, totalProducts)} از {totalProducts} محصول
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      {deleteConfirm.show && deleteConfirm.product && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-4">
              تأیید حذف محصول
            </h3>
            
            <p className="text-slate-600 dark:text-slate-400 mb-6">
              آیا مطمئن هستید که می‌خواهید محصول{' '}
              <span className="font-medium text-slate-800 dark:text-slate-200">
                {deleteConfirm.product.namePersian}
              </span>{' '}
              را حذف کنید؟
            </p>
            
            <p className="text-sm text-amber-600 dark:text-amber-400 mb-6">
              ⚠️ این عمل قابل بازگشت نیست. اگر محصول در قراردادها یا تحویل‌ها استفاده شده باشد، حذف آن امکان‌پذیر نخواهد بود.
            </p>
            
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleDeleteCancel}
                disabled={deleting}
                className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors disabled:opacity-50"
              >
                انصراف
              </button>
              
              <button
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {deleting ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    در حال حذف...
                  </>
                ) : (
                  <>
                    <FaTrash className="w-4 h-4" />
                    حذف محصول
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Modal */}
      <SuccessModal
        isOpen={showSuccessModal}
        onClose={() => setShowSuccessModal(false)}
        title="عملیات موفق"
        message={modalMessage}
        buttonText="باشه"
        autoClose={true}
        autoCloseDelay={2000}
      />

      {/* Error Modal */}
      <ErrorModal
        isOpen={showErrorModal}
        onClose={() => setShowErrorModal(false)}
        title="خطا"
        message={modalMessage}
        details={modalDetails}
        buttonText="باشه"
      />

      {/* Import/Export Modal */}
      <ProductImportExportModal
        isOpen={showImportExportModal}
        onClose={() => setShowImportExportModal(false)}
        onImportComplete={(results) => {
          // Refresh products list after successful import
          fetchProducts();
          setShowSuccessModal(true);
          setModalMessage('محصولات با موفقیت وارد شدند');
          setModalDetails(`${results.success} محصول موفق و ${results.failed} محصول ناموفق`);
        }}
        currentFilters={{
          search: searchTerm,
          stoneType: filterType !== 'all' ? filterType : undefined,
          mine: filterMine !== 'all' ? filterMine : undefined,
          finish: filterFinish !== 'all' ? filterFinish : undefined,
          isActive: filterStatus !== 'all' ? filterStatus === 'active' : undefined,
          includeDeleted: showDeleted
        }}
        currentUser={currentUser}
      />
    </div>
  );
};

export default ProductsPage;
