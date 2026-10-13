'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ErpInlineState } from '@/components/erp';

/** A committed receipt stays successful even when the next read is slow or denied.
 * Stale rows remain read-only until fresh authority is obtained. */
export function useResponderRefresh(load: () => Promise<void>, identity: string, paused = false) {
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const control = useRef({ generation: 0, flight: false });
  useEffect(() => {
    const lifecycle = control.current;
    lifecycle.generation++; lifecycle.flight = false; setState('idle');
    return () => { lifecycle.generation++; };
  }, [identity]);
  const refresh = useCallback(async () => {
    if (control.current.flight) return;
    control.current.flight = true;
    const current = ++control.current.generation;
    setState('loading');
    try { await load(); if (current === control.current.generation) setState('idle'); }
    catch { if (current === control.current.generation) setState('failed'); }
    finally { if (current === control.current.generation) control.current.flight = false; }
  }, [load]);
  useEffect(() => {
    const update = () => {
      if (!paused && document.visibilityState !== 'hidden') void refresh();
    };
    const timer = window.setInterval(update, 15_000);
    window.addEventListener('focus', update);
    window.addEventListener('online', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
      window.removeEventListener('online', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [refresh, paused]);
  return { state, refresh, blocked: state !== 'idle' };
}

export function ResponderRefreshState({ state, recorded, onRefresh }: {
  state: 'idle' | 'loading' | 'failed'; recorded: boolean; onRefresh: () => void;
}) {
  if (state !== 'failed') return null;
  return <ErpInlineState kind="stale"
    title={recorded ? 'پاسخ قیمت ثبت شد؛ دریافت وضعیت تازه انجام نشد.' : 'وضعیت تازه دریافت نشد؛ پیش از اقدام بعدی دوباره دریافت کنید.'}
    action={{ label: 'دریافت وضعیت تازه', onClick: onRefresh }} />;
}
