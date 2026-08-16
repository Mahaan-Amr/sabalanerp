'use client';
import { ErpLoading } from '@/components/erp';
import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { servicesAPI } from '@/lib/api';
import { InventoryMasterDataForm, InventoryMasterDataPage } from '@/features/inventory/master-data/InventoryMasterDataUi';

const EditStoneFinishingPage: React.FC = () => {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const finishingId = params?.id;

  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
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

  useEffect(() => {
    const loadFinishing = async () => {
      if (!finishingId) return;
      try {
        const response = await servicesAPI.getStoneFinishing(finishingId);
        if (response.data.success) {
          const data = response.data.data;
          setFormData({
            code: data.code || '',
            namePersian: data.namePersian || '',
            name: data.name || '',
            description: data.description || '',
            pricePerSquareMeter: (data.unitPrice ?? data.pricePerSquareMeter)?.toString() || '',
            calculationBase: data.calculationBase === 'length' ? 'length' : 'squareMeters',
            images: data.images || [],
            isActive: data.isActive
          });
        } else {
          setErrors({ general: 'فرآوری سنگ یافت نشد' });
        }
      } catch (error) {
        console.error('Error loading stone finishing:', error);
        setErrors({ general: 'فرآوری سنگ یافت نشد' });
      } finally {
        setInitialLoading(false);
      }
    };

    loadFinishing();
  }, [finishingId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!finishingId) return;
    setLoading(true);
    setErrors({});

    if (!formData.code.trim()) {
      setErrors({ code: 'کد فرآوری سنگ الزامی است' });
      setLoading(false);
      return;
    }

    try {
      const response = await servicesAPI.updateStoneFinishing(finishingId, {
        ...formData,
        unitPrice: parseFloat(formData.pricePerSquareMeter || '0'),
        pricePerSquareMeter: parseFloat(formData.pricePerSquareMeter || '0')
      });

      if (response.data.success) {
        router.push('/dashboard/inventory/services');
      } else {
        setErrors({ general: 'فرآوری سنگ یافت نشد' });
      }
    } catch (error: any) {
      console.error('Error updating stone finishing:', error);
      if (error.response?.data?.details) {
        const newErrors: Record<string, string> = {};
        error.response.data.details.forEach((detail: any) => {
          const key = Array.isArray(detail.path) ? detail.path.join('.') : detail.path;
          newErrors[key] = detail.msg;
        });
        setErrors(newErrors);
      } else {
        setErrors({ general: 'فرآوری سنگ یافت نشد' });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!finishingId) return;
    if (!confirm('آیا از حذف این فرآوری سنگ مطمئن هستید؟')) return;
    try {
      await servicesAPI.deleteStoneFinishing(finishingId);
      router.push('/dashboard/inventory/services');
    } catch (error) {
      console.error('Error deleting stone finishing:', error);
      setErrors({ general: 'فرآوری سنگ یافت نشد' });
    }
  };

  const handleCancel = () => {
    router.push('/dashboard/inventory/services');
  };

  if (initialLoading) return <ErpLoading />;

  return (
    <InventoryMasterDataPage title="ویرایش فرآوری سنگ" description="اطلاعات فرآوری سنگ، قیمت و وضعیت آن را به‌روزرسانی کنید" backHref="/dashboard/inventory/services" error={errors.general}>
      <InventoryMasterDataForm
        kind="stoneFinishing"
        values={formData}
        errors={errors}
        pending={loading}
        submitLabel="ذخیره فرآوری سنگ"
        onChange={(patch) => setFormData((previous) => ({ ...previous, ...patch }))}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        deleteAction={{ label: 'حذف فرآوری سنگ', onClick: handleDelete }}
      />
    </InventoryMasterDataPage>
  );
};

export default EditStoneFinishingPage;
