'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FaBell, FaCheckDouble, FaList } from 'react-icons/fa';
import { notificationsAPI } from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import {
  ErpBadge,
  ErpButton,
  ErpEmptyState,
  ErpInlineState,
  ErpPressable,
  ErpSheet,
  ErpSkeleton,
} from '@/components/erp';

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  actionUrl?: string | null;
  readAt?: string | null;
  createdAt: string;
  sessionId?: string | null;
};

const toneByPriority = { LOW: 'neutral', NORMAL: 'info', HIGH: 'warning', URGENT: 'danger' } as const;
const priorityLabel = { LOW: 'کم', NORMAL: 'عادی', HIGH: 'مهم', URGENT: 'فوری' } as const;

const securityNotificationUrl = (item: NotificationItem) => {
  if (item.sessionId) {
    return `/dashboard/personal/security?session=${encodeURIComponent(item.sessionId)}&notification=${encodeURIComponent(item.id)}`;
  }
  const base = item.actionUrl?.startsWith('/dashboard/personal/security')
    ? item.actionUrl
    : '/dashboard/personal/security';
  return `${base}${base.includes('?') ? '&' : '?'}notification=${encodeURIComponent(item.id)}`;
};

function PreviewItem({ item, onOpen }: { item: NotificationItem; onOpen: (item: NotificationItem) => void }) {
  return (
    <ErpPressable
      type="button"
      onClick={() => onOpen(item)}
      className="sds-card block w-full rounded-xl p-3 text-right transition hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)] motion-reduce:hover:translate-y-0"
    >
      <div className="flex items-start gap-3">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.readAt ? 'bg-[var(--sds-border-strong)]' : 'bg-[var(--sds-accent)]'}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-1 font-bold sds-text-primary">{item.title}</p>
            <ErpBadge tone={toneByPriority[item.priority]}>{priorityLabel[item.priority]}</ErpBadge>
          </div>
          <p className="mt-1 line-clamp-2 text-sm leading-6 sds-text-muted">{item.message}</p>
          <time className="mt-1.5 block text-xs sds-text-muted">{new Date(item.createdAt).toLocaleString('fa-IR')}</time>
        </div>
      </div>
    </ErpPressable>
  );
}

export function NotificationCenter() {
  const router = useRouter();
  const { socket } = useSocket();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState<NotificationItem[]>([]);
  const [recentRead, setRecentRead] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState('');
  const [loadedOnce, setLoadedOnce] = useState(false);
  const hasUsableData = loadedOnce;

  const loadCount = useCallback(async () => {
    const response = await notificationsAPI.getUnreadCount();
    setUnreadCount(Number(response.data.data?.count || 0));
  }, []);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [unreadResponse, readResponse, countResponse] = await Promise.all([
        notificationsAPI.list({ limit: 5, state: 'UNREAD' }),
        notificationsAPI.list({ limit: 3, state: 'READ' }),
        notificationsAPI.getUnreadCount(),
      ]);
      setUnread(unreadResponse.data.data || []);
      setRecentRead(readResponse.data.data || []);
      setUnreadCount(Number(countResponse.data.data?.count || 0));
      setLoadedOnce(true);
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'تازه‌سازی اعلان‌ها انجام نشد.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadCount().catch(() => undefined); }, [loadCount]);

  useEffect(() => {
    if (!socket) return;
    const handleCreated = (notification: NotificationItem) => {
      if (!notification.readAt) {
        setUnread((current) => [notification, ...current.filter((item) => item.id !== notification.id)].slice(0, 5));
        setUnreadCount((current) => current + 1);
      }
    };
    socket.on('notification.created', handleCreated);
    return () => { socket.off('notification.created', handleCreated); };
  }, [socket]);

  const openNotification = async (item: NotificationItem) => {
    if (item.type === 'NEW_BROWSER_LOGIN') {
      setOpen(false);
      router.push(securityNotificationUrl(item));
      return;
    }
    if (!item.readAt) {
      try {
        await notificationsAPI.markRead(item.id);
        const readItem = { ...item, readAt: new Date().toISOString() };
        setUnread((current) => current.filter((row) => row.id !== item.id));
        setRecentRead((current) => [readItem, ...current.filter((row) => row.id !== item.id)].slice(0, 3));
        setUnreadCount((current) => Math.max(0, current - 1));
      } catch (requestError: any) {
        setError(requestError.response?.data?.error || 'ثبت وضعیت اعلان انجام نشد.');
        return;
      }
    }
    if (item.actionUrl) {
      setOpen(false);
      router.push(item.actionUrl);
    }
  };

  const markAllRead = async () => {
    try {
      await notificationsAPI.markAllRead();
      await loadPreview();
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'خواندن همه اعلان‌ها انجام نشد.');
    }
  };

  const previewEmpty = useMemo(() => unread.length === 0 && recentRead.length === 0, [recentRead.length, unread.length]);

  return (
    <>
      <div className="relative">
        <ErpPressable
          type="button"
          aria-label={unreadCount ? `اعلان‌ها، ${unreadCount.toLocaleString('fa-IR')} خوانده‌نشده` : 'اعلان‌ها'}
          onClick={() => { setOpen(true); void loadPreview(); }}
          className="sds-action sds-action-outline inline-flex h-11 w-11 items-center justify-center"
        >
          <FaBell className="h-5 w-5" aria-hidden="true" />
        </ErpPressable>
        {unreadCount > 0 && (
          <span className="pointer-events-none absolute -left-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-[var(--sds-danger)] px-1 text-[10px] font-bold text-[var(--sds-text-inverse)]">
            {Math.min(unreadCount, 99).toLocaleString('fa-IR')}
          </span>
        )}
      </div>

      <ErpSheet
        open={open}
        onClose={() => setOpen(false)}
        title="اعلان‌ها"
        footer={(
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
            <ErpButton label="خواندن همه" icon={FaCheckDouble} variant="outline" onClick={() => void markAllRead()} disabled={!unreadCount} />
            <ErpButton label="مشاهده همه اعلان‌ها" icon={FaList} href="/dashboard/personal/notifications" onClick={() => setOpen(false)} />
          </div>
        )}
      >
        <div className="space-y-4" dir="rtl">
          {error && <ErpInlineState kind={hasUsableData ? 'stale' : 'error'} title={error} action={{ label: 'تلاش دوباره', onClick: () => void loadPreview() }} />}
          {loading && !hasUsableData ? <ErpSkeleton lines={5} /> : previewEmpty ? (
            <ErpEmptyState icon={FaBell} title="اعلانی ندارید" />
          ) : (
            <>
              {unread.length > 0 && <div className="space-y-2">{unread.map((item) => <PreviewItem key={item.id} item={item} onOpen={(row) => void openNotification(row)} />)}</div>}
              {recentRead.length > 0 && (
                <section aria-labelledby="notification-recent-title">
                  <h3 id="notification-recent-title" className="mb-2 text-sm font-black sds-text-primary">اخیر</h3>
                  <div className="space-y-2">{recentRead.map((item) => <PreviewItem key={item.id} item={item} onOpen={(row) => void openNotification(row)} />)}</div>
                </section>
              )}
            </>
          )}
        </div>
      </ErpSheet>
    </>
  );
}
