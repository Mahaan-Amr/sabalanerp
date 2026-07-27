'use client';
import { ErpInput, ErpPressable, ErpSelect } from '@/components/erp';
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
      description="اطلاعات حساب، نقش، بخش و شماره تماس ورود را بروزرسانی کنید؛ پرونده و برنامه کاری پرسنل فقط در HR تغییر می‌کند."
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
            <div className="rounded-lg border border-[var(--sds-danger-border)] bg-[var(--sds-danger-surface)] p-4 text-sm font-medium text-[var(--sds-danger)] dark:border-[var(--sds-danger-border)] dark:bg-[var(--sds-danger-surface)] dark:text-[var(--sds-danger)]">
              {error}
            </div>
          )}

          <ErpSection title="اطلاعات پایه">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">نام *</span>
                <ErpInput name="firstName" value={formData.firstName} onChange={handleInputChange} className="sds-field w-full" required />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">نام خانوادگی *</span>
                <ErpInput name="lastName" value={formData.lastName} onChange={handleInputChange} className="sds-field w-full" required />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">ایمیل *</span>
                <ErpInput type="email" name="email" value={formData.email} onChange={handleInputChange} className="sds-field w-full" dir="ltr" required />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">نام کاربری *</span>
                <ErpInput name="username" value={formData.username} onChange={handleInputChange} className="sds-field w-full" dir="ltr" required />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">شماره تماس</span>
                <ErpInput type="tel" name="phone" value={formData.phone} onChange={handleInputChange} className="sds-field w-full" dir="ltr" />
              </label>
            </div>
          </ErpSection>

          <ErpSection title="نقش و وضعیت">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">نقش</span>
                <ErpSelect name="role" value={formData.role} onChange={handleInputChange} className="sds-field w-full">
                  <option value="USER">کاربر</option>
                  <option value="MODERATOR">ناظر</option>
                  <option value="SALES">فروش</option>
                  {currentUserRole !== 'MANAGER' && (
                    <>
                      <option value="MANAGER">مدیر</option>
                      <option value="ADMIN">مدیر سیستم</option>
                    </>
                  )}
                </ErpSelect>
              </label>
              <label className="block">
                <span className="mb-2 block text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">بخش</span>
                <ErpSelect name="departmentId" value={formData.departmentId} onChange={handleInputChange} className="sds-field w-full">
                  <option value="">بدون بخش</option>
                  {departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.namePersian}
                    </option>
                  ))}
                </ErpSelect>
              </label>
              <label className="flex items-center gap-2">
                <ErpInput type="checkbox" name="isActive" checked={formData.isActive} onChange={handleInputChange} className="rounded border-[var(--sds-border-default)] text-[var(--sds-accent)] focus:ring-[var(--sds-focus-ring)]" />
                <span className="text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">کاربر فعال</span>
              </label>
            </div>
          </ErpSection>

          <div className="flex flex-wrap justify-end gap-2">
            <ErpButton label="انصراف" href={`/dashboard/users/${params.id}`} tone="neutral" variant="outline" icon={FaTimes} />
            <ErpPressable
              type="submit"
              disabled={saving}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[var(--sds-accent)] bg-[var(--sds-accent)] px-3 py-2 text-sm font-semibold text-[var(--sds-text-inverse)] transition-colors hover:bg-[var(--sds-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FaCheck className="h-4 w-4" />
              <span>{saving ? 'در حال ذخیره...' : 'ذخیره'}</span>
            </ErpPressable>
          </div>
        </form>
      )}
    </ErpPage>
  );
}
