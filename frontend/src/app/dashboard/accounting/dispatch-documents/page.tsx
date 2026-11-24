'use client';

import { useEffect, useMemo, useState } from 'react';
import { ErpLoading, ErpPage } from '@/components/erp';
import { useAuth } from '@/contexts/AuthContext';
import { useWorkspace, WORKSPACES } from '@/contexts/WorkspaceContext';
import AccountingDispatchDocuments from '@/features/accounting/dispatch-documents/AccountingDispatchDocuments';
import { createFixtureDispatchDocumentsClient } from '@/features/accounting/dispatch-documents/dispatchDocumentsFixture';
import { createDispatchDocumentsHttpClient } from '@/features/accounting/dispatch-documents/dispatchDocumentsClient';
import type { DispatchDocumentPermission } from '@/features/accounting/dispatch-documents/dispatchDocumentsViewModel';

export default function AccountingDispatchDocumentsPage() {
  const { user } = useAuth();
  const { permissionsReady, getWorkspacePermission } = useWorkspace();
  const permission = getWorkspacePermission(WORKSPACES.ACCOUNTING);
  const [fixture, setFixture] = useState<DispatchDocumentPermission>();
  const client = useMemo(() => fixture ? createFixtureDispatchDocumentsClient(fixture)
    : createDispatchDocumentsHttpClient(undefined, user?.id), [fixture, user?.id]);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const requested = new URL(window.location.href).searchParams.get('fixtureRole')?.toUpperCase();
    if (requested === 'MANAGE' || requested === 'VIEW' || requested === 'UNAUTHORIZED') {
      setFixture(requested);
    }
  }, []);

  return <ErpPage
    eyebrow="حسابداری"
    title="اسناد ارسال مشتری"
    description="صف مشترک بررسی، صدور و سابقه بارنامه و صورت‌حساب محموله"
    backHref="/dashboard/accounting"
  >
    {user && permissionsReady ? (
      <AccountingDispatchDocuments key={JSON.stringify([user.id, permission, fixture])} client={client} actorId={user.id} />
    ) : <ErpLoading />}
  </ErpPage>;
}
