'use client';

import React from 'react';
import { ErpCard, ErpDisclosure, ErpInlineState, ErpPage, ErpSection, useErpPresentationScope, type ErpAction } from '@/components/erp';

import { WizardProgressBar, type WizardStep } from '@/features/contract-creation/components/shared/WizardProgressBar';

type WorkflowFeedback = {
  kind: 'empty' | 'success' | 'error' | 'stale' | 'permission';
  title: React.ReactNode;
};

type WorkflowProgress = {
  current: number;
  total: number;
  label: React.ReactNode;
  steps?: WizardStep[];
};

export function hasCustomerDraftChanges<T extends object>(values: T) {
  return Object.entries(values).some(([key, value]) => {
    if (key === 'customerType' || key === 'status') return false;
    if (Array.isArray(value)) return value.length > 0;
    return typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
  });
}

export function CustomerWorkflowFeedback({ feedback }: { feedback: WorkflowFeedback }) {
  return <ErpInlineState kind={feedback.kind} title={feedback.title} />;
}

export function CustomerWorkflowProgress({ current, total, label, steps }: WorkflowProgress) {
  const scope = useErpPresentationScope();
  if (scope === 'workspace' && steps) return <WizardProgressBar currentStep={current} steps={steps} ariaLabel="مراحل ثبت مشتری" />;
  const percent = Math.round((current / Math.max(total, 1)) * 100);
  return (
    <ErpCard className="p-4">
      <div className="sds-text-secondary mb-3 flex items-center justify-between gap-3 text-sm">
        <span>مرحله {current.toLocaleString('fa-IR')} از {total.toLocaleString('fa-IR')}</span>
        <span>{percent.toLocaleString('fa-IR')}٪</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-[var(--sds-surface-subtle)]"
        role="progressbar"
        aria-label={typeof label === 'string' ? label : 'پیشرفت ایجاد مشتری'}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={current}
      >
        <div className="h-full rounded-full bg-[var(--sds-accent)]" style={{ width: `${percent}%` }} />
      </div>
      <p className="sds-text-primary mt-3 font-semibold">{label}</p>
    </ErpCard>
  );
}

export function CustomerWorkflowPage({
  title,
  description,
  backHref,
  actions,
  progress,
  feedback,
  children,
}: React.PropsWithChildren<{
  title: React.ReactNode;
  description?: React.ReactNode;
  backHref: string;
  actions?: ErpAction[];
  progress?: WorkflowProgress;
  feedback?: WorkflowFeedback;
}>) {
  const scope = useErpPresentationScope();
  return (
    <ErpPage title={title} description={description} backHref={backHref} actions={actions}>
      {feedback && <CustomerWorkflowFeedback feedback={feedback} />}
      <div className={scope === 'workspace' ? "mx-auto w-full max-w-[850px] space-y-5" : "space-y-5"}>
        {progress && <CustomerWorkflowProgress {...progress} />}
        {children}
      </div>
    </ErpPage>
  );
}

export function CustomerWorkflowSection({ title, description, children, className, collapsible, expanded, legacyPlain }: React.PropsWithChildren<{
  title?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  collapsible?: boolean;
  expanded?: boolean;
  legacyPlain?: boolean;
}>) {
  const scope = useErpPresentationScope();
  if (legacyPlain && scope !== 'workspace') return <div><h3 className="text-lg font-semibold text-[var(--sds-text-primary)] mb-4">{title}</h3>{children}</div>;
  if (collapsible && scope === 'workspace') return <ErpDisclosure title={title} expanded={expanded} className={className}>{description && <p className="sds-text-secondary mb-4 text-sm">{description}</p>}{children}</ErpDisclosure>;
  return <ErpSection title={title} description={description} className={className}>{children}</ErpSection>;
}
