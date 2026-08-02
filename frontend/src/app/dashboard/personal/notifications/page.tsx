'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FaBell, FaCheck, FaCheckDouble, FaChevronDown, FaMobileAlt, FaRedo, FaSave, FaSearch, FaShieldAlt, FaTrash } from 'react-icons/fa';
import { notificationsAPI } from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import { workspaceLabelFa } from '@/lib/featureLabelsFa';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpCheckbox,
  ErpEmptyState,
  ErpInlineState,
  ErpInput,
  ErpPressable,
  ErpSection,
  ErpSegmentedControl,
  ErpSelect,
  ErpSheet,
  ErpSkeleton,
  ErpWorkspacePage,
  erpFieldLabelClassName,
} from '@/components/erp';

type InboxState = 'ALL' | 'UNREAD' | 'IMPORTANT';
type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  actionUrl?: string | null;
  readAt?: string | null;
  createdAt: string;
  workspace?: string | null;
  category?: string | null;
  sessionId?: string | null;
};

const categoryLabels: Record<string, string> = {
  SECURITY: 'امنیت', HIRING: 'جذب', SUPPORT: 'پشتیبانی', RECOVERY: 'نگهداری سامانه',
  SALES: 'فروش', ACCOUNTING: 'حسابداری', SYSTEM: 'سامانه',
};
const priorityLabels = { LOW: 'کم', NORMAL: 'عادی', HIGH: 'مهم', URGENT: 'فوری' } as const;
const priorityTones = { LOW: 'neutral', NORMAL: 'info', HIGH: 'warning', URGENT: 'danger' } as const;
const optionalCategories = [
  ['HIRING', 'جذب'], ['SUPPORT', 'پشتیبانی'], ['RECOVERY', 'نگهداری سامانه'],
];

const securityNotificationUrl = (item: NotificationItem) => {
  if (item.sessionId) {
    return `/dashboard/personal/security?session=${encodeURIComponent(item.sessionId)}&notification=${encodeURIComponent(item.id)}`;
  }
  const base = item.actionUrl?.startsWith('/dashboard/personal/security')
    ? item.actionUrl
    : '/dashboard/personal/security';
  return `${base}${base.includes('?') ? '&' : '?'}notification=${encodeURIComponent(item.id)}`;
};

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const rawData = window.atob((base64String + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(Array.from(rawData).map((character) => character.charCodeAt(0)));
};

export default function NotificationCenterPage() {
  const router = useRouter();
  const { socket } = useSocket();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [state, setState] = useState<InboxState>('ALL');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [workspace, setWorkspace] = useState('');
  const [category, setCategory] = useState('');
  const [metadata, setMetadata] = useState<{ workspaces: string[]; categories: string[] }>({ workspaces: [], categories: [] });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [preferences, setPreferences] = useState<any>(null);
  const [preferenceForm, setPreferenceForm] = useState({ webPushEnabled: false, mutedCategories: [] as string[], lowPriorityDelivery: 'IMMEDIATE' as 'IMMEDIATE' | 'DAILY' });
  const [deviceLabel, setDeviceLabel] = useState('');
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [confirmAllDevices, setConfirmAllDevices] = useState(false);
  const hasUsableData = loadedOnce;

  useEffect(() => {
    const timer = window.setTimeout(() => setAppliedSearch(search.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useMemo(() => ({ state, search: appliedSearch || undefined, workspace: workspace || undefined, category: category || undefined, limit: 25 }), [appliedSearch, category, state, workspace]);

  const loadPreferences = useCallback(async () => {
    const response = await notificationsAPI.getPreferences();
    const next = response.data.data;
    setPreferences(next);
    setPreferenceForm({
      webPushEnabled: Boolean(next.preference.webPushEnabled),
      mutedCategories: next.preference.mutedCategories || [],
      lowPriorityDelivery: next.preference.lowPriorityDelivery || 'IMMEDIATE',
    });
  }, []);

  const load = useCallback(async (retain = true) => {
    setLoading(true);
    setError('');
    try {
      const [listResponse, metadataResponse] = await Promise.all([
        notificationsAPI.list(query),
        notificationsAPI.getMetadata(),
      ]);
      setItems(listResponse.data.data || []);
      setNextCursor(listResponse.data.pagination?.nextCursor || null);
      setHasMore(Boolean(listResponse.data.pagination?.hasMore));
      setMetadata(metadataResponse.data.data || { workspaces: [], categories: [] });
      setLoadedOnce(true);
    } catch (requestError: any) {
      if (!retain) setItems([]);
      setError(requestError.response?.data?.error || 'دریافت اعلان‌ها انجام نشد.');
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadPreferences().catch(() => undefined); }, [loadPreferences]);

  useEffect(() => {
    if (!socket) return;
    const handleCreated = (notification: NotificationItem) => {
      const important = ['HIGH', 'URGENT'].includes(notification.priority);
      const matches = !appliedSearch && (!workspace || notification.workspace === workspace)
        && (!category || notification.category === category)
        && (state === 'ALL' || state === 'UNREAD' || (state === 'IMPORTANT' && important));
      if (matches) setItems((current) => [notification, ...current.filter((item) => item.id !== notification.id)]);
    };
    socket.on('notification.created', handleCreated);
    return () => { socket.off('notification.created', handleCreated); };
  }, [appliedSearch, category, socket, state, workspace]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    setError('');
    try {
      const response = await notificationsAPI.list({ ...query, cursor: nextCursor });
      setItems((current) => [...current, ...(response.data.data || []).filter((row: NotificationItem) => !current.some((item) => item.id === row.id))]);
      setNextCursor(response.data.pagination?.nextCursor || null);
      setHasMore(Boolean(response.data.pagination?.hasMore));
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'دریافت اعلان‌های بیشتر انجام نشد.');
    } finally {
      setLoadingMore(false);
    }
  };

  const openItem = async (item: NotificationItem) => {
    if (item.type === 'NEW_BROWSER_LOGIN') {
      router.push(securityNotificationUrl(item));
      return;
    }
    if (!item.readAt) {
      await notificationsAPI.markRead(item.id);
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row));
    }
    if (item.actionUrl) router.push(item.actionUrl);
  };

  const toggleRead = async (item: NotificationItem) => {
    setBusy(`read:${item.id}`);
    try {
      if (item.readAt) await notificationsAPI.markUnread(item.id);
      else await notificationsAPI.markRead(item.id);
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, readAt: item.readAt ? null : new Date().toISOString() } : row));
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'تغییر وضعیت اعلان انجام نشد.');
    } finally { setBusy(''); }
  };

  const markAllRead = async () => {
    setBusy('read-all');
    try { await notificationsAPI.markAllRead(); await load(); }
    catch (requestError: any) { setError(requestError.response?.data?.error || 'خواندن همه اعلان‌ها انجام نشد.'); }
    finally { setBusy(''); }
  };

  const savePreferences = async () => {
    setBusy('preferences'); setError(''); setMessage('');
    try {
      await notificationsAPI.updatePreferences(preferenceForm);
      setMessage('تغییرات اعلان ذخیره شد.');
      await loadPreferences();
    } catch (requestError: any) { setError(requestError.response?.data?.error || 'ذخیره تغییرات انجام نشد.'); }
    finally { setBusy(''); }
  };

  const enableThisDevice = async () => {
    if (!preferences?.supported || !preferences.webPushPublicKey) { setError('اعلان دستگاه در این محیط فعال نیست.'); return; }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { setError('این مرورگر از اعلان دستگاه پشتیبانی نمی‌کند.'); return; }
    setBusy('device'); setError('');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('اجازه اعلان برای این مرورگر داده نشد.');
      const registration = await navigator.serviceWorker.register('/support-notifications-sw.js');
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(preferences.webPushPublicKey) });
      const json = subscription.toJSON();
      await notificationsAPI.registerDevice({ endpoint: subscription.endpoint, keys: { p256dh: json.keys?.p256dh || '', auth: json.keys?.auth || '' }, deviceLabel: deviceLabel.trim() || undefined });
      setDeviceLabel(''); setMessage('اعلان این دستگاه فعال شد.'); await loadPreferences();
    } catch (requestError: any) { setError(requestError.response?.data?.error || requestError.message || 'فعال‌سازی دستگاه انجام نشد.'); }
    finally { setBusy(''); }
  };

  const disableDevice = async (id: string) => {
    setBusy(`device:${id}`);
    try { await notificationsAPI.disableDevice(id); await loadPreferences(); }
    catch (requestError: any) { setError(requestError.response?.data?.error || 'غیرفعال‌سازی دستگاه انجام نشد.'); }
    finally { setBusy(''); }
  };

  const disableAllDevices = async () => {
    setBusy('devices-all');
    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration('/support-notifications-sw.js');
        await (await registration?.pushManager.getSubscription())?.unsubscribe();
      }
      await notificationsAPI.disableAllDevices();
      setConfirmAllDevices(false); setMessage('اعلان همه دستگاه‌ها غیرفعال شد.'); await loadPreferences();
    } catch (requestError: any) { setError(requestError.response?.data?.error || 'غیرفعال‌سازی دستگاه‌ها انجام نشد.'); }
    finally { setBusy(''); }
  };

  return (
    <ErpWorkspacePage title="مرکز اعلان‌ها" primaryAction={{ label: 'به‌روزرسانی', icon: FaRedo, onClick: () => void load(), disabled: loading }} backHref="/dashboard/personal">
      <div className="space-y-4" dir="rtl">
        {message && <ErpInlineState kind="success" title={message} />}
        {error && <ErpInlineState kind={hasUsableData ? 'stale' : 'error'} title={error} action={{ label: 'تلاش دوباره', onClick: () => void load() }} />}

        <ErpSection>
          <div className="space-y-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <ErpSegmentedControl value={state} onChange={setState} options={[
                { value: 'ALL', label: 'همه' }, { value: 'UNREAD', label: 'خوانده‌نشده' }, { value: 'IMPORTANT', label: 'مهم' },
              ]} />
              <ErpButton label="خواندن همه" icon={FaCheckDouble} variant="outline" onClick={() => void markAllRead()} disabled={busy === 'read-all'} />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="relative md:col-span-1">
                <span className="sr-only">جست‌وجو</span><FaSearch className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 sds-text-muted" />
                <ErpInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="جست‌وجوی عنوان یا متن" className="pr-10" />
              </label>
              <ErpSelect aria-label="فضای کاری" value={workspace} onChange={(event) => setWorkspace(event.target.value)}>
                <option value="">همه فضاهای کاری</option>{metadata.workspaces.map((value) => <option key={value} value={value}>{workspaceLabelFa(value)}</option>)}
              </ErpSelect>
              <ErpSelect aria-label="دسته رویداد" value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">همه دسته‌ها</option>{metadata.categories.map((value) => <option key={value} value={value}>{categoryLabels[value] || value}</option>)}
              </ErpSelect>
            </div>
          </div>
        </ErpSection>

        {loading && items.length === 0 ? <div className="space-y-3"><ErpSkeleton lines={2} /><ErpSkeleton lines={2} /></div> : items.length === 0 ? (
          <ErpEmptyState icon={FaBell} title="اعلانی در این محدوده نیست" />
        ) : (
          <ErpSection>
            <div className="divide-y divide-[var(--sds-border-subtle)]">
              {items.map((item) => (
                <article key={item.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                  <span className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${item.readAt ? 'bg-[var(--sds-border-strong)]' : 'bg-[var(--sds-accent)]'}`} />
                  <ErpPressable type="button" onClick={() => void openItem(item)} className="min-h-11 min-w-0 flex-1 rounded-lg text-right outline-none focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)]">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-black sds-text-primary">{item.title}</h2>
                      <ErpBadge tone={priorityTones[item.priority]}>{priorityLabels[item.priority]}</ErpBadge>
                      {item.type === 'NEW_BROWSER_LOGIN' && !item.readAt && <ErpBadge tone="danger"><FaShieldAlt className="ml-1 inline" />نیازمند بررسی</ErpBadge>}
                      {item.type === 'NEW_BROWSER_LOGIN' && item.readAt && <ErpBadge tone="neutral"><FaShieldAlt className="ml-1 inline" />تعیین تکلیف‌شده</ErpBadge>}
                    </div>
                    <p className="mt-1 text-sm leading-6 sds-text-muted">{item.message}</p>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs sds-text-muted">
                      <time>{new Date(item.createdAt).toLocaleString('fa-IR')}</time>
                      {item.workspace && <span>{workspaceLabelFa(item.workspace)}</span>}
                      {item.category && <span>{categoryLabels[item.category] || item.category}</span>}
                    </div>
                  </ErpPressable>
                  {item.type !== 'NEW_BROWSER_LOGIN' && <ErpButton label={item.readAt ? 'خوانده‌نشده' : 'خوانده شد'} icon={item.readAt ? FaBell : FaCheck} variant="ghost" tone="neutral" onClick={() => void toggleRead(item)} disabled={busy === `read:${item.id}`} />}
                </article>
              ))}
            </div>
            {hasMore && <div className="mt-4 border-t border-[var(--sds-border-subtle)] pt-3 text-center"><ErpButton label="نمایش بیشتر" icon={FaChevronDown} variant="ghost" onClick={() => void loadMore()} disabled={loadingMore} /></div>}
          </ErpSection>
        )}

        <ErpSection>
          <ErpPressable type="button" onClick={() => setPreferencesOpen((value) => !value)} aria-expanded={preferencesOpen} className="flex min-h-11 w-full items-center justify-between rounded-lg text-right font-black sds-text-primary focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)]">
            <span>ترجیحات و دستگاه‌ها</span><FaChevronDown className={`transition ${preferencesOpen ? 'rotate-180' : ''}`} />
          </ErpPressable>
          {preferencesOpen && preferences && (
            <div className="mt-4 space-y-5 border-t border-[var(--sds-border-subtle)] pt-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">
                  <h3 className="font-bold sds-text-primary">ترجیحات تحویل</h3>
                  {optionalCategories.map(([value, label]) => <ErpCheckbox key={value} label={`بی‌صدا کردن ${label}`} checked={preferenceForm.mutedCategories.includes(value)} onChange={() => setPreferenceForm((current) => ({ ...current, mutedCategories: current.mutedCategories.includes(value) ? current.mutedCategories.filter((item) => item !== value) : [...current.mutedCategories, value] }))} />)}
                  <label className="block"><span className={erpFieldLabelClassName}>اعلان‌های کم‌اولویت</span><ErpSelect value={preferenceForm.lowPriorityDelivery} onChange={(event) => setPreferenceForm({ ...preferenceForm, lowPriorityDelivery: event.target.value as 'IMMEDIATE' | 'DAILY' })}><option value="IMMEDIATE">بلافاصله</option><option value="DAILY">خلاصه روزانه</option></ErpSelect></label>
                  <ErpButton label="ذخیره تغییرات" icon={FaSave} onClick={() => void savePreferences()} disabled={busy === 'preferences'} />
                </div>
                <div className="space-y-3">
                  <h3 className="font-bold sds-text-primary">اعلان دستگاه</h3>
                  <div className="flex flex-col gap-2 sm:flex-row"><ErpInput aria-label="نام دستگاه" value={deviceLabel} onChange={(event) => setDeviceLabel(event.target.value)} placeholder="نام این دستگاه (اختیاری)" /><ErpButton label="فعال‌سازی این دستگاه" icon={FaMobileAlt} onClick={() => void enableThisDevice()} disabled={busy === 'device' || !preferences.supported} /></div>
                  <div className="space-y-2">{preferences.devices?.length ? preferences.devices.map((device: any) => <ErpCard key={device.id} className="flex items-center justify-between gap-3 p-3"><div><p className="font-bold sds-text-primary">{device.deviceLabel || 'دستگاه بدون نام'}</p><p className="mt-1 text-xs sds-text-muted">{new Date(device.createdAt).toLocaleString('fa-IR')}</p></div>{device.disabledAt ? <ErpBadge tone="neutral">غیرفعال</ErpBadge> : <ErpButton label="غیرفعال‌سازی" tone="danger" variant="ghost" onClick={() => void disableDevice(device.id)} disabled={busy === `device:${device.id}`} />}</ErpCard>) : <ErpEmptyState title="دستگاهی ثبت نشده است" />}</div>
                  <ErpButton label="غیرفعال‌سازی همه دستگاه‌ها" icon={FaTrash} tone="danger" variant="outline" onClick={() => setConfirmAllDevices(true)} disabled={!preferences.devices?.some((device: any) => !device.disabledAt)} />
                </div>
              </div>
            </div>
          )}
        </ErpSection>
      </div>

      <ErpSheet open={confirmAllDevices} onClose={() => setConfirmAllDevices(false)} title="غیرفعال‌سازی همه دستگاه‌ها" presentation="modal" footer={<div className="flex justify-end gap-2"><ErpButton label="انصراف" variant="ghost" tone="neutral" onClick={() => setConfirmAllDevices(false)} /><ErpButton label="غیرفعال‌سازی همه" tone="danger" onClick={() => void disableAllDevices()} disabled={busy === 'devices-all'} /></div>}>
        <p className="text-sm leading-7 sds-text-muted">اعلان مرورگر در همه دستگاه‌های ثبت‌شده متوقف می‌شود. تاریخچه اعلان‌های داخل سامانه حذف نخواهد شد.</p>
      </ErpSheet>
    </ErpWorkspacePage>
  );
}
