'use client';
import { ErpInput, ErpSelect, ErpTextarea } from '@/components/erp';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { servicesAPI } from '@/lib/api';
import CatalogImagePicker from '@/components/CatalogImagePicker';
import { InventoryMasterDataActions, InventoryMasterDataPage } from '@/features/inventory/master-data/InventoryMasterDataUi';

const CreateSubServicePage: React.FC = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    try {
      const response = await servicesAPI.createSubService(formData);

      if (response.data.success) {
        // Redirect back to services page
        router.push('/dashboard/inventory/services');
      } else {
        setErrors({ general: 'خطا در ایجاد ابزار' });
      }
    } catch (error: any) {
      console.error('Error creating sub-service:', error);

      if (error.response?.data?.details) {
        const newErrors: Record<string, string> = {};
        error.response.data.details.forEach((detail: any) => {
          newErrors[detail.path] = detail.msg;
        });
        setErrors(newErrors);
      } else {
        setErrors({ general: 'خطا در ایجاد ابزار' });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    router.push('/dashboard/inventory/services');
  };

  return (
    <InventoryMasterDataPage title="ایجاد ابزار جدید" description="تعریف ابزار با قیمت و مبنای محاسبه مستقل" backHref="/dashboard/inventory/services" error={errors.general}>
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

        <InventoryMasterDataActions pending={loading} submitLabel="ایجاد ابزار" onCancel={handleCancel} />
      </form>
    </InventoryMasterDataPage>
  );
};

export default CreateSubServicePage;

