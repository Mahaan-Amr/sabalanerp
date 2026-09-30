'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AccountingActorBoundary } from '@/features/accounting/AccountingActorBoundary';

export default function AccountingLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  return (
    <div className="sds-neumorphic-scope sds-neumorphic-workflow-scope min-h-[calc(100vh-8rem)] rounded-[var(--sds-radius-card)] bg-[var(--sds-surface-canvas)] p-3 sm:p-4">
      <AccountingActorBoundary actorId={user?.id ?? null} loading={loading}>{children}</AccountingActorBoundary>
    </div>
  );
}
