'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { servicesAPI } from '@/lib/api';
import { InventoryMasterDataForm, InventoryMasterDataPage } from '@/features/inventory/master-data/InventoryMasterDataUi';

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
    <InventoryMasterDataPage title="ایجاد نوع ابزار جدید" description="تعریف نوع ابزار و قیمت پایه برای خدمات برش و ابزار سنگ" backHref="/dashboard/inventory/services" error={errors.general}>
      <InventoryMasterDataForm
        kind="cuttingType"
        values={formData}
        errors={errors}
        pending={loading}
        submitLabel="ایجاد نوع ابزار"
        onChange={(patch) => setFormData((previous) => ({ ...previous, ...patch }))}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </InventoryMasterDataPage>
  );
};

export default CreateCuttingTypePage;
