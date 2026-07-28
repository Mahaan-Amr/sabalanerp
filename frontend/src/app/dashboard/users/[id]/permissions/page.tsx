'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function UserPermissionsRedirectPage({ params }: { params: { id: string } }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(`/dashboard/admin/permissions?userId=${params.id}`);
  }, [params.id, router]);

  return (
    <main className="sds-workspace text-center">
      <p className="text-secondary">در حال انتقال به صفحه مدیریت دسترسی‌ها...</p>
    </main>
  );
}
