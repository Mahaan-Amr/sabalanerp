'use client';
import { ErpBadge } from '@/components/erp';
import { operationalStatusLabel } from '@/features/dispatch/operationalStatusPresentation';

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
  return <ErpBadge tone={tone}>{statusLabels[status] || operationalStatusLabel(status)}</ErpBadge>;
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
