import { FaHistory, FaInbox, FaUserCheck, FaUserShield } from 'react-icons/fa';
import type { CrossWorkspaceDutyView } from './crossWorkspaceDutyApi';

export const buildDutyQueueTabs = (summary: {
  open: number;
  available: number;
  triage: number;
  historyUnseen: number;
  canManageTriage: boolean;
}) => [
  { value: 'assigned' as const, label: 'وظایف من', icon: FaInbox, count: summary.open, countTone: 'danger' as const },
  { value: 'available' as const, label: 'قابل دریافت', icon: FaUserCheck, count: summary.available, countTone: 'danger' as const },
  ...(summary.canManageTriage
    ? [{ value: 'triage' as const, label: 'بدون مسئول', icon: FaUserShield, count: summary.triage, countTone: 'danger' as const }]
    : []),
  { value: 'history' as const, label: 'تاریخچه', icon: FaHistory, count: summary.historyUnseen, countTone: 'danger' as const },
];

export const dutyQueueEmptyTitle = (view: CrossWorkspaceDutyView) => ({
  assigned: 'وظیفه بازی ندارید',
  available: 'وظیفه قابل دریافت وجود ندارد',
  triage: 'وظیفه بدون مسئول وجود ندارد',
  history: 'تاریخچه‌ای وجود ندارد',
}[view]);

export const dutyClaimFailureMessage = (error: any) => {
  const safeBackendMessage = String(error?.response?.data?.error || error?.response?.data?.message || '').trim();
  if (/[؀-ۿ]/.test(safeBackendMessage)) return safeBackendMessage;
  if (error?.response?.status === 409) {
    return 'دریافت وظیفه متوقف شد؛ وضعیت آن هم‌زمان تغییر کرده است. فهرست را به‌روزرسانی کنید.';
  }
  if (error?.response?.status === 403) {
    return 'دریافت وظیفه متوقف شد؛ مجوز لازم فعال نیست. مدیر همان فضای کاری باید دسترسی یا مسئول دیگری را تعیین کند.';
  }
  return 'دریافت وظیفه انجام نشد. اطلاعات فعلی حفظ شده است؛ دوباره تلاش کنید و در صورت تکرار با مدیر سیستم تماس بگیرید.';
};
