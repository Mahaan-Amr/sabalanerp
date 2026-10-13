'use client';
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { readPartnerCaseChangeVersion } from './partnerCaseHttpPort';

/** One in-flight read, no hidden-tab traffic, and bounded backoff on failure.
 * A pre-read version is retained so a response committed during the full read
 * is seen on the next check instead of being silently acknowledged. */
export function usePartnerCaseRefresh(caseId: string | undefined, version: MutableRefObject<string | null | undefined>,
  refresh: (version: string) => Promise<boolean>, paused: boolean) {
  const latest = useRef({ refresh, paused });
  latest.current = { refresh, paused };
  const [failed, setFailed] = useState(false);
  const retry = useRef<() => void>(() => undefined);
  useEffect(() => {
    let disposed = false, flight = false, failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setFailed(false);
    const schedule = () => {
      clearTimeout(timer);
      if (!disposed && version.current !== null && document.visibilityState !== 'hidden')
        timer = setTimeout(() => void check(), Math.min(120_000, 20_000 * 2 ** failures));
    };
    const check = async () => {
      clearTimeout(timer);
      if (disposed || flight || version.current === null || document.visibilityState === 'hidden') return;
      if (latest.current.paused) { schedule(); return; }
      flight = true;
      try {
        const current = await readPartnerCaseChangeVersion(caseId);
        if (disposed) return;
        if (current === null) version.current = null;
        else if (current !== version.current && !await latest.current.refresh(current)) throw new Error('Refresh failed');
        if (!disposed) { failures = 0; setFailed(false); }
      } catch { if (!disposed) { failures++; setFailed(true); } }
      finally { flight = false; schedule(); }
    };
    const wake = () => { if (document.visibilityState !== 'hidden') void check(); else clearTimeout(timer); };
    retry.current = wake;
    schedule();
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    return () => { disposed = true; clearTimeout(timer); retry.current = () => undefined;
      window.removeEventListener('focus', wake); window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', wake); };
  }, [caseId, version]);
  return { failed, retry: () => retry.current() };
}
