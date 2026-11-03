'use client';

import React from 'react';
import { ErpCard, ErpInlineState, ErpPage, ErpSection, type ErpAction } from '@/components/erp';

type SalesAuthoringProgress = { current: number; total: number; label: React.ReactNode };
type SalesAuthoringFeedback = {
  kind: 'empty' | 'success' | 'error' | 'stale' | 'permission';
  title: React.ReactNode;
  action?: ErpAction;
};

export function hasSalesDraftChanged<T>(values: T, savedSnapshot: T) {
  return JSON.stringify(values) !== JSON.stringify(savedSnapshot);
}

export function hasContractTemplateDraft<T extends {
  name: string;
  namePersian: string;
  description: string;
  content: string;
  variables: object;
  structure: object;
  calculations: object;
}>(values: T) {
  return Boolean(
    values.name.trim()
    || values.namePersian.trim()
    || values.description.trim()
    || values.content.trim()
    || Object.keys(values.variables).length
    || Object.keys(values.structure).length
    || Object.keys(values.calculations).length
  );
}

export function SalesAuthoringFeedback({ feedback }: { feedback: SalesAuthoringFeedback }) {
  return <ErpInlineState kind={feedback.kind} title={feedback.title} action={feedback.action} />;
}

export function SalesAuthoringProgress({ current, total, label }: SalesAuthoringProgress) {
  return (
    <ErpCard className="p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="sds-text-primary font-semibold">{label}</p>
        <p className="sds-text-secondary text-sm">مرحله {current.toLocaleString('fa-IR')} از {total.toLocaleString('fa-IR')}</p>
      </div>
      <progress className="mt-3 h-2 w-full accent-[var(--sds-accent)]" value={current} max={total} aria-label="پیشرفت تکمیل فرم" />
    </ErpCard>
  );
}

export function SalesAuthoringPage({ title, description, backHref, actions, progress, feedback, children }: React.PropsWithChildren<{
  title: React.ReactNode;
  description?: React.ReactNode;
  backHref: string;
  actions?: ErpAction[];
  progress?: SalesAuthoringProgress;
  feedback?: SalesAuthoringFeedback;
}>) {
  return (
    <ErpPage title={title} description={description} backHref={backHref} actions={actions}>
      {feedback && <SalesAuthoringFeedback feedback={feedback} />}
      {progress && <SalesAuthoringProgress {...progress} />}
      {children}
    </ErpPage>
  );
}

export function SalesAuthoringSection({ title, description, children, className }: React.PropsWithChildren<{
  title: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
}>) {
  return <ErpSection title={title} description={description} className={className}>{children}</ErpSection>;
}
