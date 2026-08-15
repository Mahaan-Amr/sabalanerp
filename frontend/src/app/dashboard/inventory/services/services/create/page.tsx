'use client';
import { ErpCheckbox, ErpInput, ErpTextarea } from '@/components/erp';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { servicesAPI } from '@/lib/api';
import CatalogImagePicker from '@/components/CatalogImagePicker';
import { InventoryMasterDataActions, InventoryMasterDataEntry, InventoryMasterDataPage } from '@/features/inventory/master-data/InventoryMasterDataUi';

const CreateServicePage: React.FC = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    namePersian: '',
    description: '',
    images: [] as string[],
    isActive: true
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    try {
      const response = await servicesAPI.createService(formData);

      if (response.data.success) {
        // Redirect back to services page
        router.push('/dashboard/inventory/services');
      } else {
        setErrors({ general: 'خطا در ایجاد خدمت' });
      }
    } catch (error: any) {
      console.error('Error creating service:', error);

      if (error.response?.data?.details) {
        const newErrors: Record<string, string> = {};
        error.response.data.details.forEach((detail: any) => {
          newErrors[detail.path] = detail.msg;
        });
        setErrors(newErrors);
      } else {
        setErrors({ general: 'خطا در ایجاد خدمت' });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    router.push('/dashboard/inventory/services');
  };

  return (
    <InventoryMasterDataPage title="ایجاد خدمت جدید" description="تعریف خدمت اصلی برای دسته‌بندی خدمات سنگ" backHref="/dashboard/inventory/services" error={errors.general}>
      <form onSubmit={handleSubmit} className="space-y-6">
              {/* Code */}
              <InventoryMasterDataEntry id="service-code" label="کد خدمت" error={errors.code} required>
                <ErpInput
                  type="text"
                  value={formData.code}
                  onChange={(e) => setFormData(prev => ({ ...prev, code: e.target.value }))}
                  placeholder="مثال: CUT001"
                />
              </InventoryMasterDataEntry>

              {/* Persian Name */}
              <InventoryMasterDataEntry id="service-name-persian" label="نام فارسی خدمت" error={errors.namePersian} required>
                <ErpInput
                  type="text"
                  value={formData.namePersian}
                  onChange={(e) => setFormData(prev => ({ ...prev, namePersian: e.target.value }))}
                  placeholder="مثال: برش سنگ"
                />
              </InventoryMasterDataEntry>

              {/* English Name */}
              <InventoryMasterDataEntry id="service-name" label="نام انگلیسی">
                <ErpInput
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="مثال: Stone Cutting"
                />
              </InventoryMasterDataEntry>

              {/* Description */}
              <InventoryMasterDataEntry id="service-description" label="توضیحات">
                <ErpTextarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  placeholder="توضیحات خدمت..."
                />
              </InventoryMasterDataEntry>

              <CatalogImagePicker
                images={formData.images}
                onChange={(images) => setFormData(prev => ({ ...prev, images }))}
              />

              {/* Status */}
              <ErpCheckbox label="فعال" checked={formData.isActive} onChange={(e) => setFormData(prev => ({ ...prev, isActive: e.target.checked }))} />

        <InventoryMasterDataActions pending={loading} submitLabel="ایجاد خدمت" onCancel={handleCancel} />
      </form>
    </InventoryMasterDataPage>
  );
};

export default CreateServicePage;
