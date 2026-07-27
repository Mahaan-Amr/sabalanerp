'use client';
import { ErpInput, ErpPressable, ErpTextarea } from '@/components/erp';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FaSave, FaArrowRight, FaTimes } from 'react-icons/fa';
import { servicesAPI } from '@/lib/api';
import CatalogImagePicker from '@/components/CatalogImagePicker';

const CreateCuttingTypePage: React.FC = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    namePersian: '',
    description: '',
    pricePerMeter: '',
    images: [] as string[],
    isActive: true
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    try {
      const response = await servicesAPI.createCuttingType(formData);

      if (response.data.success) {
        // Redirect back to services page
        router.push('/dashboard/inventory/services');
      } else {
        setErrors({ general: 'خطا در ایجاد نوع ابزار' });
      }
    } catch (error: any) {
      console.error('Error creating cutting type:', error);

      if (error.response?.data?.details) {
        const newErrors: Record<string, string> = {};
        error.response.data.details.forEach((detail: any) => {
          newErrors[detail.path] = detail.msg;
        });
        setErrors(newErrors);
      } else {
        setErrors({ general: 'خطا در ایجاد نوع ابزار' });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    router.push('/dashboard/inventory/services');
  };

  return (
    <main className="sds-workspace min-h-screen bg-gradient-to-br from-[var(--sds-surface-subtle)] to-[var(--sds-surface-subtle)] dark:from-[var(--sds-surface-raised)] dark:to-[var(--sds-surface-raised)]">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)] mb-2">
                ایجاد نوع ابزار جدید
              </h1>
              <p className="text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
                تعریف نوع ابزار و قیمت پایه برای خدمات برش و ابزار سنگ
              </p>
            </div>
            <ErpPressable type="submit"
              onClick={handleCancel}
              className="p-2 text-[var(--sds-text-secondary)] hover:text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] dark:hover:text-[var(--sds-text-primary)] transition-colors"
            >
              <FaTimes className="w-6 h-6" />
            </ErpPressable>
          </div>
        </div>

        {/* Form */}
        <div className="max-w-2xl mx-auto">
          <div className="bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] backdrop-blur-sm rounded-xl border border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] shadow-lg p-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Code */}
              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">



                  کد نوع ابزار *



                </label>
                <ErpInput
                  type="text"
                  value={formData.code}
                  onChange={(e) => setFormData(prev => ({ ...prev, code: e.target.value }))}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)] ${
                    errors.code ? 'border-[var(--sds-danger-border)]' : 'border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)]'
                  }`}
                  placeholder="مثال: LONG, CROSS"
                />
                {errors.code && (
                  <p className="text-[var(--sds-danger)] text-sm mt-1">{errors.code}</p>
                )}
              </div>

              {/* Persian Name */}
              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">



                  نام فارسی نوع ابزار *



                </label>
                <ErpInput
                  type="text"
                  value={formData.namePersian}
                  onChange={(e) => setFormData(prev => ({ ...prev, namePersian: e.target.value }))}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)] ${
                    errors.namePersian ? 'border-[var(--sds-danger-border)]' : 'border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)]'
                  }`}
                  placeholder="مثال: ابزار طولی"
                />
                {errors.namePersian && (
                  <p className="text-[var(--sds-danger)] text-sm mt-1">{errors.namePersian}</p>
                )}
              </div>

              {/* English Name */}
              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">



                  نام انگلیسی



                </label>
                <ErpInput
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] rounded-lg focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]"
                  placeholder="مثال: Longitudinal Cut"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">



                  توضیحات



                </label>
                <ErpTextarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 border border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] rounded-lg focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]"
                  placeholder="توضیحات نوع ابزار..."
                />
              </div>

              {/* Price Per Meter */}
              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">



                  قیمت هر متر ابزار (تومان)



                </label>
                <ErpInput
                  type="number"
                  value={formData.pricePerMeter}
                  onChange={(e) => setFormData(prev => ({ ...prev, pricePerMeter: e.target.value }))}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)] ${
                    errors.pricePerMeter ? 'border-[var(--sds-danger-border)]' : 'border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)]'
                  }`}
                  placeholder="مثال: 50000"
                  min={0}
                  step={1000}
                />
                {errors.pricePerMeter && (
                  <p className="text-[var(--sds-danger)] text-sm mt-1">{errors.pricePerMeter}</p>
                )}
                <p className="text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)] mt-1">
                  قیمت پایه برای هر متر طول ابزارکاری سنگ را وارد کنید.
                </p>
              </div>

              <CatalogImagePicker
                images={formData.images}
                onChange={(images) => setFormData(prev => ({ ...prev, images }))}
              />

              {/* Status */}
              <div>
                <label className="flex items-center space-x-3 space-x-reverse">
                  <ErpInput
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={(e) => setFormData(prev => ({ ...prev, isActive: e.target.checked }))}
                    className="w-4 h-4 text-[var(--sds-accent)] bg-[var(--sds-surface-subtle)] border-[var(--sds-border-default)] rounded focus:ring-[var(--sds-focus-ring)] dark:focus:ring-[var(--sds-focus-ring)] dark:ring-offset-gray-800 focus:ring-2 dark:bg-[var(--sds-surface-raised)] dark:border-[var(--sds-border-strong)]"
                  />
                  <span className="text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)]">فعال</span>
                </label>
              </div>

              {/* General Error */}
              {errors.general && (
                <div className="bg-[var(--sds-danger-surface)] dark:bg-[var(--sds-danger-surface)] border border-[var(--sds-danger-border)] dark:border-[var(--sds-danger-border)] rounded-lg p-4">
                  <p className="text-[var(--sds-danger)] dark:text-[var(--sds-danger)] text-sm">{errors.general}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end space-x-4 space-x-reverse pt-6 border-t border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)]">
                <ErpPressable
                  type="button"
                  onClick={handleCancel}
                  className="px-6 py-2 border border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] rounded-lg hover:bg-[var(--sds-surface-subtle)] dark:hover:bg-[var(--sds-surface-raised)] transition-colors"
                >انصراف</ErpPressable>
                <ErpPressable
                  type="submit"
                  disabled={loading}
                  className="px-6 py-2 bg-[var(--sds-accent)] hover:bg-[var(--sds-accent)] disabled:bg-[var(--sds-accent-surface)] text-[var(--sds-text-inverse)] rounded-lg transition-colors flex items-center space-x-2 space-x-reverse"
                >
                  {loading ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[var(--sds-border-default)]"></div>
                  ) : (
                    <FaSave className="w-4 h-4" />
                  )}
                  <span>{loading ? 'در حال ذخیره...' : 'ایجاد نوع ابزار'}</span>
                </ErpPressable>
              </div>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
};

export default CreateCuttingTypePage;

