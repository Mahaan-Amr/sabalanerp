'use client';

import React, { type ReactNode } from 'react';
import { ErpInlineState, ErpSkeleton } from '@/components/erp';

/** Scope all Accounting row, focus, draft and modal state to one resolved actor.
 * Changing identity remounts the subtree; a late response to an unmounted view
 * cannot populate the next actor's state. Server permissions remain authoritative. */
export function AccountingActorBoundary({ actorId, loading, children }: {
  actorId: string | null; loading: boolean; children: ReactNode;
}) {
  if (loading) return <ErpSkeleton lines={4} label="در حال بررسی دسترسی حسابداری" />;
  if (!actorId) return <ErpInlineState kind="permission" title="ورود به حساب برای مشاهده حسابداری لازم است." />;
  return <React.Fragment key={actorId}>{children}</React.Fragment>;
}
