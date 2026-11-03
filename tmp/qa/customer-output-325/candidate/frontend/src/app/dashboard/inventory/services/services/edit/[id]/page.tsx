'use client';
import { ErpLoading } from '@/components/erp';
import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { servicesAPI } from '@/lib/api';
import { InventoryMasterDataForm, InventoryMasterDataPage } from '@/features/inventory/master-data/InventoryMasterDataUi';

const EditServicePage: React.FC = () => {
  const router = useRouter();
  const params = useParams();
  const serviceId = params.id as string;

  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    namePersian: '',
    description: '',
    images: [] as string[],
    isActive: true
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    loadService();
  }, [serviceId]);

  const loadService = async () => {
    try {
      setInitialLoading(true);
      const response = await servicesAPI.getService(serviceId);

      if (response.data.success) {
        const service = response.data.data;
        setFormData({
          code: service.code,
          name: service.name || '',
          namePersian: service.namePersian,
          description: service.description || '',
          images: service.images || [],
          isActive: service.isActive
        });
      } else {
        setErrors({ general: 'خطا در دریافت اطلاعات خدمت' });
      }
    } catch (error) {
      console.error('Error loading service:', error);
      setErrors({ general: 'خطا در دریافت اطلاعات خدمت' });
    } finally {
      setInitialLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    try {
      const response = await servicesAPI.updateService(serviceId, formData);

      if (response.data.success) {
        // Redirect back to services page
        router.push('/dashboard/inventory/services');
      } else {
        setErrors({ general: 'خطا در دریافت اطلاعات خدمت' });
      }
    } catch (error: any) {
      console.error('Error updating service:', error);

      if (error.response?.data?.details) {
        const newErrors: Record<string, string> = {};
        error.response.data.details.forEach((detail: any) => {
          newErrors[detail.path] = detail.msg;
        });
        setErrors(newErrors);
      } else {
        setErrors({ general: 'خطا در دریافت اطلاعات خدمت' });
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
    <InventoryMasterDataPage title="ویرایش خدمت" description="اطلاعات خدمت اصلی و وضعیت آن را به‌روزرسانی کنید" backHref="/dashboard/inventory/services" error={errors.general}>
      <InventoryMasterDataForm
        kind="service"
        values={formData}
        errors={errors}
        pending={loading}
        submitLabel="ذخیره خدمت"
        onChange={(patch) => setFormData((previous) => ({ ...previous, ...patch }))}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </InventoryMasterDataPage>
  );
};

export default EditServicePage;
