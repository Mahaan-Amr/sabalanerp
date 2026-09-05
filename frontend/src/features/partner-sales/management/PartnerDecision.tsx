'use client';

import React, { useState } from 'react';
import { ErpButton, ErpField, ErpSheet, ErpTextarea } from '@/components/erp';

export function PartnerDecision({ title, consequence, open, pending, disabled, danger = false, onClose, onConfirm, children, feedback }: {
  title: string; consequence: string; open: boolean; pending: boolean; disabled?: boolean; danger?: boolean;
  onClose: () => void; onConfirm: (reason: string) => void;
  children?: React.ReactNode; feedback?: React.ReactNode;
}) {
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const valid = /[\u0600-\u06ff]/.test(reason.trim());
  return <ErpSheet open={open} onClose={onClose} title={title} presentation="modal" pending={pending}
    footer={<div className="flex flex-wrap gap-2">
      <ErpButton label={pending ? 'در حال ثبت…' : 'تأیید و ثبت'} disabled={pending || disabled} tone={danger ? 'danger' : 'primary'}
        onClick={() => { setSubmitted(true); if (valid) onConfirm(reason.trim()); }} />
      <ErpButton label="انصراف" variant="outline" disabled={pending} onClick={onClose} />
    </div>}>
    <div className="space-y-4">
      <p className="sds-text-secondary leading-7">{consequence}</p>
      {children}
      <ErpField label="دلیل تصمیم" required error={submitted && !valid ? 'دلیل تصمیم را به فارسی بنویسید.' : undefined}>
        <ErpTextarea value={reason} onChange={event => setReason(event.target.value)} disabled={pending || disabled} rows={3} maxLength={2000} />
      </ErpField>
      {feedback}
    </div>
  </ErpSheet>;
}
