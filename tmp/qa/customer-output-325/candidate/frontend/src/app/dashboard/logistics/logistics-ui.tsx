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
  'min-h-11 w-full rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] px-3 py-2 text-sm text-[var(--sds-text-primary)] outline-none focus:border-[var(--sds-accent)] focus:bg-[var(--sds-surface-raised)] focus:ring-2 focus:ring-[var(--sds-accent)]/15 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)] dark:focus:border-[var(--sds-border-strong)] dark:focus:bg-[var(--sds-surface-raised)]';

export const labelClass = 'block text-xs font-semibold text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]';
