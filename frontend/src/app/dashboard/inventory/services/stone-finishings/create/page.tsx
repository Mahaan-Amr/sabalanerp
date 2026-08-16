'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { servicesAPI } from '@/lib/api';
import { InventoryMasterDataForm, InventoryMasterDataPage } from '@/features/inventory/master-data/InventoryMasterDataUi';

const CreateStoneFinishingPage: React.FC = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    code: '',
    namePersian: '',
    name: '',
    description: '',
    pricePerSquareMeter: '',
    calculationBase: 'squareMeters' as 'length' | 'squareMeters',
    images: [] as string[],
    isActive: true
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    if (!formData.code.trim()) {
      setErrors({ code: 'کد فرآوری سنگ الزامی است' });
      setLoading(false);
      return;
    }

    try {
      const response = await servicesAPI.createStoneFinishing({
        ...formData,
        unitPrice: parseFloat(formData.pricePerSquareMeter || '0'),
        pricePerSquareMeter: parseFloat(formData.pricePerSquareMeter || '0')
      });

      if (response.data.success) {
        router.push('/dashboard/inventory/services');
      } else {
        setErrors({ general: 'خطا در ایجاد فرآوری سنگ' });
      }
    } catch (error: any) {
      console.error('Error creating stone finishing:', error);
      if (error.response?.data?.details) {
        const newErrors: Record<string, string> = {};
        error.response.data.details.forEach((detail: any) => {
          const key = Array.isArray(detail.path) ? detail.path.join('.') : detail.path;
          newErrors[key] = detail.msg;
        });
        setErrors(newErrors);
      } else {
        setErrors({ general: 'خطا در ایجاد فرآوری سنگ' });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    router.push('/dashboard/inventory/services');
  };

  return (
    <InventoryMasterDataPage title="ایجاد فرآوری سنگ" description="تعریف نوع فرآوری، پرداخت یا سطح نهایی سنگ" backHref="/dashboard/inventory/services" error={errors.general}>
      <InventoryMasterDataForm
        kind="stoneFinishing"
        values={formData}
        errors={errors}
        pending={loading}
        submitLabel="ایجاد فرآوری سنگ"
        onChange={(patch) => setFormData((previous) => ({ ...previous, ...patch }))}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </InventoryMasterDataPage>
  );
};

export default CreateStoneFinishingPage;

