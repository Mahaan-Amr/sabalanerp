'use client';
import { ErpInput, ErpPressable, ErpTextarea } from '@/components/erp';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  FaBuilding,
  FaArrowRight,
  FaCheck,
  FaTimes
} from 'react-icons/fa';
import { departmentsAPI } from '@/lib/api';

export default function CreateDepartmentPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await departmentsAPI.createDepartment(formData);

      if (response.data.success) {
        alert('دپارتمان با موفقیت ایجاد شد');
        router.push('/dashboard/departments');
      }
    } catch (error: any) {
      console.error('Error creating department:', error);
      setError(error.response?.data?.error || 'خطا در ایجاد دپارتمان');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="sds-workspace space-y-6">
      {/* Header */}
      <div className="sds-workspace-surface p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4 space-x-reverse">
            <FaBuilding className="h-8 w-8 text-[var(--sds-accent)]" />
            <div>
              <h1 className="text-2xl font-bold text-primary">ایجاد دپارتمان جدید</h1>
              <p className="text-secondary">تعریف دپارتمان و واحد سازمانی جدید</p>
            </div>
          </div>
          <Link
            href="/dashboard/departments"
            className="sds-action px-6 py-2 flex items-center space-x-2 space-x-reverse"
          >
            <FaArrowRight />
            <span>بازگشت به لیست</span>
          </Link>
        </div>
      </div>

      {error && (
        <div className="sds-workspace-surface p-4 bg-[var(--sds-danger-surface)] border border-[var(--sds-danger-border)]">
          <div className="flex items-center space-x-2 space-x-reverse">
            <FaTimes className="text-[var(--sds-danger)]" />
            <p className="text-[var(--sds-danger)]">{error}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Department Information */}
        <div className="sds-workspace-surface p-6">
          <h2 className="text-xl font-bold text-primary mb-4">اطلاعات دپارتمان</h2>
          <div className="space-y-6">
            <div>
              <label className="block text-sm text-secondary mb-2">نام انگلیسی *</label>
              <ErpInput
                type="text"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                className="sds-field w-full"
                placeholder="Department Name"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-secondary mb-2">نام فارسی *</label>
              <ErpInput
                type="text"
                name="namePersian"
                value={formData.namePersian}
                onChange={handleInputChange}
                className="sds-field w-full"
                placeholder="نام دپارتمان"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-secondary mb-2">توضیحات *</label>
              <ErpTextarea
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                className="sds-field w-full h-24 resize-none"
                placeholder="توضیح کوتاه درباره دپارتمان..."
                required
              />
            </div>

            <div>
              <label className="flex items-center space-x-2 space-x-reverse">
                <ErpInput
                  type="checkbox"
                  name="isActive"
                  checked={formData.isActive}
                  onChange={handleInputChange}
                  className="rounded border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] text-[var(--sds-accent)] focus:ring-[var(--sds-accent)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-accent)] dark:focus:ring-[var(--sds-focus-ring)]"
                />
                <span className="text-secondary">فعال باشد</span>
              </label>
            </div>
          </div>
        </div>

        {/* Submit Buttons */}
        <div className="sds-workspace-surface p-6">
          <div className="flex items-center justify-end space-x-4 space-x-reverse">
            <Link
              href="/dashboard/departments"
              className="sds-action px-6 py-2"
            >
              انصراف
            </Link>
            <ErpPressable
              type="submit"
              disabled={loading}
              className="sds-action sds-tone-primary sds-action-solid px-6 py-2 flex items-center space-x-2 space-x-reverse disabled:opacity-50"
            >
              {loading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[var(--sds-border-default)]"></div>
              ) : (
                <FaCheck />
              )}
              <span>{loading ? 'در حال ذخیره...' : 'ایجاد دپارتمان'}</span>
            </ErpPressable>
          </div>
        </div>
      </form>
    </main>
  );
}

