'use client';

import { useEffect, useState } from 'react';
import { FaBuilding, FaEdit, FaEnvelope, FaPhone, FaShieldAlt, FaUser } from 'react-icons/fa';
import { ErpBadge, ErpEmptyState, ErpFieldView, ErpLoading, ErpPage, ErpSection, ErpSummaryGrid, type ErpTone } from '@/components/erp';
import { usersAPI } from '@/lib/api';

interface UserDetails {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  department?: {
    id: string;
    name: string;
    namePersian: string;
  } | null;
  profile?: {
    phone?: string | null;
    address?: string | null;
    city?: string | null;
    country?: string | null;
    bio?: string | null;
  } | null;
}

const roleLabels: Record<string, string> = {
  ADMIN: 'مدیر سیستم',
  MANAGER: 'مدیر',
  SALES: 'فروش',
  MODERATOR: 'ناظر',
  USER: 'کاربر',
};

const roleTones: Record<string, ErpTone> = {
  ADMIN: 'danger',
  MANAGER: 'purple',
  SALES: 'success',
  MODERATOR: 'warning',
  USER: 'info',
};

const formatDate = (value: string) => new Date(value).toLocaleDateString('fa-IR');

export default function UserDetailsPage({ params }: { params: { id: string } }) {
  const [user, setUser] = useState<UserDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await usersAPI.getUser(params.id);
        if (response.data.success) {
          setUser(response.data.data);
        }
      } catch (error: any) {
        setError(error.response?.data?.error || 'خطا در بارگذاری کاربر');
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, [params.id]);

  if (loading) return <ErpLoading />;

  if (error || !user) {
    return (
      <ErpEmptyState
        icon={FaUser}
        title="کاربر پیدا نشد"
        description={error || 'اطلاعات این کاربر در دسترس نیست.'}
        action={{ label: 'بازگشت به کاربران', href: '/dashboard/users', tone: 'primary', variant: 'solid' }}
      />
    );
  }

  const fullName = `${user.firstName} ${user.lastName}`.trim();

  return (
    <ErpPage
      eyebrow="مدیریت سیستم"
      title={fullName || user.username}
      description="جزئیات حساب، وضعیت و اطلاعات تماس کاربر."
      backHref="/dashboard/users"
      actions={[
        { label: 'ویرایش', href: `/dashboard/users/${user.id}/edit`, icon: FaEdit, tone: 'primary', variant: 'solid' },
        { label: 'مدیریت دسترسی‌ها', href: `/dashboard/admin/permissions?userId=${user.id}`, icon: FaShieldAlt, tone: 'neutral', variant: 'outline' },
      ]}
      metrics={[
        { label: 'وضعیت', value: user.isActive ? 'فعال' : 'غیرفعال', icon: FaUser, tone: user.isActive ? 'success' : 'danger' },
        { label: 'نقش', value: roleLabels[user.role] || user.role, icon: FaShieldAlt, tone: roleTones[user.role] || 'neutral' },
        { label: 'بخش', value: user.department?.namePersian || 'بدون بخش', icon: FaBuilding, tone: 'info' },
        { label: 'تاریخ ایجاد', value: formatDate(user.createdAt), icon: FaUser, tone: 'neutral' },
      ]}
    >
      <ErpSection title="اطلاعات حساب">
        <ErpSummaryGrid
          columns={3}
          items={[
            { label: 'نام کامل', value: fullName || 'ثبت نشده', tone: 'primary' },
            { label: 'ایمیل', value: user.email, hint: <FaEnvelope className="inline h-3 w-3" />, tone: 'neutral' },
            { label: 'نام کاربری', value: `@${user.username}`, tone: 'neutral' },
            { label: 'شماره تماس', value: user.profile?.phone || 'ثبت نشده', hint: <FaPhone className="inline h-3 w-3" />, tone: 'neutral' },
            { label: 'نقش', value: <ErpBadge tone={roleTones[user.role] || 'neutral'}>{roleLabels[user.role] || user.role}</ErpBadge>, tone: 'neutral' },
            { label: 'آخرین بروزرسانی', value: formatDate(user.updatedAt), tone: 'neutral' },
          ]}
        />
      </ErpSection>

      <ErpSection title="اطلاعات تکمیلی">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <ErpFieldView label="نشانی" value={user.profile?.address || 'ثبت نشده'} />
          <ErpFieldView label="شهر" value={user.profile?.city || 'ثبت نشده'} />
          <ErpFieldView label="کشور" value={user.profile?.country || 'ثبت نشده'} />
          <ErpFieldView label="توضیحات" value={user.profile?.bio || 'ثبت نشده'} />
        </div>
      </ErpSection>
    </ErpPage>
  );
}
