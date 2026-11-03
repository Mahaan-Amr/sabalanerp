'use client';

import { useCallback, useEffect, useState } from 'react';
import { FaBell, FaCalendarAlt, FaKey, FaRedo, FaShieldAlt, FaUser } from 'react-icons/fa';
import { dashboardAPI, notificationsAPI } from '@/lib/api';
import {
  ErpActionGrid,
  ErpBadge,
  ErpInlineState,
  ErpSection,
  ErpSkeleton,
  ErpSummaryGrid,
  ErpWorkspacePage,
} from '@/components/erp';

const roleLabels: Record<string, string> = { ADMIN: 'مدیر سیستم', MANAGER: 'مدیر', USER: 'کاربر' };

export default function PersonalHubPage() {
  const [profile, setProfile] = useState<any>(null);
  const [securityAlerts, setSecurityAlerts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [profileResponse, alertsResponse] = await Promise.all([
        dashboardAPI.getProfile(),
        notificationsAPI.list({ state: 'UNREAD', category: 'SECURITY', limit: 5 }),
      ]);
      setProfile(profileResponse.data.data);
      setSecurityAlerts((alertsResponse.data.data || []).length);
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'دریافت اطلاعات حساب انجام نشد.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <ErpWorkspacePage title="امور شخصی" primaryAction={{ label: 'به‌روزرسانی', icon: FaRedo, onClick: () => void load(), disabled: loading }}>
      <div className="space-y-4" dir="rtl">
        {error && <ErpInlineState kind={profile ? 'stale' : 'error'} title={error} action={{ label: 'تلاش دوباره', onClick: () => void load() }} />}
        {loading && !profile ? <ErpSkeleton lines={4} /> : profile && (
          <>
            {(profile.mustChangePassword || securityAlerts > 0) && (
              <ErpInlineState
                kind="stale"
                title={profile.mustChangePassword ? 'تغییر رمز عبور برای ادامه کار الزامی است.' : `${securityAlerts.toLocaleString('fa-IR')} هشدار امنیتی نیازمند بررسی است.`}
                action={profile.mustChangePassword ? { label: 'تغییر رمز عبور', href: '/change-password' } : { label: 'بررسی امنیت حساب', href: '/dashboard/personal/security' }}
              />
            )}
            <ErpSection>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[var(--sds-accent-soft)] text-xl font-black text-[var(--sds-accent)] shadow-[var(--sds-shadow-raised)]">
                  {(profile.firstName?.[0] || profile.username?.[0] || 'س').toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl font-black sds-text-primary">{profile.firstName} {profile.lastName}</h1>
                    <ErpBadge tone={profile.isActive ? 'success' : 'danger'}>{profile.isActive ? 'فعال' : 'غیرفعال'}</ErpBadge>
                  </div>
                  <p className="mt-1 text-sm sds-text-muted">@{profile.username}</p>
                </div>
              </div>
              <div className="mt-4">
                <ErpSummaryGrid columns={3} items={[
                  { label: 'نقش', value: roleLabels[profile.role] || profile.role },
                  { label: 'واحد سازمانی', value: profile.department?.namePersian || '—' },
                  { label: 'ایمیل', value: profile.email || '—' },
                  { label: 'تلفن', value: profile.profile?.phone || '—' },
                  { label: 'شهر', value: profile.profile?.city || '—' },
                  { label: 'وضعیت رمز', value: profile.mustChangePassword ? 'نیازمند تغییر' : 'فعال' },
                ]} />
              </div>
            </ErpSection>
            <ErpActionGrid columns={4} compact items={[
              { title: 'مرخصی‌های من', href: '/dashboard/personal/leave', icon: FaCalendarAlt, tone: 'primary' },
              { title: 'امنیت و نشست‌ها', href: '/dashboard/personal/security', icon: FaShieldAlt, tone: securityAlerts ? 'warning' : 'neutral', badge: securityAlerts ? <ErpBadge tone="warning">{securityAlerts.toLocaleString('fa-IR')}</ErpBadge> : undefined },
              { title: 'اعلان‌ها', href: '/dashboard/personal/notifications', icon: FaBell, tone: 'info' },
              { title: 'تغییر رمز عبور', href: '/change-password', icon: FaKey, tone: 'neutral' },
            ]} />
          </>
        )}
      </div>
    </ErpWorkspacePage>
  );
}
