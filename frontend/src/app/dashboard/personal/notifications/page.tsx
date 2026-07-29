'use client';

import { useCallback, useEffect, useState } from 'react';
import { FaBell, FaMobileAlt, FaSave, FaTrash } from 'react-icons/fa';
import { notificationsAPI } from '@/lib/api';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpCheckbox,
  ErpEmptyState,
  ErpInput,
  ErpLoading,
  ErpPage,
  ErpSelect,
  erpFieldLabelClassName,
} from '@/components/erp';

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from(Array.from(rawData).map((character) => character.charCodeAt(0)));
};

const optionalCategories = [
  ['HIRING', 'اطلاع‌رسانی‌های اختیاری جذب'],
  ['SUPPORT', 'اطلاع‌رسانی‌های اختیاری پشتیبانی'],
  ['RECOVERY', 'اطلاع‌رسانی‌های اختیاری نگهداری سامانه'],
];

export default function NotificationSettingsPage() {
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState({ webPushEnabled: false, mutedCategories: [] as string[], lowPriorityDelivery: 'IMMEDIATE' as 'IMMEDIATE' | 'DAILY' });
  const [deviceLabel, setDeviceLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await notificationsAPI.getPreferences();
      setData(response.data.data);
      setForm({
        webPushEnabled: response.data.data.preference.webPushEnabled,
        mutedCategories: response.data.data.preference.mutedCategories || [],
        lowPriorityDelivery: response.data.data.preference.lowPriorityDelivery || 'IMMEDIATE',
      });
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'دریافت تنظیمات اعلان ممکن نشد.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await operation();
      setMessage(success);
      await load();
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || requestError.message || 'عملیات انجام نشد.');
    } finally {
      setBusy(false);
    }
  };

  const enableThisDevice = async () => {
    if (!data?.supported || !data.webPushPublicKey) {
      setError('ارسال اعلان دستگاه روی این محیط پیکربندی نشده است.');
      return;
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setError('مرورگر این دستگاه Web Push را پشتیبانی نمی‌کند.');
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setError('اجازه اعلان برای این مرورگر داده نشد. می‌توانید آن را از تنظیمات مرورگر تغییر دهید.');
      return;
    }
    await run(async () => {
      const registration = await navigator.serviceWorker.register('/support-notifications-sw.js');
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(data.webPushPublicKey),
      });
      const json = subscription.toJSON();
      await notificationsAPI.registerDevice({
        endpoint: subscription.endpoint,
        keys: { p256dh: json.keys?.p256dh || '', auth: json.keys?.auth || '' },
        deviceLabel: deviceLabel.trim() || undefined,
      });
    }, 'اعلان این دستگاه فعال شد.');
  };

  const disableAll = async () => run(async () => {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration('/support-notifications-sw.js');
      const subscription = await registration?.pushManager.getSubscription();
      await subscription?.unsubscribe();
    }
    await notificationsAPI.disableAllDevices();
  }, 'ارسال اعلان به همه دستگاه‌ها غیرفعال شد.');

  if (!data && !error) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="امور شخص · اعلان‌ها"
      title="تنظیمات اعلان"
      description="مرکز اعلان داخل سامانه همیشه منبع اصلی است. اجازه اعلان دستگاه فقط از همین صفحه درخواست می‌شود."
      backHref="/dashboard/personal"
    >
      <div className="space-y-5" dir="rtl">
        {error && <ErpCard tone="danger"><p role="alert" className="text-sm font-bold">{error}</p></ErpCard>}
        {message && <ErpCard tone="success"><p role="status" className="text-sm font-bold">{message}</p></ErpCard>}
        <ErpCard>
          <h2 className="font-bold">مرکز اعلان داخل سامانه</h2>
          <p className="mt-2 text-sm leading-7 text-[var(--sds-text-secondary)]">
            اعلان‌های ارجاع مستقیم، اشاره، مسئولیت تأیید، رویداد امنیتی الزامی و پاسخ تیکت قابل غیرفعال‌سازی نیستند و پس از خروج نیز در مرکز اعلان باقی می‌مانند.
          </p>
        </ErpCard>
        <ErpCard tone="info">
          <h2 className="font-bold">Web Push دستگاه‌ها</h2>
          <p className="mt-2 text-sm">متن صفحه قفل همیشه عمومی است: «یک اعلان جدید در سبلان دارید.» جزئیات فقط پس از بازکردن سبلان و احراز هویت دیده می‌شود.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
            <label>
              <span className={erpFieldLabelClassName}>نام این دستگاه (اختیاری)</span>
              <ErpInput value={deviceLabel} onChange={(event) => setDeviceLabel(event.target.value)} placeholder="مثلاً لپ‌تاپ دفتر" maxLength={120} />
            </label>
            <div className="flex items-end">
              <ErpButton label="فعال‌سازی روی این دستگاه" icon={FaMobileAlt} onClick={() => void enableThisDevice()} disabled={busy || !data?.supported} />
            </div>
          </div>
          {!data?.supported && <p className="mt-3 text-sm text-[var(--sds-warning)]">کلیدهای Web Push در محیط فعلی تنظیم نشده‌اند.</p>}
        </ErpCard>
        <ErpCard>
          <h2 className="font-bold">ترجیحات شخصی</h2>
          <div className="mt-4 space-y-3">
            {optionalCategories.map(([value, label]) => (
              <ErpCheckbox
                key={value}
                label={`بی‌صدا کردن ${label}`}
                checked={form.mutedCategories.includes(value)}
                onChange={() => setForm((current) => ({
                  ...current,
                  mutedCategories: current.mutedCategories.includes(value)
                    ? current.mutedCategories.filter((item) => item !== value)
                    : [...current.mutedCategories, value],
                }))}
              />
            ))}
            <label className="block max-w-sm">
              <span className={erpFieldLabelClassName}>تحویل رویدادهای کم‌اولویت</span>
              <ErpSelect value={form.lowPriorityDelivery} onChange={(event) => setForm({ ...form, lowPriorityDelivery: event.target.value as 'IMMEDIATE' | 'DAILY' })}>
                <option value="IMMEDIATE">بلافاصله</option>
                <option value="DAILY">تجمیع روزانه</option>
              </ErpSelect>
            </label>
          </div>
          <div className="mt-4">
            <ErpButton label="ذخیره ترجیحات" icon={FaSave} onClick={() => void run(() => notificationsAPI.updatePreferences(form), 'تنظیمات ذخیره شد.')} disabled={busy} />
          </div>
        </ErpCard>
        <ErpCard>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-bold">دستگاه‌های ثبت‌شده</h2>
              <p className="mt-1 text-sm text-[var(--sds-text-muted)]">هر کاربر می‌تواند چند دستگاه فعال داشته باشد.</p>
            </div>
            <ErpButton label="غیرفعال‌سازی همه" icon={FaTrash} onClick={() => void disableAll()} tone="danger" variant="outline" disabled={busy || !data?.devices?.some((device: any) => !device.disabledAt)} />
          </div>
          <div className="mt-4 space-y-2">
            {!data?.devices?.length ? <ErpEmptyState icon={FaBell} title="دستگاهی ثبت نشده است" /> : data.devices.map((device: any) => (
              <div key={device.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--sds-border-subtle)] p-3">
                <div>
                  <p className="font-bold">{device.deviceLabel || 'دستگاه بدون نام'}</p>
                  <p className="mt-1 text-xs text-[var(--sds-text-muted)]">{new Date(device.createdAt).toLocaleString('fa-IR')}</p>
                </div>
                {device.disabledAt ? <ErpBadge tone="neutral">غیرفعال</ErpBadge> : (
                  <ErpButton label="غیرفعال‌سازی" onClick={() => void run(() => notificationsAPI.disableDevice(device.id), 'دستگاه غیرفعال شد.')} tone="danger" variant="ghost" disabled={busy} />
                )}
              </div>
            ))}
          </div>
        </ErpCard>
      </div>
    </ErpPage>
  );
}
