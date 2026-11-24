'use client';
import { useCallback, useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { NotificationCatchup } from '@/lib/notificationCatchup';
export { isPrivateClientScopeFailure as isNotificationScopeFailure } from '@/lib/privateClientScope';

export function useNotificationCatchup(socket: Socket | null, read: () => Promise<void>, enabled = true) {
  const active = useRef<NotificationCatchup | null>(null);
  const enabledRef = useRef(enabled);
  const refresh = useCallback(() => {
    if (enabledRef.current) void active.current?.refresh().catch(() => undefined);
  }, []);

  // A socket replacement changes the hints, not the in-flight durable read.
  useEffect(() => {
    const catchup = new NotificationCatchup(async () => {
      if (enabledRef.current) await read();
    });
    active.current = catchup;
    return () => {
      active.current = null;
      catchup.stop();
    };
  }, [read]);

  useEffect(() => {
    enabledRef.current = enabled;
    refresh();
  }, [enabled, read, refresh]);

  useEffect(() => {
    if (!enabled) return;
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    socket?.on('connect', refresh);
    socket?.on('notification.created', refresh);
    if (socket?.connected) refresh();
    window.addEventListener('focus', visible);
    window.addEventListener('notifications:read-state-changed', refresh);
    document.addEventListener('visibilitychange', visible);
    const interval = window.setInterval(visible, 30_000);
    return () => {
      window.clearInterval(interval);
      socket?.off('connect', refresh);
      socket?.off('notification.created', refresh);
      window.removeEventListener('focus', visible);
      window.removeEventListener('notifications:read-state-changed', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [enabled, refresh, socket]);

  return refresh;
}

