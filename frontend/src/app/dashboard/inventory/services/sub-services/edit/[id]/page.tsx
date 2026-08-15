'use client';
import { ErpInput, ErpLoading, ErpPressable, ErpSelect, ErpTextarea } from '@/components/erp';
import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { FaSave, FaArrowRight, FaTimes } from 'react-icons/fa';
import { servicesAPI } from '@/lib/api';
import CatalogImagePicker from '@/components/CatalogImagePicker';
import { InventoryMasterDataActions, InventoryMasterDataPage } from '@/features/inventory/master-data/InventoryMasterDataUi';

const EditSubServicePage: React.FC = () => {
  const router = useRouter();
  const params = useParams();
  const subServiceId = params.id as string;

  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    namePersian: '',
    description: '',
    pricePerMeter: '',
    calculationBase: 'length' as 'length' | 'squareMeters',
    images: [] as string[],
    isActive: true
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    loadSubService();
  }, [subServiceId]);

  const loadSubService = async () => {
    try {
      setInitialLoading(true);
      const response = await servicesAPI.getSubService(subServiceId);

      if (response.data.success) {
        const subService = response.data.data;
        setFormData({
          code: subService.code,
          name: subService.name || '',
          namePersian: subService.namePersian,
          description: subService.description || '',
          pricePerMeter: subService.pricePerMeter.toString(),
          calculationBase: subService.calculationBase || 'length',
          images: subService.images || [],
          isActive: subService.isActive
        });
      } else {
        setErrors({ general: 'خطا در دریافت اطلاعات ابزار' });
      }
    } catch (error) {
      console.error('Error loading sub-service:', error);
      setErrors({ general: 'خطا در دریافت اطلاعات ابزار' });
    } finally {
      setInitialLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    try {
      const response = await servicesAPI.updateSubService(subServiceId, formData);

      if (response.data.success) {
        // Redirect back to services page
        router.push('/dashboard/inventory/services');
      } else {
        setErrors({ general: 'خطا در ذخیره ابزار' });
      }
    } catch (error: any) {
      console.error('Error updating sub-service:', error);

      if (error.response?.data?.details) {
        const newErrors: Record<string, string> = {};
        error.response.data.details.forEach((detail: any) => {
          newErrors[detail.path] = detail.msg;
        });
        setErrors(newErrors);
      } else {
        setErrors({ general: 'خطا در ذخیره ابزار' });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    router.push('/dashboard/inventory/services');
  };

  if (initialLoading) return <ErpLoading />;

  return (
    <InventoryMasterDataPage title="ویرایش ابزار" description="اطلاعات ابزار، قیمت و مبنای محاسبه آن را به‌روزرسانی کنید" backHref="/dashboard/inventory/services" error={errors.general}>
      <div className="container mx-auto px-4 py-8">
        {/* Form */}
        <div className="max-w-2xl mx-auto">
          <div>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Code */}
              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2" htmlFor="inventory-code">



                  کد ابزار *



                </label>
                <ErpInput
                  type="text"
                  value={formData.code}
                  onChange={(e) => setFormData(prev => ({ ...prev, code: e.target.value }))}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)] ${
                    errors.code ? 'border-[var(--sds-danger-border)]' : 'border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)]'
                  }`}
                  placeholder="مثال: SUB001"
                 id="inventory-code" aria-invalid={Boolean(errors.code)} aria-describedby={errors.code ? 'inventory-code-error' : undefined} />
                {errors.code && (
                  <p id="inventory-code-error" role="alert" className="text-[var(--sds-danger)] text-sm mt-1">{errors.code}</p>
                )}
              </div>

              {/* Persian Name */}
              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2" htmlFor="inventory-namePersian">



                  نام فارسی ابزار *



                </label>
                <ErpInput
                  type="text"
                  value={formData.namePersian}
                  onChange={(e) => setFormData(prev => ({ ...prev, namePersian: e.target.value }))}
                  className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)] ${
                    errors.namePersian ? 'border-[var(--sds-danger-border)]' : 'border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)]'
                  }`}
                  placeholder="مثال: ابزار شیار"
                 id="inventory-namePersian" aria-invalid={Boolean(errors.namePersian)} aria-describedby={errors.namePersian ? 'inventory-namePersian-error' : undefined} />
                {errors.namePersian && (
                  <p id="inventory-namePersian-error" role="alert" className="text-[var(--sds-danger)] text-sm mt-1">{errors.namePersian}</p>
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
                  placeholder="توضیحات ابزار..."
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
                  placeholder="توضیحات ابزار..."
                />
              </div>

              {/* Price Per Meter */}
              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2" htmlFor="inventory-pricePerMeter">



                  قیمت پایه (تومان)



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
                  required
                 id="inventory-pricePerMeter" aria-invalid={Boolean(errors.pricePerMeter)} aria-describedby={errors.pricePerMeter ? 'inventory-pricePerMeter-error' : undefined} />
                {errors.pricePerMeter && (
                  <p id="inventory-pricePerMeter-error" role="alert" className="text-[var(--sds-danger)] text-sm mt-1">{errors.pricePerMeter}</p>
                )}
                <p className="text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)] mt-1">
                  مشخص کنید قیمت بر اساس طول یا متر مربع محاسبه شود.
                </p>
              </div>

              {/* Calculation Base */}
              <div>
                <label className="block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] mb-2">



                  مبنای محاسبه *



                </label>
                <ErpSelect
                  value={formData.calculationBase}
                  onChange={(e) => setFormData(prev => ({ ...prev, calculationBase: e.target.value as 'length' | 'squareMeters' }))}
                  className="w-full px-3 py-2 border border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] rounded-lg focus:ring-2 focus:ring-[var(--sds-focus-ring)] focus:border-transparent bg-[var(--sds-surface-raised)] dark:bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]"
                >
                  <option value="length">طول</option>
                  <option value="squareMeters">متر مربع</option>
                </ErpSelect>
                <p className="text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)] mt-1">
                  مشخص کنید قیمت بر اساس طول یا متر مربع محاسبه شود.
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
              <InventoryMasterDataActions pending={loading} submitLabel="ذخیره ابزار" onCancel={handleCancel} />
            </form>
          </div>
        </div>
      </div>
    </InventoryMasterDataPage>
  );
};

export default EditSubServicePage;
