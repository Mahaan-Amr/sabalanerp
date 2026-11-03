'use client';
import {
  ErpButton,
  ErpCheckbox,
  ErpField,
  ErpInlineState,
  ErpInput,
  ErpPage,
  ErpSection,
  ErpTextarea
} from '@/components/erp';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FaCheck } from 'react-icons/fa';
import { departmentsAPI } from '@/lib/api';
import ErrorModal from '@/components/ErrorModal';
import SuccessModal from '@/components/SuccessModal';

export default function CreateDepartmentPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const submitFocusRef = useRef<HTMLElement | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    namePersian: '',
    description: '',
    isActive: true
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value
    }));
  };

  const validateForm = () => {
    if (!formData.name.trim()) {
      setError('نام انگلیسی الزامی است');
      return false;
    }
    if (!formData.namePersian.trim()) {
      setError('نام فارسی الزامی است');
      return false;
    }
    if (!formData.description.trim()) {
      setError('توضیحات الزامی است');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    submitFocusRef.current = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;

    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setError(null);
    setOperationError(null);

    try {
      const response = await departmentsAPI.createDepartment(formData);

      if (response.data.success) {
        setSuccess('دپارتمان با موفقیت ایجاد شد');
      }
    } catch (error: any) {
      console.error('Error creating department:', error);
      setOperationError(error.response?.data?.error || 'خطا در ایجاد دپارتمان');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ErpPage
      title="ایجاد دپارتمان جدید"
      description="تعریف دپارتمان و واحد سازمانی جدید"
      backHref="/dashboard/departments"
    >
      {error ? <ErpInlineState kind="error" title={error} /> : null}
      {success ? <ErpInlineState kind="success" title={success} /> : null}

      <form onSubmit={handleSubmit} className="space-y-6">
        <ErpSection title="اطلاعات دپارتمان">
          <div className="space-y-6">
            <ErpField label="نام انگلیسی" required>
              <ErpInput
                type="text"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                placeholder="Department Name"
                required
              />
            </ErpField>

            <ErpField label="نام فارسی" required>
              <ErpInput
                type="text"
                name="namePersian"
                value={formData.namePersian}
                onChange={handleInputChange}
                placeholder="نام دپارتمان"
                required
              />
            </ErpField>

            <ErpField label="توضیحات" required>
              <ErpTextarea
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                placeholder="توضیح کوتاه درباره دپارتمان..."
                required
              />
            </ErpField>

            <ErpCheckbox
              label="فعال باشد"
              name="isActive"
              checked={formData.isActive}
              onChange={handleInputChange}
            />
          </div>
        </ErpSection>

        <ErpSection>
          <div className="flex flex-wrap justify-end gap-3">
            <ErpButton label="انصراف" href="/dashboard/departments" tone="neutral" variant="outline" />
            <ErpButton
              type="submit"
              label={loading ? 'در حال ذخیره...' : 'ایجاد دپارتمان'}
              icon={FaCheck}
              disabled={loading || Boolean(success)}
              tone="primary"
              variant="solid"
            />
          </div>
        </ErpSection>
      </form>
      <SuccessModal
        isOpen={Boolean(success)}
        message={success || ''}
        onClose={() => router.push('/dashboard/departments')}
        autoClose
        autoCloseDelay={2000}
      />
      <ErrorModal
        isOpen={Boolean(operationError)}
        message="ایجاد دپارتمان انجام نشد"
        details={operationError || undefined}
        onClose={() => setOperationError(null)}
        returnFocusElement={submitFocusRef.current}
      />
    </ErpPage>
  );
}
