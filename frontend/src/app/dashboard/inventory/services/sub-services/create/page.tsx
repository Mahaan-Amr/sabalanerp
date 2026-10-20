'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getOperationalErrorMessage } from '@/lib/operationalError';
import { servicesAPI } from '@/lib/api';
import { InventoryMasterDataForm, InventoryMasterDataPage } from '@/features/inventory/master-data/InventoryMasterDataUi';

const CreateSubServicePage: React.FC = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [submissionUncertain,setSubmissionUncertain]=useState(false);
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    namePersian: '',
    description: '',
    minimumQuantity: '',
    pricePerMeter: '',
    calculationBase: 'length' as 'length' | 'squareMeters',
    images: [] as string[],
    isActive: true
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if(submissionUncertain)return;
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
      if(!error?.response||Number(error.response.status)>=500)setSubmissionUncertain(true);
      console.error('Error creating sub-service:', error);

      if (error.response?.data?.details) {
        const newErrors: Record<string, string> = {};
        error.response.data.details.forEach((detail: any) => {
          newErrors[detail.path] = detail.msg;
        });
        setErrors(newErrors);
      } else {
        setErrors({ general: getOperationalErrorMessage(error, { failedAction: 'ذخیره اطلاعات خدمات', nextStep: 'اطلاعات حفظ شده است؛ مقدار و مجوز خود را بررسی و دوباره تلاش کنید.' }) });
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
      <InventoryMasterDataForm
        kind="subService"
        values={formData}
        errors={errors}
        pending={loading}
        submissionUncertain={submissionUncertain}
        draftScope={{route:'/dashboard/inventory/services/sub-services/create',record:'new',baseVersion:'new'}}
        submitLabel="ایجاد ابزار"
        onChange={(patch) => setFormData((previous) => ({ ...previous, ...patch }))}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </InventoryMasterDataPage>
  );
};

export default CreateSubServicePage;

