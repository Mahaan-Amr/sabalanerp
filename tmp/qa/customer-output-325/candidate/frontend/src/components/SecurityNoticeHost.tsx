'use client';

import { ErpPressable, ErpTextarea } from '@/components/erp';
import { useEffect, useState } from 'react';
import EnhancedDropdown from './EnhancedDropdown';

type Notice = { message: string; tone?: 'success' | 'error' };
type Dialog = {
  title: string;
  description?: string;
  inputLabel?: string;
  defaultValue?: string;
  options?: string[];
  resolve: (value: string | null) => void;
};

export const notifySecurity = (message: string, tone: Notice['tone'] = 'success') =>
  window.dispatchEvent(new CustomEvent<Notice>('security-notice', { detail: { message, tone } }));

export const askSecurityAction = (dialog: Omit<Dialog, 'resolve'>) => new Promise<string | null>((resolve) =>
  window.dispatchEvent(new CustomEvent<Dialog>('security-action', { detail: { ...dialog, resolve } }))
);

export function SecurityNoticeHost() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    const listener = (event: Event) => {
      const next = (event as CustomEvent<Notice>).detail;
      setNotice(next);
      window.setTimeout(() => setNotice(null), 4200);
    };
    const actionListener = (event: Event) => {
      const next = (event as CustomEvent<Dialog>).detail;
      setValue(next.defaultValue || next.options?.[0] || '');
      setDialog(next);
    };

    window.addEventListener('security-notice', listener);
    window.addEventListener('security-action', actionListener);

    return () => {
      window.removeEventListener('security-notice', listener);
      window.removeEventListener('security-action', actionListener);
    };
  }, []);

  return (
    <>
      {notice && (
        <div role="status" className={`fixed left-5 top-5 z-[100] max-w-sm rounded-xl border px-4 py-3 text-sm font-semibold shadow-xl ${notice.tone === 'error' ? 'border-[var(--sds-danger)] bg-[var(--sds-danger-soft)] text-[var(--sds-danger)]' : 'border-[var(--sds-success)] bg-[var(--sds-success-soft)] text-[var(--sds-success)]'}`}>
          {notice.message}
        </div>
      )}

      {dialog && (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-[var(--sds-surface-overlay)] p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="security-action-title" className="w-full max-w-md rounded-[var(--sds-radius-dialog)] bg-[var(--sds-surface-panel)] p-5 shadow-[var(--sds-shadow-raised)]">
            <h2 id="security-action-title" className="text-lg font-bold">{dialog.title}</h2>
            {dialog.description && <p className="mt-2 text-sm sds-text-secondary ">{dialog.description}</p>}
            {dialog.options ? (
              <EnhancedDropdown
                className="mt-4"
                value={value}
                onChange={setValue}
                placeholder="انتخاب کنید"
                options={dialog.options.map((option) => ({ value: option, label: option }))}
                searchable
              />
            ) : dialog.inputLabel && (
              <ErpTextarea
                autoFocus
                className="mt-4 min-h-24 w-full rounded-lg border p-3"
                placeholder={dialog.inputLabel}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            )}
            <div className="mt-5 flex justify-end gap-2">
              <ErpPressable className="px-4" onClick={() => { dialog.resolve(null); setDialog(null); }}>انصراف</ErpPressable>
              <ErpPressable tone="primary" variant="solid" className="px-4 font-semibold" onClick={() => { dialog.resolve(dialog.inputLabel || dialog.options ? value.trim() || null : 'confirmed'); setDialog(null); }}>تأیید</ErpPressable>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
