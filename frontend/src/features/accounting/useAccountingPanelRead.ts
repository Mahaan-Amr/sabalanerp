'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type PanelState<T> = {
  key: string;
  data?: T;
  loading: boolean;
  error?: string;
  denied?: boolean;
};

export function useAccountingPanelRead<T>(
  key: string | undefined,
  load: (signal: AbortSignal) => Promise<T>,
  fallbackError: string,
) {
  const request = useRef<AbortController | undefined>(undefined);
  const activeKey = useRef<string | undefined>(undefined);
  const [state, setState] = useState<PanelState<T>>();

  const refresh = useCallback(async () => {
    if (!key || activeKey.current !== key) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState((current) => ({
      key, data: current?.key === key ? current.data : undefined, loading: true, denied: current?.denied,
    }));
    try {
      const data = await load(controller.signal);
      if (!controller.signal.aborted) setState({ key, data, loading: false });
    } catch (reason) {
      if (controller.signal.aborted) return;
      const response = (reason as { response?: { status?: number; data?: { error?: string; message?: string } } })?.response;
      const denied = response?.status === 401 || response?.status === 403;
      const error = response?.data?.error || response?.data?.message || fallbackError;
      setState((current) => ({
        key, data: !denied && current?.key === key ? current.data : undefined, loading: false, error, denied,
      }));
    }
  }, [key, load, fallbackError]);

  useEffect(() => {
    activeKey.current = key;
    void refresh();
    return () => {
      activeKey.current = undefined;
      request.current?.abort();
    };
  }, [key, refresh]);

  const update = useCallback((apply: (data: T | undefined) => T) => {
    if (!key || activeKey.current !== key) return;
    setState((current) => current?.key === key && !current.denied
      ? { ...current, data: apply(current.data) }
      : current);
  }, [key]);

  const active = key && state?.key === key ? state : undefined;
  return {
    data: active?.data, loading: Boolean(key) && (active?.loading ?? true),
    error: active?.error, denied: active?.denied, refresh, update,
  };
}
