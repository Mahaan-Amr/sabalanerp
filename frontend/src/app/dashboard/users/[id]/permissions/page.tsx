'use client';
import { useEffect, use } from 'react';
import { useRouter } from 'next/navigation';

export default function UserPermissionsRedirectPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const router = useRouter();

  useEffect(() => {
    router.replace(`/dashboard/hr/permissions?userId=${params.id}`);
  }, [params.id, router]);

  return (
    <main className="sds-workspace text-center">
      <p className="text-secondary">در حال انتقال به صفحه مدیریت دسترسی‌ها...</p>
    </main>
  );
}
