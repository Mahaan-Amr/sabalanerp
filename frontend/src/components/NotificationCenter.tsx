'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { FaBell, FaCheckDouble, FaList } from 'react-icons/fa';
import { browserSessionContinuation, createScopedNotificationsAPI } from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { useNotificationCatchup, isNotificationScopeFailure } from '@/hooks/useNotificationCatchup';
import { useAuth } from '@/contexts/AuthContext';
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
          <div className="flex flex-wrap items-start justify-between gap-2 [&>*]:min-w-0 [&>*]:max-w-full [&>*]:break-words">
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
  const { user } = useAuth();
  return user ? <ScopedNotificationCenter key={user.id} userId={user.id} /> : null;
}

function ScopedNotificationCenter({ userId }: { userId: string }) {
  const notificationsAPI = useMemo(() => createScopedNotificationsAPI(userId), [userId]);
  const scopeGeneration = useRef(0);
  const previewGeneration = useRef(0);
  const router = useRouter();
  const { socket } = useSocket();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [unread, setUnread] = useState<NotificationItem[]>([]);
  const [recentRead, setRecentRead] = useState<NotificationItem[]>([]);
  const [badgeCount, setBadgeCount] = useState<number | null>(null);
  const [badgeUnavailable, setBadgeUnavailable] = useState(false);
  const [error, setError] = useState('');
  const [loadedOnce, setLoadedOnce] = useState(false);
  const blocked = useSyncExternalStore(browserSessionContinuation.subscribe, browserSessionContinuation.snapshot, () => null) === userId;
  const unreadCount = blocked ? null : badgeCount;
  const hasUsableData = !blocked && loadedOnce;

  const clearPreview = useCallback(() => {
    previewGeneration.current++;
    setUnread([]);
    setRecentRead([]);
    setLoadedOnce(false);
    setLoading(false);
    setError('');
  }, []);

  const clearPrivateState = useCallback(() => {
    scopeGeneration.current++;
    setBadgeCount(null);
    setBadgeUnavailable(false);
    clearPreview();
  }, [clearPreview]);

  useEffect(() => {
    if (blocked) clearPrivateState();
  }, [blocked, clearPrivateState]);

  const rejectChangedScope = useCallback((requestError: unknown) => {
    if (isNotificationScopeFailure(requestError)) clearPrivateState();
  }, [clearPrivateState]);

  const loadBadge = useCallback(async () => {
    const scope = scopeGeneration.current;
    try {
      const response = await notificationsAPI.getUnreadCount();
      if (scope !== scopeGeneration.current) return;
      setBadgeCount(Number(response.data.data.count));
      setBadgeUnavailable(false);
    } catch (requestError) {
      if (scope !== scopeGeneration.current) return;
      if (isNotificationScopeFailure(requestError)) {
        rejectChangedScope(requestError);
        return;
      }
      setBadgeCount(null);
      setBadgeUnavailable(true);
    }
  }, [notificationsAPI, rejectChangedScope]);

  const loadPreview = useCallback(async () => {
    const generation = previewGeneration.current;
    const scope = scopeGeneration.current;
    setLoading(true);
    setError('');
    const readList = (state: 'UNREAD' | 'READ', limit: number) => notificationsAPI.list({ limit, state }).catch(error => {
      if (scope === scopeGeneration.current) rejectChangedScope(error);
      throw error;
    });
    try {
      const [unreadResponse, readResponse] = await Promise.allSettled([readList('UNREAD', 5), readList('READ', 3)]);
      if (generation !== previewGeneration.current) return;
      if (unreadResponse.status === 'rejected') throw unreadResponse.reason;
      if (readResponse.status === 'rejected') throw readResponse.reason;
      setUnread(unreadResponse.value.data.data || []);
      setRecentRead(readResponse.value.data.data || []);
      setLoadedOnce(true);
    } catch (requestError: any) {
      if (generation !== previewGeneration.current) return;
      setError(requestError.response?.data?.error || 'تازه‌سازی اعلان‌ها انجام نشد.');
    } finally {
      if (generation === previewGeneration.current) setLoading(false);
    }
  }, [notificationsAPI, rejectChangedScope]);
  useNotificationCatchup(socket, loadBadge, !blocked);
  const refreshPreview = useNotificationCatchup(socket, loadPreview, open && !blocked);

  const closePreview = () => {
    setOpen(false);
    clearPreview();
  };

  const openNotification = async (item: NotificationItem) => {
    const scope = scopeGeneration.current;
    const generation = previewGeneration.current;
    if (!item.readAt) {
      try {
        await notificationsAPI.markRead(item.id);
        if (scope !== scopeGeneration.current) return;
        if (generation === previewGeneration.current) {
          const readItem = { ...item, readAt: new Date().toISOString() };
          setUnread((current) => current.filter((row) => row.id !== item.id));
          setRecentRead((current) => [readItem, ...current.filter((row) => row.id !== item.id)].slice(0, 3));
        }
      } catch (requestError: any) {
        rejectChangedScope(requestError);
        setError(requestError.response?.data?.error || 'ثبت وضعیت اعلان انجام نشد.');
        return;
      }
    }
    const destination = item.type === 'NEW_BROWSER_LOGIN' ? securityNotificationUrl(item) : item.actionUrl;
    if (destination) {
      closePreview();
      router.push(destination);
    }
  };

  const markAllRead = async () => {
    try {
      await notificationsAPI.markAllRead();
    } catch (requestError: any) {
      rejectChangedScope(requestError);
      setError(requestError.response?.data?.error || 'خواندن همه اعلان‌ها انجام نشد.');
    }
  };

  const previewEmpty = unread.length === 0 && recentRead.length === 0;
  const bellLabel = unreadCount ? `اعلان‌ها، ${unreadCount.toLocaleString('fa-IR')} خوانده‌نشده`
    : !blocked && badgeUnavailable ? 'اعلان‌ها، شمارش در دسترس نیست' : 'اعلان‌ها';

  return (
    <>
      <div className="relative">
        <ErpPressable
          type="button"
          aria-label={bellLabel}
          onClick={() => setOpen(true)}
          className="sds-action sds-action-outline inline-flex h-11 w-11 items-center justify-center"
        >
          <FaBell className="h-5 w-5" aria-hidden="true" />
        </ErpPressable>
        {!!unreadCount && (
          <span data-dynamic="notification-count" className="sds-notification-count pointer-events-none absolute -left-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold">
            {Math.min(unreadCount, 99).toLocaleString('fa-IR')}
          </span>
        )}
      </div>

      <ErpSheet
        open={open}
        onClose={closePreview}
        title="اعلان‌ها"
        footer={(
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
            <ErpButton label="خواندن همه" icon={FaCheckDouble} variant="outline" onClick={() => void markAllRead()} disabled={blocked || (!unreadCount && !unread.length)} />
            <ErpButton label="مشاهده همه اعلان‌ها" icon={FaList} href="/dashboard/personal/notifications" onClick={closePreview} />
          </div>
        )}
      >
        <div className="space-y-4" dir="rtl">
          {!blocked && error && <ErpInlineState kind={hasUsableData ? 'stale' : 'error'} title={error} action={{ label: 'تلاش دوباره', onClick: refreshPreview }} />}
          {blocked ? null : !hasUsableData ? (
            (loading || !error) && <ErpSkeleton lines={5} />
          ) : previewEmpty ? (
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
