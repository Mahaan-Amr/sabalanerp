'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FaBell, FaCheckDouble } from 'react-icons/fa';
import { authAPI, notificationsAPI } from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpLoading,
  ErpPressable,
  ErpSheet,
} from '@/components/erp';

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  actionUrl?: string | null;
  referenceId?: string | null;
  readAt?: string | null;
  createdAt: string;
};

const toneByPriority = {
  LOW: 'neutral',
  NORMAL: 'info',
  HIGH: 'warning',
  URGENT: 'danger',
} as const;

const priorityLabel = {
  LOW: 'کم',
  NORMAL: 'عادی',
  HIGH: 'مهم',
  URGENT: 'فوری',
} as const;

export function NotificationCenter() {
  const router = useRouter();
  const { socket } = useSocket();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState('');

  const loadCount = useCallback(async () => {
    const response = await notificationsAPI.getUnreadCount();
    setUnreadCount(Number(response.data.data?.count || 0));
  }, []);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await notificationsAPI.list({ limit: 50 });
      setItems(response.data.data || []);
      await loadCount();
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'دریافت اعلان‌ها ناموفق بود.');
    } finally {
      setLoading(false);
    }
  }, [loadCount]);

  useEffect(() => {
    void loadCount().catch(() => undefined);
  }, [loadCount]);

  useEffect(() => {
    if (!socket) return;
    const handleCreated = (notification: NotificationItem) => {
      setItems((current) => [notification, ...current.filter((item) => item.id !== notification.id)]);
      setUnreadCount((current) => current + (notification.readAt ? 0 : 1));
    };
    socket.on('notification.created', handleCreated);
    return () => {
      socket.off('notification.created', handleCreated);
    };
  }, [socket]);

  const openCenter = () => {
    setOpen(true);
    void loadItems();
  };

  const openNotification = async (item: NotificationItem) => {
    if (item.type === 'NEW_BROWSER_LOGIN' && item.referenceId) {
      const wasNotMe = window.confirm('آیا این ورود متعلق به شما نبود؟ با تأیید، نشست مربوطه فوراً لغو می‌شود.');
      if (wasNotMe) {
        await authAPI.revokeSession(item.referenceId);
        await notificationsAPI.markRead(item.id);
        setOpen(false);
        const changePassword = window.confirm('نشست لغو شد. آیا می‌خواهید اکنون رمز عبور را تغییر دهید؟');
        router.push(changePassword ? '/change-password' : '/dashboard/personal');
        return;
      }
    }
    if (!item.readAt) {
      await notificationsAPI.markRead(item.id);
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row));
      setUnreadCount((current) => Math.max(0, current - 1));
    }
    if (item.actionUrl) {
      setOpen(false);
      router.push(item.actionUrl);
    }
  };

  const markAllRead = async () => {
    await notificationsAPI.markAllRead();
    const readAt = new Date().toISOString();
    setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt || readAt })));
    setUnreadCount(0);
  };

  return (
    <>
      <div className="relative">
        <ErpPressable
          type="button"
          aria-label={unreadCount ? `اعلان‌ها، ${unreadCount.toLocaleString('fa-IR')} خوانده‌نشده` : 'اعلان‌ها'}
          onClick={openCenter}
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] text-[var(--sds-text-secondary)] transition hover:bg-[var(--sds-accent-soft)] hover:text-[var(--sds-accent)]"
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
        title="مرکز اعلان‌ها"
        footer={(
          <div className="flex flex-wrap gap-2">
            {unreadCount > 0 && <ErpButton label="خواندن همه" icon={FaCheckDouble} variant="outline" onClick={markAllRead} />}
            <ErpButton label="تنظیمات اعلان" href="/dashboard/personal/notifications" tone="neutral" variant="ghost" onClick={() => setOpen(false)} />
          </div>
        )}
      >
        {loading ? <ErpLoading /> : error ? (
          <ErpEmptyState title={error} action={{ label: 'تلاش دوباره', onClick: loadItems }} />
        ) : items.length === 0 ? (
          <ErpEmptyState icon={FaBell} title="اعلانی وجود ندارد" />
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <ErpPressable
                key={item.id}
                type="button"
                onClick={() => void openNotification(item)}
                className="block w-full rounded-xl text-right"
              >
                <ErpCard interactive className={`p-4 ${item.readAt ? 'opacity-75' : 'border-[var(--sds-accent)]'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--sds-text-primary)]">{item.title}</p>
                      <p className="mt-1 text-sm leading-6 text-[var(--sds-text-secondary)]">{item.message}</p>
                      <p className="mt-2 text-xs text-[var(--sds-text-muted)]">
                        {new Date(item.createdAt).toLocaleString('fa-IR')}
                      </p>
                    </div>
                    <ErpBadge tone={toneByPriority[item.priority] || 'neutral'}>
                      {priorityLabel[item.priority] || 'عادی'}
                    </ErpBadge>
                  </div>
                </ErpCard>
              </ErpPressable>
            ))}
          </div>
        )}
      </ErpSheet>
    </>
  );
}
