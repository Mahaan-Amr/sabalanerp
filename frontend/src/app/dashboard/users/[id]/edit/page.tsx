'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FaCheck, FaTimes, FaUserEdit } from 'react-icons/fa';
import { ErpButton, ErpEmptyState, ErpLoading, ErpPage, ErpSection } from '@/components/erp';
import { authAPI, departmentsAPI, usersAPI } from '@/lib/api';

interface Department {
  id: string;
  name: string;
  namePersian: string;
  isActive: boolean;
}

interface UserFormState {
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  phone: string;
  role: string;
  departmentId: string;
  isActive: boolean;
}

const initialFormState: UserFormState = {
  firstName: '',
  lastName: '',
  email: '',
  username: '',
  phone: '',
  role: 'USER',
  departmentId: '',
  isActive: true,
};

export default function EditUserPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [formData, setFormData] = useState<UserFormState>(initialFormState);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [targetUserRole, setTargetUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const [userResponse, departmentsResponse, meResponse] = await Promise.all([
          usersAPI.getUser(params.id),
          departmentsAPI.getDepartments(),
          authAPI.getMe(),
        ]);

        if (userResponse.data.success) {
          const user = userResponse.data.data;
          setTargetUserRole(user.role);
          setFormData({
            firstName: user.firstName || '',
            lastName: user.lastName || '',
            email: user.email || '',
            username: user.username || '',
            phone: user.profile?.phone || '',
            role: user.role || 'USER',
            departmentId: user.department?.id || '',
            isActive: Boolean(user.isActive),
          });
        }

        if (departmentsResponse.data.success) {
          setDepartments(departmentsResponse.data.data);
        }

        if (meResponse.data.success) {
          setCurrentUserRole(meResponse.data.data.role);
        }
      } catch (error: any) {
        setError(error.response?.data?.error || 'خطا در بارگذاری اطلاعات کاربر');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [params.id]);

  const handleInputChange = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = event.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? (event.target as HTMLInputElement).checked : value,
    }));
  };

  const validateForm = () => {
    if (!formData.firstName.trim()) return 'نام الزامی است';
    if (!formData.lastName.trim()) return 'نام خانوادگی الزامی است';
    if (!formData.email.trim()) return 'ایمیل الزامی است';
    if (!/\S+@\S+\.\S+/.test(formData.email)) return 'فرمت ایمیل معتبر نیست';
    if (!formData.username.trim()) return 'نام کاربری الزامی است';
    if (formData.username.trim().length < 3) return 'نام کاربری باید حداقل ۳ کاراکتر باشد';
    if (currentUserRole === 'MANAGER' && ['ADMIN', 'MANAGER'].includes(formData.role)) {
      return 'مدیر نمی‌تواند نقش مدیر سیستم یا مدیر را اختصاص دهد';
    }
    return null;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setSaving(true);
      setError(null);
      const response = await usersAPI.updateUser(params.id, {
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        username: formData.username,
        phone: formData.phone,
        role: formData.role,
        departmentId: formData.departmentId,
        isActive: formData.isActive,
      });

      if (response.data.success) {
        router.push(`/dashboard/users/${params.id}`);
      }
    } catch (error: any) {
      const details = error.response?.data?.details;
      const detailMessage = Array.isArray(details) && details.length > 0 ? details[0].msg : null;
      setError(detailMessage || error.response?.data?.error || 'خطا در بروزرسانی کاربر');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <ErpLoading />;

  if (error && !targetUserRole) {
    return (
      <ErpEmptyState
        icon={FaUserEdit}
        title="امکان ویرایش کاربر وجود ندارد"
        description={error}
        action={{ label: 'بازگشت به کاربران', href: '/dashboard/users', tone: 'primary', variant: 'solid' }}
      />
    );
  }

  const managerEditingAdmin = currentUserRole === 'MANAGER' && targetUserRole === 'ADMIN';

  return (
    <ErpPage
      eyebrow="مدیریت سیستم"
      title="ویرایش کاربر"
      description="اطلاعات حساب، نقش، بخش و شماره تماس ورود را بروزرسانی کنید."
      backHref={`/dashboard/users/${params.id}`}
    >
      {managerEditingAdmin ? (
        <ErpEmptyState
          icon={FaUserEdit}
          title="دسترسی محدود است"
          description="مدیر نمی‌تواند کاربر مدیر سیستم را ویرایش کند."
          action={{ label: 'بازگشت به کاربران', href: '/dashboard/users', tone: 'primary', variant: 'solid' }}
        />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
              {error}
            </div>
          )}

          <ErpSection title="اطلاعات پایه">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm text-slate-600 dark:text-slate-300">نام *</span>
                <input name="firstName" value={formData.firstName} onChange={handleInputChange} className="glass-liquid-input w-full" required />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm text-slate-600 dark:text-slate-300">نام خانوادگی *</span>
                <input name="lastName" value={formData.lastName} onChange={handleInputChange} className="glass-liquid-input w-full" required />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm text-slate-600 dark:text-slate-300">ایمیل *</span>
                <input type="email" name="email" value={formData.email} onChange={handleInputChange} className="glass-liquid-input w-full" dir="ltr" required />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm text-slate-600 dark:text-slate-300">نام کاربری *</span>
                <input name="username" value={formData.username} onChange={handleInputChange} className="glass-liquid-input w-full" dir="ltr" required />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm text-slate-600 dark:text-slate-300">شماره تماس</span>
                <input type="tel" name="phone" value={formData.phone} onChange={handleInputChange} className="glass-liquid-input w-full" dir="ltr" />
              </label>
            </div>
          </ErpSection>

          <ErpSection title="نقش و وضعیت">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm text-slate-600 dark:text-slate-300">نقش</span>
                <select name="role" value={formData.role} onChange={handleInputChange} className="glass-liquid-input w-full">
                  <option value="USER">کاربر</option>
                  <option value="MODERATOR">ناظر</option>
                  <option value="SALES">فروش</option>
                  {currentUserRole !== 'MANAGER' && (
                    <>
                      <option value="MANAGER">مدیر</option>
                      <option value="ADMIN">مدیر سیستم</option>
                    </>
                  )}
                </select>
              </label>
              <label className="block">
                <span className="mb-2 block text-sm text-slate-600 dark:text-slate-300">بخش</span>
                <select name="departmentId" value={formData.departmentId} onChange={handleInputChange} className="glass-liquid-input w-full">
                  <option value="">بدون بخش</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.namePersian}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" name="isActive" checked={formData.isActive} onChange={handleInputChange} className="rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
                <span className="text-sm text-slate-600 dark:text-slate-300">کاربر فعال</span>
              </label>
            </div>
          </ErpSection>

          <div className="flex flex-wrap justify-end gap-2">
            <ErpButton label="انصراف" href={`/dashboard/users/${params.id}`} tone="neutral" variant="outline" icon={FaTimes} />
            <button
              type="submit"
              disabled={saving}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#074747] bg-[#074747] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0b5c5c] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FaCheck className="h-4 w-4" />
              <span>{saving ? 'در حال ذخیره...' : 'ذخیره'}</span>
            </button>
          </div>
        </form>
      )}
    </ErpPage>
  );
}
