'use client';

import React, { useState } from 'react';
import { ErpButton, ErpInlineState, ErpSheet } from '@/components/erp';

export function ContractCreationDraftPrompt({
  onResume,
  onStartNew,
  pending = false,
  mode = 'resume',
  className,
}: {
  onResume: () => void | Promise<void>;
  onStartNew: () => void | Promise<void>;
  pending?: boolean;
  mode?: 'resume' | 'takeover';
  className?: string;
}) {
  const [confirmStartNew, setConfirmStartNew] = useState(false);
  const takeover = mode === 'takeover';

  return <>
    <ErpInlineState
      kind="stale"
      className={className}
      title={takeover
        ? 'این پیش‌نویس در محل دیگری در حال ویرایش است'
        : 'یک پیش‌نویس ناتمام برای این قرارداد پیدا شد'}
      action={{
        label: takeover ? 'ادامه ویرایش در اینجا' : 'ادامه پیش‌نویس قبلی',
        onClick: () => void onResume(),
        disabled: pending,
        tone: 'primary',
        variant: 'solid',
      }}
      actions={[{
        label: 'شروع قرارداد جدید',
        onClick: () => setConfirmStartNew(true),
        disabled: pending,
        variant: 'outline',
      }]}
    />
    <ErpSheet
      open={confirmStartNew}
      onClose={() => setConfirmStartNew(false)}
      title="شروع قرارداد جدید"
      presentation="modal"
      pending={pending}
      footer={<div className="flex flex-wrap justify-end gap-2">
        <ErpButton label="انصراف" variant="outline" disabled={pending}
          onClick={() => setConfirmStartNew(false)} />
        <ErpButton label="شروع قرارداد جدید" tone="danger" disabled={pending}
          onClick={() => { setConfirmStartNew(false); void onStartNew(); }} />
      </div>}
    >
      <p>پیش‌نویس قبلی در همه محل‌های ویرایش کنار گذاشته می‌شود. آیا اطمینان دارید؟</p>
    </ErpSheet>
  </>;
}
