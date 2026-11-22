'use client';
import { useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import { NotificationCatchup } from '@/lib/notificationCatchup';
export { isPrivateClientScopeFailure as isNotificationScopeFailure } from '@/lib/privateClientScope';

export function useNotificationCatchup(socket: Socket | null, read: () => Promise<void>) {
  useEffect(() => {
    const catchup = new NotificationCatchup(read);
    const refresh = () => { void catchup.refresh().catch(() => undefined); };
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    refresh();
    socket?.on('connect', refresh);
    socket?.on('notification.created', refresh);
    window.addEventListener('focus', visible);
    window.addEventListener('notifications:read-state-changed', refresh);
    document.addEventListener('visibilitychange', visible);
    const interval = window.setInterval(visible, 30_000);
    return () => {
      catchup.stop();
      window.clearInterval(interval);
      socket?.off('connect', refresh);
      socket?.off('notification.created', refresh);
      window.removeEventListener('focus', visible);
      window.removeEventListener('notifications:read-state-changed', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [socket, read]);
}

