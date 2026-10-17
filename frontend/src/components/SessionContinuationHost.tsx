'use client';

import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { ErpButton, ErpField, ErpInput, ErpInlineState, ErpSheet } from '@/components/erp';
import { authAPI, browserSessionContinuation } from '@/lib/api';

/** The underlying React tree stays mounted. A new login must match the tab's
 * original owner before the server creates a session or sends cookie headers.
 * No failed business mutation is replayed after authentication. */
export function SessionContinuationHost({ children }: { children: ReactNode }) {
  const owner = useSyncExternalStore(browserSessionContinuation.subscribe, browserSessionContinuation.snapshot, () => null);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (pending || !owner) return;
    setPending(true); setError('');
    try { await authAPI.login(identifier, password); setPassword(''); }
    catch (failure: any) {
      setPassword('');
      setError(failure?.response?.data?.error || 'ورود انجام نشد. دوباره تلاش کنید.');
    } finally { setPending(false); }
  };
  return <>
    <div hidden={Boolean(owner)} aria-hidden={owner ? true : undefined}>{children}</div>
    <style>{`body:has([data-sabalan-session-continuation]) > :not(:has([data-sabalan-session-continuation])) { visibility: hidden !important; }`}</style>
    <ErpSheet open={Boolean(owner)} onClose={() => {}} title="ادامهٔ کار با همین حساب"
    presentation="modal" dismissible={false} pending={pending}>
    <form onSubmit={submit} className="space-y-4" data-sabalan-session-continuation>
      <p className="text-sm text-[var(--sds-text-secondary)]">نشست این صفحه تغییر کرده است. فرم باز مانده؛ برای ادامه با همان حساب قبلی وارد شوید.</p>
      <ErpField label="نام کاربری یا شماره همراه">
        <ErpInput id="continuation-identifier" autoComplete="username" value={identifier} onChange={event => setIdentifier(event.target.value)} required disabled={pending} />
      </ErpField>
      <ErpField label="رمز عبور">
        <ErpInput id="continuation-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required disabled={pending} />
      </ErpField>
      {error && <ErpInlineState kind="error" title={error} />}
      <ErpButton type="submit" disabled={pending} className="w-full" label={pending ? 'در حال ورود…' : 'ورود و ادامهٔ فرم'} />
    </form>
  </ErpSheet></>;
}
