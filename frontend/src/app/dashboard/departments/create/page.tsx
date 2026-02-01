'use client';

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
      setError('نام بخش الزامی است');
      return false;
    }
    if (!formData.namePersian.trim()) {
      setError('نام فارسی بخش الزامی است');
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
        alert('بخش با موفقیت ایجاد شد');
        router.push('/dashboard/departments');
      }
    } catch (error: any) {
      console.error('Error creating department:', error);
      setError(error.response?.data?.error || 'خطا در ایجاد بخش');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-liquid-card p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4 space-x-reverse">
            <FaBuilding className="h-8 w-8 text-teal-500" />
            <div>
              <h1 className="text-2xl font-bold text-primary">ایجاد بخش جدید</h1>
              <p className="text-secondary">ایجاد بخش جدید در سازمان</p>
            </div>
          </div>
          <Link
            href="/dashboard/departments"
            className="glass-liquid-btn px-6 py-2 flex items-center space-x-2 space-x-reverse"
          >
            <FaArrowRight />
            <span>بازگشت به لیست</span>
          </Link>
        </div>
      </div>

      {error && (
        <div className="glass-liquid-card p-4 bg-red-500/20 border border-red-500/30">
          <div className="flex items-center space-x-2 space-x-reverse">
            <FaTimes className="text-red-500" />
            <p className="text-red-400">{error}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Department Information */}
        <div className="glass-liquid-card p-6">
          <h2 className="text-xl font-bold text-primary mb-4">اطلاعات بخش</h2>
          <div className="space-y-6">
            <div>
              <label className="block text-sm text-secondary mb-2">نام بخش (انگلیسی) *</label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleInputChange}
                className="glass-liquid-input w-full"
                placeholder="Department Name"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm text-secondary mb-2">نام بخش (فارسی) *</label>
              <input
                type="text"
                name="namePersian"
                value={formData.namePersian}
                onChange={handleInputChange}
                className="glass-liquid-input w-full"
                placeholder="نام بخش"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm text-secondary mb-2">توضیحات *</label>
              <textarea
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                className="glass-liquid-input w-full h-24 resize-none"
                placeholder="توضیحات مربوط به بخش..."
                required
              />
            </div>
            
            <div>
              <label className="flex items-center space-x-2 space-x-reverse">
                <input
                  type="checkbox"
                  name="isActive"
                  checked={formData.isActive}
                  onChange={handleInputChange}
                  className="rounded border-gray-600 bg-gray-700 text-teal-500 focus:ring-teal-500"
                />
                <span className="text-secondary">بخش فعال</span>
              </label>
            </div>
          </div>
        </div>

        {/* Submit Buttons */}
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-end space-x-4 space-x-reverse">
            <Link
              href="/dashboard/departments"
              className="glass-liquid-btn px-6 py-2"
            >
              لغو
            </Link>
            <button
              type="submit"
              disabled={loading}
              className="glass-liquid-btn-primary px-6 py-2 flex items-center space-x-2 space-x-reverse disabled:opacity-50"
            >
              {loading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              ) : (
                <FaCheck />
              )}
              <span>{loading ? 'در حال ایجاد...' : 'ایجاد بخش'}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
