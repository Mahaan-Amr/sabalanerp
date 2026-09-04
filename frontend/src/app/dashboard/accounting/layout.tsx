'use client';

import type { ReactNode } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AccountingActorBoundary } from '@/features/accounting/AccountingActorBoundary';

export default function AccountingLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  return <AccountingActorBoundary actorId={user?.id ?? null} loading={loading}>{children}</AccountingActorBoundary>;
}
