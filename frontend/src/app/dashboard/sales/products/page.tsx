'use client';

import React, { useEffect, useState } from 'react';
import { FaBoxes, FaEye, FaEyeSlash, FaFileExcel, FaPlus, FaToggleOff, FaToggleOn, FaTrash } from 'react-icons/fa';
import { Product } from '@/types/product';
import { dashboardAPI, salesAPI } from '@/lib/api';
import { canCreateProducts, canDeleteProducts, canEditProducts, canExportProducts, canImportProducts, User as PermissionUser } from '@/lib/permissions';
import { formatDimensions, formatPrice } from '@/lib/numberFormat';
import EnhancedDropdown from '@/components/EnhancedDropdown';
import ErrorModal from '@/components/ErrorModal';
import ProductImportExportModal from '@/components/ProductImportExportModal';
import SuccessModal from '@/components/SuccessModal';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpListPage, ErpLoading, ErpPagination, ErpToolbar } from '@/components/erp';

const generateFullProductName = (product: Product): string => {
  const parts = [
    product.stoneTypeNamePersian,
    product.cuttingDimensionNamePersian,
    `عرض ${product.widthValue}×ضخامت ${product.thicknessValue}cm`,
    product.mineNamePersian,
    product.finishNamePersian,
    product.colorNamePersian,
    product.qualityNamePersian,
  ].filter((part) => part && part.trim() !== '');

  return parts.join(' - ');
};

export default function ProductsPage() {
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
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [modalMessage, setModalMessage] = useState('');
  const [modalDetails, setModalDetails] = useState('');
  const [showImportExportModal, setShowImportExportModal] = useState(false);

  const itemsPerPage = 20;

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
      setLoading(true);
      const params: any = { page: currentPage, limit: itemsPerPage };
      if (showDeleted) params.includeDeleted = true;
      if (searchTerm) params.search = searchTerm;
      if (filterType !== 'all') params.stoneType = filterType;
      if (filterMine !== 'all') params.mine = filterMine;
      if (filterFinish !== 'all') params.finish = filterFinish;
      if (filterStatus !== 'all') params.isActive = filterStatus === 'active';

      const response = await salesAPI.getProducts(params);
      if (response.data.success) {
        const pagination = response.data.pagination || {};
        setProducts(response.data.data || []);
        setTotalPages(pagination.pages || 1);
        setTotalProducts(pagination.total || 0);
      }
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      setLoading(false);
    }
  };

  const stoneTypes = Array.from(new Set(products.map((product) => product.stoneTypeNamePersian).filter(Boolean)));
  const mines = Array.from(new Set(products.map((product) => product.mineNamePersian).filter(Boolean)));
  const finishes = Array.from(new Set(products.map((product) => product.finishNamePersian).filter(Boolean)));

  const resetToFirstPage = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setCurrentPage(1);
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
        fetchProducts();
      } else {
        setModalMessage('خطا در حذف محصول');
        setModalDetails(response.data.error);
        setShowErrorModal(true);
      }
    } catch (error: any) {
      console.error('Error deleting product:', error);
      setModalMessage('خطا در حذف محصول');
      setModalDetails(error.response?.data?.error || 'خطای غیرمنتظره رخ داده است');
      setShowErrorModal(true);
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleStatus = async (product: Product) => {
    if (!canEditProducts(currentUser)) return;

    setDeleting(true);
    try {
      const response = await salesAPI.updateProduct(product.id, { isActive: !product.isActive });
      if (response.data.success) {
        setModalMessage(`وضعیت ${product.namePersian} با موفقیت تغییر کرد`);
        setShowSuccessModal(true);
        fetchProducts();
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

  if (loading && products.length === 0) {
    return <ErpLoading />;
  }

  return (
    <>
      <ErpListPage
        eyebrow="فروش"
        title="کاتالوگ محصولات"
        description="مدیریت محصولات قابل استفاده در قراردادها با فیلترهای عملیاتی، وضعیت موجودی و خروجی اکسل."
        actions={[
          ...(canImportProducts(currentUser) || canExportProducts(currentUser)
            ? [{ label: 'وارد/صادر کردن', icon: FaFileExcel, tone: 'neutral' as const, variant: 'outline' as const, onClick: () => setShowImportExportModal(true) }]
            : []),
          ...(canCreateProducts(currentUser)
            ? [{ label: 'ایجاد محصول جدید', href: '/dashboard/sales/products/create', icon: FaPlus, tone: 'primary' as const, variant: 'solid' as const }]
            : []),
        ]}
        metrics={[
          { label: 'کل محصولات', value: totalProducts.toLocaleString('fa-IR'), icon: FaBoxes, tone: 'primary' },
          { label: 'صفحه جاری', value: products.length.toLocaleString('fa-IR'), icon: FaEye, tone: 'info' },
          { label: 'فعال', value: products.filter((product) => product.isActive).length.toLocaleString('fa-IR'), icon: FaToggleOn, tone: 'success' },
          { label: 'غیرفعال', value: products.filter((product) => !product.isActive).length.toLocaleString('fa-IR'), icon: FaToggleOff, tone: 'warning' },
        ]}
        rows={products}
        rowKey={(product) => product.id}
        isLoading={loading}
        columns={[
          {
            id: 'product',
            header: 'محصول',
            priority: 'primary',
            cell: (product) => (
              <div className="min-w-0">
                <p className="font-semibold text-slate-900 dark:text-white">{product.namePersian}</p>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{generateFullProductName(product)}</p>
              </div>
            ),
          },
          { id: 'dimensions', header: 'ابعاد', mobileLabel: 'ابعاد', cell: (product) => formatDimensions(product.widthValue, product.thicknessValue, 'سانتی‌متر') },
          { id: 'mine', header: 'معدن', mobileLabel: 'معدن', cell: (product) => product.mineNamePersian || '-' },
          { id: 'finish', header: 'پرداخت', mobileLabel: 'پرداخت', cell: (product) => product.finishNamePersian || '-' },
          { id: 'price', header: 'قیمت', mobileLabel: 'قیمت', align: 'end', cell: (product) => formatPrice(product.basePrice) },
          {
            id: 'status',
            header: 'وضعیت',
            mobileLabel: 'وضعیت',
            cell: (product) => (
              <div className="flex flex-wrap gap-1">
                <ErpBadge tone={product.isAvailable ? 'success' : 'danger'}>{product.isAvailable ? 'موجود' : 'ناموجود'}</ErpBadge>
                <ErpBadge tone={product.isActive ? 'info' : 'neutral'}>{product.isActive ? 'فعال' : 'غیرفعال'}</ErpBadge>
                {product.deletedAt && <ErpBadge tone="danger">حذف شده</ErpBadge>}
              </div>
            ),
          },
        ]}
        rowActions={(product) => [
          { label: 'مشاهده', href: `/dashboard/sales/products/${product.id}`, icon: FaEye, tone: 'neutral' },
          ...(canEditProducts(currentUser)
            ? [{ label: product.isActive ? 'غیرفعال کردن' : 'فعال کردن', onClick: () => handleToggleStatus(product), icon: product.isActive ? FaToggleOn : FaToggleOff, tone: product.isActive ? 'success' as const : 'danger' as const, disabled: deleting }]
            : []),
          ...(canDeleteProducts(currentUser)
            ? [{ label: 'حذف', onClick: () => setDeleteConfirm({ show: true, product }), icon: FaTrash, tone: 'danger' as const }]
            : []),
        ]}
        emptyState={
          <ErpEmptyState
            icon={FaBoxes}
            title="محصولی یافت نشد"
            description="فیلترها را تغییر دهید یا محصول جدید ایجاد کنید."
            action={canCreateProducts(currentUser) ? { label: 'ایجاد محصول جدید', href: '/dashboard/sales/products/create', icon: FaPlus, tone: 'primary', variant: 'solid' } : undefined}
          />
        }
        footer={<ErpPagination currentPage={currentPage} totalPages={totalPages} totalItems={totalProducts} itemsPerPage={itemsPerPage} itemLabel="محصول" onPageChange={setCurrentPage} />}
      >
        <ErpToolbar
          title="فیلترها"
          search={{ value: searchTerm, onChange: resetToFirstPage(setSearchTerm), placeholder: 'جستجو در نام، کد یا توضیحات...' }}
          meta={`نمایش ${products.length.toLocaleString('fa-IR')} مورد در صفحه جاری`}
          filters={
            <>
              <EnhancedDropdown label="نوع سنگ" value={filterType} onChange={resetToFirstPage(setFilterType)} placeholder="همه انواع" options={[{ value: 'all', label: 'همه انواع' }, ...stoneTypes.map((type) => ({ value: type, label: type }))]} searchable clearable={false} />
              <EnhancedDropdown label="معدن" value={filterMine} onChange={resetToFirstPage(setFilterMine)} placeholder="همه معادن" options={[{ value: 'all', label: 'همه معادن' }, ...mines.map((mine) => ({ value: mine, label: mine }))]} searchable clearable={false} />
              <EnhancedDropdown label="نوع پرداخت" value={filterFinish} onChange={resetToFirstPage(setFilterFinish)} placeholder="همه انواع" options={[{ value: 'all', label: 'همه انواع' }, ...finishes.map((finish) => ({ value: finish, label: finish }))]} searchable clearable={false} />
              <EnhancedDropdown label="وضعیت" value={filterStatus} onChange={resetToFirstPage(setFilterStatus)} placeholder="همه وضعیت‌ها" options={[{ value: 'all', label: 'همه وضعیت‌ها' }, { value: 'active', label: 'فعال' }, { value: 'inactive', label: 'غیرفعال' }]} clearable={false} />
            </>
          }
          actions={currentUser?.role === 'ADMIN' ? [
            {
              label: showDeleted ? 'مخفی کردن حذف‌شده‌ها' : 'نمایش حذف‌شده‌ها',
              icon: showDeleted ? FaEyeSlash : FaEye,
              tone: 'neutral',
              variant: 'outline',
              onClick: () => {
                setShowDeleted((value) => !value);
                setCurrentPage(1);
              },
            },
          ] : []}
        />
      </ErpListPage>

      {deleteConfirm.show && deleteConfirm.product && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <ErpCard className="w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">تایید حذف محصول</h3>
            <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
              آیا مطمئن هستید که می‌خواهید محصول <span className="font-semibold text-slate-900 dark:text-white">{deleteConfirm.product.namePersian}</span> را حذف کنید؟
            </p>
            <p className="mt-3 text-sm text-amber-600 dark:text-amber-300">
              این عمل قابل بازگشت نیست و اگر محصول در قراردادها استفاده شده باشد، حذف آن امکان‌پذیر نخواهد بود.
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <ErpButton label="انصراف" tone="neutral" variant="outline" onClick={() => setDeleteConfirm({ show: false, product: null })} disabled={deleting} />
              <ErpButton label={deleting ? 'در حال حذف...' : 'حذف محصول'} icon={FaTrash} tone="danger" variant="solid" onClick={handleDeleteConfirm} disabled={deleting} />
            </div>
          </ErpCard>
        </div>
      )}

      <SuccessModal isOpen={showSuccessModal} onClose={() => setShowSuccessModal(false)} title="عملیات موفق" message={modalMessage} buttonText="باشه" autoClose autoCloseDelay={2000} />
      <ErrorModal isOpen={showErrorModal} onClose={() => setShowErrorModal(false)} title="خطا" message={modalMessage} details={modalDetails} buttonText="باشه" />
      <ProductImportExportModal
        isOpen={showImportExportModal}
        onClose={() => setShowImportExportModal(false)}
        onImportComplete={(results) => {
          fetchProducts();
          setShowSuccessModal(true);
          setModalMessage('محصولات با موفقیت همگام‌سازی شدند');
          setModalDetails(`${results.summary.creates} ایجاد، ${results.summary.updates} به‌روزرسانی، ${results.summary.removals} حذف یا غیرفعال`);
        }}
        currentFilters={{
          search: searchTerm,
          stoneType: filterType !== 'all' ? filterType : undefined,
          mine: filterMine !== 'all' ? filterMine : undefined,
          finish: filterFinish !== 'all' ? filterFinish : undefined,
          isActive: filterStatus !== 'all' ? filterStatus === 'active' : undefined,
          includeDeleted: showDeleted,
        }}
        currentUser={currentUser}
      />
    </>
  );
}
