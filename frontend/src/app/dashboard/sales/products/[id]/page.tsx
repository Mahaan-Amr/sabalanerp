'use client';
import { ErpInput, ErpPressable, ErpSelect, ErpTextarea } from '@/components/erp';
import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Product } from '@/types/product';
import { resolveBackendAssetUrl, salesAPI } from '@/lib/api';
import { formatPrice } from '@/lib/numberFormat';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import CatalogImagePicker from '@/components/CatalogImagePicker';

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

const ProductDetailPage: React.FC = () => {
  const router = useRouter();
  const params = useParams();
  const productId = params.id as string;

  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({
    basePrice: '',
    motherLengthValue: '',
    isAvailable: true,
    leadTime: '',
    description: '',
    images: [] as string[],
  });

  useEffect(() => {
    if (productId) {
      fetchProduct();
    }
  }, [productId]);

  const fetchProduct = async () => {
    try {
      setLoading(true);
      const response = await salesAPI.getProduct(productId);

      if (response.data.success) {
        const data = response.data;
        setProduct(data.data);
        setFormData({
          basePrice: data.data.basePrice?.toString() || '',
          motherLengthValue: data.data.motherLengthValue?.toString() || '',
          isAvailable: data.data.isAvailable,
          leadTime: data.data.leadTime?.toString() || '',
          description: data.data.description || '',
          images: data.data.images || [],
        });
      } else {
        console.error('Failed to fetch product');
        router.push('/dashboard/sales/products');
      }
    } catch (error) {
      console.error('Error fetching product:', error);
      router.push('/dashboard/sales/products');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      const response = await salesAPI.updateProduct(productId, {
        basePrice: formData.basePrice ? parseFloat(formData.basePrice) : null,
        motherLengthValue: formData.motherLengthValue
          ? parseFloat(formData.motherLengthValue)
          : null,
        isAvailable: formData.isAvailable,
        leadTime: formData.leadTime ? parseInt(formData.leadTime) : null,
        description: formData.description || null,
        images: formData.images,
      });

      if (response.data.success) {
        setProduct(response.data.data);
        setEditing(false);
        alert('محصول با موفقیت به‌روزرسانی شد');
      } else {
        console.error('Failed to update product');
        alert('خطا در به‌روزرسانی محصول');
      }
    } catch (error) {
      console.error('Error updating product:', error);
      alert('خطا در به‌روزرسانی محصول');
    }
  };

  const formatPrice = (price: number | null) => {
    if (!price) return 'قیمت تعیین نشده';
    return new Intl.NumberFormat('fa-IR').format(price) + ' ریال';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[var(--sds-surface-subtle)] to-[var(--sds-surface-subtle)] dark:from-[var(--sds-surface-raised)] dark:to-[var(--sds-surface-raised)] p-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--sds-border-strong)]"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[var(--sds-surface-subtle)] to-[var(--sds-surface-subtle)] dark:from-[var(--sds-surface-raised)] dark:to-[var(--sds-surface-raised)] p-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)] mb-4">
              محصول یافت نشد
            </h1>
            <ErpPressable type="submit"
              onClick={() => router.push('/dashboard/sales/products')}
              className="px-6 py-3 bg-[var(--sds-accent)] text-[var(--sds-text-inverse)] rounded-lg hover:bg-[var(--sds-accent)] transition-colors"
            >
              بازگشت به لیست محصولات
            </ErpPressable>
          </div>
        </div>
      </div>
    );
  }

  return (
    <main className="sds-workspace min-h-screen">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)] mb-2">
                جزئیات محصول
              </h1>
              <p className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
                مشاهده و ویرایش اطلاعات محصول
              </p>
            </div>
            <ErpPressable type="submit"
              onClick={() => router.push('/dashboard/sales/products')}
              className="px-4 py-2 bg-[var(--sds-surface-subtle)] text-[var(--sds-text-primary)] rounded-lg hover:bg-[var(--sds-surface-subtle)] transition-colors"
            >
              بازگشت
            </ErpPressable>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Product Information */}
          <div className="lg:col-span-2">
            <div className="bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] backdrop-blur-sm rounded-2xl p-6 border border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)]">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                  اطلاعات محصول
                </h2>
                <ErpPressable type="submit"
                  onClick={() => setEditing(!editing)}
                  className="px-4 py-2 bg-[var(--sds-accent)] text-[var(--sds-text-inverse)] rounded-lg hover:bg-[var(--sds-accent)] transition-colors"
                >
                  {editing ? 'لغو ویرایش' : 'ویرایش'}
                </ErpPressable>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Full Product Name */}
                <div>
                  <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">
                    نام کامل محصول
                  </label>
                  <div className="px-4 py-2 bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] rounded-lg text-sm font-medium leading-relaxed">
                    {generateFullProductName(product)}
                  </div>
                </div>

                {/* Product Name Persian */}
                <div>
                  <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">
                    نام فارسی
                  </label>
                  <div className="px-4 py-2 bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] rounded-lg">
                    {product.namePersian}
                  </div>
                </div>

                {/* Product Name English */}
                <div>
                  <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">
                    نام انگلیسی
                  </label>
                  <div className="px-4 py-2 bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] rounded-lg">
                    {product.name}
                  </div>
                </div>

                {/* Stone Type */}
                <div>
                  <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">
                    نوع سنگ
                  </label>
                  <div className="px-4 py-2 bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] rounded-lg">
                    {product.stoneTypeNamePersian}
                  </div>
                </div>

                {/* Dimensions */}
                <div>
                  <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">
                    ابعاد
                  </label>
                  <div className="px-4 py-2 bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] rounded-lg">
                    {product.widthValue} × {product.thicknessValue} سانتی‌متر
                  </div>
                </div>

                {/* Mine */}
                <div>
                  <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">
                    طول مادر
                  </label>
                  {editing ? (
                    <ErpInput
                      value={formData.motherLengthValue}
                      onChange={(event) => setFormData({
                        ...formData,
                        motherLengthValue: event.target.value
                      })}
                      inputMode="decimal"
                      className="w-full rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-4 py-2 focus:border-[var(--sds-border-strong)] focus:outline-none dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]"
                    />
                  ) : (
                    <div className="px-4 py-2 bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] rounded-lg">
                      {product.motherLengthValue
                        ? `${product.motherLengthValue} متر`
                        : 'در موجودی ثبت نشده است'}
                    </div>
                  )}
                </div>

                {/* Mine */}
                <div>
                  <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">
                    معدن
                  </label>
                  <div className="px-4 py-2 bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] rounded-lg">
                    {product.mineNamePersian}
                  </div>
                </div>

                {/* Finish */}
                <div>
                  <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">
                    نوع پرداخت
                  </label>
                  <div className="px-4 py-2 bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] rounded-lg">
                    {product.finishNamePersian}
                  </div>
                </div>

                {/* Color */}
                <div>
                  <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">
                    رنگ
                  </label>
                  <div className="px-4 py-2 bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] rounded-lg">
                    {product.colorNamePersian}
                  </div>
                </div>

                {/* Quality */}
                <div>
                  <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">
                    کیفیت
                  </label>
                  <div className="px-4 py-2 bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] rounded-lg">
                    {product.qualityNamePersian}
                  </div>
                </div>

                {/* Cutting Dimension */}
                <div>
                  <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">
                    ابعاد برش
                  </label>
                  <div className="px-4 py-2 bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] rounded-lg">
                    {product.cuttingDimensionNamePersian}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Pricing and Management */}
          <div className="space-y-6">
            {/* Pricing */}
            <div className="bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] backdrop-blur-sm rounded-2xl p-6 border border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)]">
              <h3 className="text-lg font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)] mb-4">
                قیمت‌گذاری
              </h3>

              <div className="space-y-4">
                {/* Base Price */}
                <div>
                  <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">
                    قیمت پایه (ریال)
                  </label>
                  {editing ? (
                    <FormattedNumberInput
                      value={formData.basePrice ? parseFloat(formData.basePrice) : 0}
                      onChange={(value) => setFormData({ ...formData, basePrice: value.toString() })}
                      className="w-full px-4 py-2 bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] rounded-lg focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent"
                      placeholder="قیمت را وارد کنید"
                      min={0}
                    />
                  ) : (
                    <div className="px-4 py-2 bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] rounded-lg">
                      {formatPrice(product.basePrice)}
                    </div>
                  )}
                </div>

                {/* Currency */}
                <div>
                  <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">
                    واحد پول
                  </label>
                  <div className="px-4 py-2 bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] rounded-lg">
                    {product.currency}
                  </div>
                </div>

                {/* Lead Time */}
                <div>
                  <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">
                    زمان تحویل (روز)
                  </label>
                  {editing ? (
                    <FormattedNumberInput
                      value={formData.leadTime ? parseFloat(formData.leadTime) : 0}
                      onChange={(value) => setFormData({ ...formData, leadTime: value.toString() })}
                      className="w-full px-4 py-2 bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] rounded-lg focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent"
                      placeholder="تعداد روز"
                      min={0}
                    />
                  ) : (
                    <div className="px-4 py-2 bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] rounded-lg">
                      {product.leadTime ? `${product.leadTime} روز` : 'تعیین نشده'}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Status */}
            <div className="bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] backdrop-blur-sm rounded-2xl p-6 border border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)]">
              <h3 className="text-lg font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)] mb-4">
                وضعیت
              </h3>

              <div className="space-y-4">
                {/* Availability */}
                <div>
                  <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">
                    وضعیت موجودی
                  </label>
                  {editing ? (
                    <ErpSelect
                      value={formData.isAvailable.toString()}
                      onChange={(e) => setFormData({ ...formData, isAvailable: e.target.value === 'true' })}
                      className="w-full px-4 py-2 bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] rounded-lg focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent"
                    >
                      <option value="true">موجود</option>
                      <option value="false">ناموجود</option>
                    </ErpSelect>
                  ) : (
                    <div className="flex items-center space-x-2">
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                        product.isAvailable
                          ? 'bg-[var(--sds-success-surface)] text-[var(--sds-success)] dark:bg-[var(--sds-success-surface)] dark:text-[var(--sds-success)]'
                          : 'bg-[var(--sds-danger-surface)] text-[var(--sds-danger)] dark:bg-[var(--sds-danger-surface)] dark:text-[var(--sds-danger)]'
                      }`}>
                        {product.isAvailable ? 'موجود' : 'ناموجود'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Active Status */}
                <div>
                  <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">
                    وضعیت فعال
                  </label>
                  <div className="flex items-center space-x-2">
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                      product.isActive
                        ? 'bg-[var(--sds-success-surface)] text-[var(--sds-success)] dark:bg-[var(--sds-success-surface)] dark:text-[var(--sds-success)]'
                        : 'bg-[var(--sds-danger-surface)] text-[var(--sds-danger)] dark:bg-[var(--sds-danger-surface)] dark:text-[var(--sds-danger)]'
                    }`}>
                      {product.isActive ? 'فعال' : 'غیرفعال'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] backdrop-blur-sm rounded-2xl p-6 border border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)]">
              <h3 className="text-lg font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)] mb-4">
                توضیحات
              </h3>

              {editing ? (
                <ErpTextarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={4}
                  className="w-full px-4 py-2 bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] border border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] rounded-lg focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent"
                  placeholder="توضیحات محصول را وارد کنید"
                />
              ) : (
                <div className="px-4 py-2 bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] rounded-lg min-h-[100px]">
                  {product.description || 'توضیحی وارد نشده است'}
                </div>
              )}
            </div>

            <div className="bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] backdrop-blur-sm rounded-2xl p-6 border border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)]">
              {editing ? (
                <CatalogImagePicker
                  images={formData.images}
                  onChange={(images) => setFormData({ ...formData, images })}
                />
              ) : (
                <>
                  <h3 className="text-lg font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)] mb-4">تصاویر</h3>
                  {product.images && product.images.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {product.images.slice(0, 3).map((image, index) => (
                        <img key={`${image}-${index}`} src={resolveBackendAssetUrl(image)} alt={product.namePersian} className="h-16 w-16 rounded-lg object-cover" />
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-2 bg-[var(--sds-surface-subtle)] dark:bg-[var(--sds-surface-raised)] rounded-lg">تصویری ثبت نشده است</div>
                  )}
                </>
              )}
            </div>

            {/* Save Button */}
            {editing && (
              <div className="flex space-x-3">
                <ErpPressable type="submit"
                  onClick={handleSave}
                  className="flex-1 px-6 py-3 bg-[var(--sds-accent)] text-[var(--sds-text-inverse)] rounded-lg hover:bg-[var(--sds-accent)] transition-colors"
                >
                  ذخیره تغییرات
                </ErpPressable>
                <ErpPressable type="submit"
                  onClick={() => setEditing(false)}
                  className="flex-1 px-6 py-3 bg-[var(--sds-surface-subtle)] text-[var(--sds-text-primary)] rounded-lg hover:bg-[var(--sds-surface-subtle)] transition-colors"
                >
                  لغو
                </ErpPressable>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
};

export default ProductDetailPage;
