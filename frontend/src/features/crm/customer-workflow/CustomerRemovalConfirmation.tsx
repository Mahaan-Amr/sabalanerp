'use client';

import { ErpButton, ErpInlineState, ErpSheet } from '@/components/erp';

export function CustomerRemovalConfirmation({ open, title, description, pending = false, error, onClose, onConfirm }: {
  open: boolean;
  title: string;
  description: string;
  pending?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ErpSheet open={open} title={title} onClose={onClose} presentation="modal" pending={pending}
      footer={<div className="flex flex-wrap gap-2">
        <ErpButton label={pending ? 'در حال حذف…' : 'حذف'} tone="danger" variant="solid" disabled={pending} onClick={onConfirm} />
        <ErpButton label="انصراف" variant="ghost" disabled={pending} onClick={onClose} />
      </div>}>
      <p className="text-sm leading-6 text-[var(--sds-text-secondary)]">{description}</p>
      {error && <ErpInlineState kind="error" title={error} />}
    </ErpSheet>
  );
}
