'use client';
import { ErpLoading } from '@/components/erp';
import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { servicesAPI } from '@/lib/api';
import { InventoryMasterDataForm, InventoryMasterDataPage } from '@/features/inventory/master-data/InventoryMasterDataUi';

const EditCuttingTypePage: React.FC = () => {
  const router = useRouter();
  const params = useParams();
  const cuttingTypeId = params.id as string;

  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
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

  useEffect(() => {
    loadCuttingType();
  }, [cuttingTypeId]);

  const loadCuttingType = async () => {
    try {
      setInitialLoading(true);
      const response = await servicesAPI.getCuttingType(cuttingTypeId);

      if (response.data.success) {
        const cuttingType = response.data.data;
        setFormData({
          code: cuttingType.code,
          name: cuttingType.name || '',
          namePersian: cuttingType.namePersian,
          description: cuttingType.description || '',
          pricePerMeter: cuttingType.pricePerMeter ? cuttingType.pricePerMeter.toString() : '',
          images: cuttingType.images || [],
          isActive: cuttingType.isActive
        });
      } else {
        setErrors({ general: 'خطا در دریافت اطلاعات نوع ابزار' });
      }
    } catch (error) {
      console.error('Error loading cutting type:', error);
      setErrors({ general: 'خطا در دریافت اطلاعات نوع ابزار' });
    } finally {
      setInitialLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    try {
      const response = await servicesAPI.updateCuttingType(cuttingTypeId, formData);

      if (response.data.success) {
        // Redirect back to services page
        router.push('/dashboard/inventory/services');
      } else {
        setErrors({ general: 'خطا در دریافت اطلاعات نوع ابزار' });
      }
    } catch (error: any) {
      console.error('Error updating cutting type:', error);

      if (error.response?.data?.details) {
        const newErrors: Record<string, string> = {};
        error.response.data.details.forEach((detail: any) => {
          newErrors[detail.path] = detail.msg;
        });
        setErrors(newErrors);
      } else {
        setErrors({ general: 'خطا در دریافت اطلاعات نوع ابزار' });
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
    <InventoryMasterDataPage title="ویرایش نوع ابزار" description="اطلاعات نوع ابزار، قیمت و وضعیت آن را به‌روزرسانی کنید" backHref="/dashboard/inventory/services" error={errors.general}>
      <InventoryMasterDataForm
        kind="cuttingType"
        values={formData}
        errors={errors}
        pending={loading}
        submitLabel="ذخیره نوع ابزار"
        onChange={(patch) => setFormData((previous) => ({ ...previous, ...patch }))}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </InventoryMasterDataPage>
  );
};

export default EditCuttingTypePage;
