'use client';
import { ErpLoading } from '@/components/erp';
import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { servicesAPI } from '@/lib/api';
import { InventoryMasterDataForm, InventoryMasterDataPage } from '@/features/inventory/master-data/InventoryMasterDataUi';

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
      <InventoryMasterDataForm
        kind="subService"
        values={formData}
        errors={errors}
        pending={loading}
        submitLabel="ذخیره ابزار"
        onChange={(patch) => setFormData((previous) => ({ ...previous, ...patch }))}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </InventoryMasterDataPage>
  );
};

export default EditSubServicePage;
