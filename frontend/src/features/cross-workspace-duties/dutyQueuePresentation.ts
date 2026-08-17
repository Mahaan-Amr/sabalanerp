import { FaHistory, FaInbox, FaUserCheck, FaUserShield } from 'react-icons/fa';
import type { CrossWorkspaceDutyView } from './crossWorkspaceDutyApi';

export const buildDutyQueueTabs = (summary: {
  open: number;
  available: number;
  triage: number;
  canManageTriage: boolean;
}) => [
  { value: 'assigned' as const, label: 'وظایف من', icon: FaInbox, count: summary.open },
  { value: 'available' as const, label: 'قابل دریافت', icon: FaUserCheck, count: summary.available },
  ...(summary.canManageTriage
    ? [{ value: 'triage' as const, label: 'نیازمند تعیین مسئول', icon: FaUserShield, count: summary.triage }]
    : []),
  { value: 'history' as const, label: 'تاریخچه', icon: FaHistory },
];

export const dutyQueueEmptyTitle = (view: CrossWorkspaceDutyView) => ({
  assigned: 'وظیفه بازی ندارید',
  available: 'وظیفه قابل دریافت وجود ندارد',
  triage: 'وظیفه بدون مسئول وجود ندارد',
  history: 'تاریخچه‌ای وجود ندارد',
}[view]);
