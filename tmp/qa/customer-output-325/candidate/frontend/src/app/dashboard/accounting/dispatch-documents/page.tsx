'use client';

import { useEffect, useState } from 'react';
import { ErpPage } from '@/components/erp';
import AccountingDispatchDocuments from '@/features/accounting/dispatch-documents/AccountingDispatchDocuments';
import { createFixtureDispatchDocumentsClient } from '@/features/accounting/dispatch-documents/dispatchDocumentsFixture';
import { createDispatchDocumentsHttpClient, type DispatchDocumentsClient } from '@/features/accounting/dispatch-documents/dispatchDocumentsClient';
import type { DispatchDocumentPermission } from '@/features/accounting/dispatch-documents/dispatchDocumentsViewModel';

export default function AccountingDispatchDocumentsPage() {
  const [client, setClient] = useState<DispatchDocumentsClient>(() => createDispatchDocumentsHttpClient());

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const requested = new URL(window.location.href).searchParams.get('fixtureRole')?.toUpperCase();
    if (requested === 'MANAGE' || requested === 'VIEW' || requested === 'UNAUTHORIZED') {
      setClient(createFixtureDispatchDocumentsClient(requested as DispatchDocumentPermission));
    }
  }, []);

  return <ErpPage
    eyebrow="حسابداری"
    title="اسناد ارسال مشتری"
    description="صف مشترک بررسی، صدور و سابقه بارنامه و صورت‌حساب محموله"
    backHref="/dashboard/accounting"
  >
    <AccountingDispatchDocuments client={client} />
  </ErpPage>;
}
