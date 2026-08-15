'use client';

import React from 'react';
import { ErpButton, ErpInlineState, ErpPage, ErpSection, type ErpAction } from '@/components/erp';

export function InventoryMasterDataPage({
  title,
  description,
  backHref,
  actions,
  error,
  children,
}: React.PropsWithChildren<{
  title: React.ReactNode;
  description?: React.ReactNode;
  backHref: string;
  actions?: ErpAction[];
  error?: React.ReactNode;
}>) {
  return (
    <ErpPage title={title} description={description} backHref={backHref} actions={actions}>
      {error && <ErpInlineState kind="error" title={error} />}
      <ErpSection className="mx-auto w-full max-w-2xl">{children}</ErpSection>
    </ErpPage>
  );
}

export function InventoryMasterDataEntry({ id, label, error, hint, required, children }: React.PropsWithChildren<{
  id: string;
  label: React.ReactNode;
  error?: React.ReactNode;
  hint?: React.ReactNode;
  required?: boolean;
}>) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  const control = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy,
      })
    : children;

  return (
    <div>
      <label htmlFor={id} className="sds-text-secondary mb-2 block text-sm font-medium">
        {label}{required && <span aria-hidden="true"> *</span>}
      </label>
      {control}
      {hint && <p id={hintId} className="sds-text-muted mt-1 text-sm">{hint}</p>}
      {error && <p id={errorId} className="mt-1 text-sm text-[var(--sds-danger)]">{error}</p>}
    </div>
  );
}

export function InventoryMasterDataActions({ pending, submitLabel, onCancel, deleteAction }: {
  pending: boolean;
  submitLabel: string;
  onCancel: () => void;
  deleteAction?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
      {deleteAction ? <ErpButton label={deleteAction.label} onClick={deleteAction.onClick} tone="danger" variant="ghost" /> : <span />}
      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        <ErpButton label="انصراف" variant="ghost" tone="neutral" onClick={onCancel} />
        <ErpButton type="submit" disabled={pending} label={pending ? 'در حال ذخیره…' : submitLabel} variant="solid" />
      </div>
    </div>
  );
}
