'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Result } from '@sabalanerp/partner-sales-contracts';
import { partnerError } from '@sabalanerp/partner-sales-contracts';

/** Shared read lifecycle for the two purpose-specific workspaces. No authorization fallback. */
export function useWorkspaceQuery<T>(load: (cursor?: string) => Promise<Result<T>>) {
  const [view, setView] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const sequence = useRef(0);
  const cursor = cursors[cursors.length - 1];
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    try {
      const response = await load(cursor);
      if (request !== sequence.current) return;
      if (!response.ok) { setView(null); setError(partnerError(response.error.code).message); throw new Error('Read denied'); }
      setView(response.value); setError(null);
    } catch {
      if (request === sequence.current) setError(previous => previous || 'دریافت وضعیت انجام نشد؛ دوباره تلاش کنید.');
      throw new Error('Workspace needs a fresh read');
    } finally { if (request === sequence.current) setLoading(false); }
  }, [cursor, load]);
  useEffect(() => { void refresh().catch(() => undefined); return () => { sequence.current++; }; }, [refresh]);
  return { view, loading, error, refresh, canGoBack: cursors.length > 1,
    next: (nextCursor: string) => setCursors(previous => [...previous, nextCursor]),
    back: () => setCursors(previous => previous.length > 1 ? previous.slice(0, -1) : previous) };
}
