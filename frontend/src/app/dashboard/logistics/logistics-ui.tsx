'use client';

import { ErpBadge } from '@/components/erp';

export const statusLabels: Record<string, string> = {
  DRAFT: 'پیش‌نویس',
  FINALIZED: 'نهایی‌شده',
  CANCELLED: 'لغوشده',
};

export const unitLabels: Record<string, string> = {
  meter: 'متر طول',
  squareMeter: 'متر مربع',
  count: 'عدد',
};

export const numberFa = (value: any, digits = 3) => {
  const numeric = Number(value || 0);
  return numeric.toLocaleString('fa-IR', { maximumFractionDigits: digits });
};

export const dateFa = (value?: string | Date | null) => {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return '—';
  }
};

export const StatusBadge = ({ status }: { status: string }) => {
  const tone = status === 'FINALIZED' ? 'success' : status === 'CANCELLED' ? 'danger' : 'warning';
  return <ErpBadge tone={tone}>{statusLabels[status] || status}</ErpBadge>;
};

export const driverName = (snapshot: any) => {
  if (!snapshot) return 'بدون راننده';
  return `${snapshot.firstName || ''} ${snapshot.lastName || ''}`.trim() || 'بدون راننده';
};

export const loadingDriversName = (loading: any) => {
  const drivers = loading?.drivers || loading?.driverAssignments || [];
  if (drivers.length) {
    return drivers
      .map((driver: any) => {
        const snapshot = driver.snapshot || driver.driverSnapshot || driver.vehiclePair || driver;
        return driverName(snapshot);
      })
      .filter((name: string) => name && name !== 'بدون راننده')
      .join('، ') || 'بدون راننده';
  }
  return driverName(loading?.driverSnapshot);
};

export const inputClass =
  'min-h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-[#074747] focus:bg-white focus:ring-2 focus:ring-[#074747]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-teal-500 dark:focus:bg-slate-900';

export const labelClass = 'block text-xs font-semibold text-slate-500 dark:text-slate-400';
