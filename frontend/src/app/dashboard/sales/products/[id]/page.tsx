'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Product } from '@/types/product';
import { salesAPI } from '@/lib/api';
import { formatPrice } from '@/lib/numberFormat';
import FormattedNumberInput from '@/components/FormattedNumberInput';

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
    isAvailable: true,
    leadTime: '',
    description: '',
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
          isAvailable: data.data.isAvailable,
          leadTime: data.data.leadTime?.toString() || '',
          description: data.data.description || '',
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
        isAvailable: formData.isAvailable,
        leadTime: formData.leadTime ? parseInt(formData.leadTime) : null,
        description: formData.description || null,
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
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-200 mb-4">
              محصول یافت نشد
            </h1>
            <button
              onClick={() => router.push('/dashboard/sales/products')}
              className="px-6 py-3 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-colors"
            >
              بازگشت به لیست محصولات
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-200 mb-2">
                جزئیات محصول
              </h1>
              <p className="text-slate-600 dark:text-slate-400">
                مشاهده و ویرایش اطلاعات محصول
              </p>
            </div>
            <button
              onClick={() => router.push('/dashboard/sales/products')}
              className="px-4 py-2 bg-slate-500 text-white rounded-lg hover:bg-slate-600 transition-colors"
            >
              بازگشت
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Product Information */}
          <div className="lg:col-span-2">
            <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-2xl p-6 border border-white/20 dark:border-slate-700/50">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200">
                  اطلاعات محصول
                </h2>
                <button
                  onClick={() => setEditing(!editing)}
                  className="px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-colors"
                >
                  {editing ? 'لغو ویرایش' : 'ویرایش'}
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Full Product Name */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    نام کامل محصول
                  </label>
                  <div className="px-4 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg text-sm font-medium leading-relaxed">
                    {generateFullProductName(product)}
                  </div>
                </div>

                {/* Product Name Persian */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    نام فارسی
                  </label>
                  <div className="px-4 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
                    {product.namePersian}
                  </div>
                </div>

                {/* Product Name English */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    نام انگلیسی
                  </label>
                  <div className="px-4 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
                    {product.name}
                  </div>
                </div>

                {/* Stone Type */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    نوع سنگ
                  </label>
                  <div className="px-4 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
                    {product.stoneTypeNamePersian}
                  </div>
                </div>

                {/* Dimensions */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    ابعاد
                  </label>
                  <div className="px-4 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
                    {product.widthValue} × {product.thicknessValue} سانتی‌متر
                  </div>
                </div>

                {/* Mine */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    معدن
                  </label>
                  <div className="px-4 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
                    {product.mineNamePersian}
                  </div>
                </div>

                {/* Finish */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    نوع پرداخت
                  </label>
                  <div className="px-4 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
                    {product.finishNamePersian}
                  </div>
                </div>

                {/* Color */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    رنگ
                  </label>
                  <div className="px-4 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
                    {product.colorNamePersian}
                  </div>
                </div>

                {/* Quality */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    کیفیت
                  </label>
                  <div className="px-4 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
                    {product.qualityNamePersian}
                  </div>
                </div>

                {/* Cutting Dimension */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    ابعاد برش
                  </label>
                  <div className="px-4 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
                    {product.cuttingDimensionNamePersian}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Pricing and Management */}
          <div className="space-y-6">
            {/* Pricing */}
            <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-2xl p-6 border border-white/20 dark:border-slate-700/50">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-4">
                قیمت‌گذاری
              </h3>

              <div className="space-y-4">
                {/* Base Price */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    قیمت پایه (ریال)
                  </label>
                  {editing ? (
                    <FormattedNumberInput
                      value={formData.basePrice ? parseFloat(formData.basePrice) : 0}
                      onChange={(value) => setFormData({ ...formData, basePrice: value.toString() })}
                      className="w-full px-4 py-2 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                      placeholder="قیمت را وارد کنید"
                      min={0}
                    />
                  ) : (
                    <div className="px-4 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
                      {formatPrice(product.basePrice)}
                    </div>
                  )}
                </div>

                {/* Currency */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    واحد پول
                  </label>
                  <div className="px-4 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
                    {product.currency}
                  </div>
                </div>

                {/* Lead Time */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    زمان تحویل (روز)
                  </label>
                  {editing ? (
                    <FormattedNumberInput
                      value={formData.leadTime ? parseFloat(formData.leadTime) : 0}
                      onChange={(value) => setFormData({ ...formData, leadTime: value.toString() })}
                      className="w-full px-4 py-2 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                      placeholder="تعداد روز"
                      min={0}
                    />
                  ) : (
                    <div className="px-4 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg">
                      {product.leadTime ? `${product.leadTime} روز` : 'تعیین نشده'}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Status */}
            <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-2xl p-6 border border-white/20 dark:border-slate-700/50">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-4">
                وضعیت
              </h3>

              <div className="space-y-4">
                {/* Availability */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    وضعیت موجودی
                  </label>
                  {editing ? (
                    <select
                      value={formData.isAvailable.toString()}
                      onChange={(e) => setFormData({ ...formData, isAvailable: e.target.value === 'true' })}
                      className="w-full px-4 py-2 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                    >
                      <option value="true">موجود</option>
                      <option value="false">ناموجود</option>
                    </select>
                  ) : (
                    <div className="flex items-center space-x-2">
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                        product.isAvailable 
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                      }`}>
                        {product.isAvailable ? 'موجود' : 'ناموجود'}
                      </span>
                    </div>
                  )}
                </div>

                {/* Active Status */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    وضعیت فعال
                  </label>
                  <div className="flex items-center space-x-2">
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                      product.isActive 
                        ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                        : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
                    }`}>
                      {product.isActive ? 'فعال' : 'غیرفعال'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="bg-white/70 dark:bg-slate-800/70 backdrop-blur-sm rounded-2xl p-6 border border-white/20 dark:border-slate-700/50">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200 mb-4">
                توضیحات
              </h3>

              {editing ? (
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={4}
                  className="w-full px-4 py-2 bg-white/50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  placeholder="توضیحات محصول را وارد کنید"
                />
              ) : (
                <div className="px-4 py-2 bg-slate-100 dark:bg-slate-700 rounded-lg min-h-[100px]">
                  {product.description || 'توضیحی وارد نشده است'}
                </div>
              )}
            </div>

            {/* Save Button */}
            {editing && (
              <div className="flex space-x-3">
                <button
                  onClick={handleSave}
                  className="flex-1 px-6 py-3 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-colors"
                >
                  ذخیره تغییرات
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="flex-1 px-6 py-3 bg-slate-500 text-white rounded-lg hover:bg-slate-600 transition-colors"
                >
                  لغو
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductDetailPage;
