import type { ErpTone } from '@/components/erp';
import PersianCalendar from '@/lib/persian-calendar';
import { formatPrice } from '@/lib/numberFormat';

export const POTENTIAL_PROJECT_STATUSES = [
  'جدید',
  'در حال پیگیری',
  'نیازمند پیشنهاد',
  'آماده قرارداد',
  'برنده شده',
  'از دست رفته',
  'راکد',
] as const;

export const CRM_COMMUNICATION_TYPES = [
  'تماس تلفنی',
  'پیامک / پیام‌رسان',
  'مراجعه حضوری به دفتر سبلان',
  'بازدید از پروژه',
  'جلسه حضوری',
  'ارسال پیش‌فاکتور / پیشنهاد',
  'پیگیری مالی',
  'سایر',
] as const;

export const CRM_WORK_TYPES = [
  'فروش سنگ پروژه ساختمانی',
  'فروش همکاری',
  'خدمات / ابزار / فرآوری',
  'بارگیری یا تحویل مرتبط با فروش قبلی',
  'استعلام قیمت',
  'سایر',
] as const;

export const NEXT_ACTION_OPEN_STATUS = 'باز';
export const NEXT_ACTION_DONE_STATUS = 'انجام شده';

export const potentialProjectStatusTone = (status?: string): ErpTone => {
  switch (status) {
    case 'جدید':
      return 'info';
    case 'در حال پیگیری':
      return 'primary';
    case 'نیازمند پیشنهاد':
      return 'warning';
    case 'آماده قرارداد':
      return 'purple';
    case 'برنده شده':
      return 'success';
    case 'از دست رفته':
      return 'danger';
    case 'راکد':
      return 'neutral';
    default:
      return 'neutral';
  }
};

export const formatToman = (value: unknown) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 'ثبت نشده';
  return formatPrice(numeric);
};

export const crmPersonName = (customer?: { firstName?: string | null; lastName?: string | null; companyName?: string | null }) => {
  if (!customer) return 'مخاطب نامشخص';
  const personal = [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim();
  return personal || customer.companyName || 'مخاطب نامشخص';
};

export const crmUserName = (user?: { firstName?: string | null; lastName?: string | null; username?: string | null }) => {
  if (!user) return 'نامشخص';
  return [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.username || 'نامشخص';
};

export const isActionOverdue = (dueAt?: string | null, status?: string | null) => {
  if (!dueAt || status === NEXT_ACTION_DONE_STATUS) return false;
  return new Date(dueAt).getTime() < Date.now();
};

export const persianNowDateTime = () => `${PersianCalendar.now()} ${PersianCalendar.nowTime()}`;

export const persianDateToApiDate = (value?: string | null) => {
  if (!value) return null;
  if (!value.includes('/')) return value;
  return PersianCalendar.toGregorian(value.split(' ')[0]).toISOString();
};

export const persianDateTimeToApiDate = (value?: string | null) => {
  if (!value) return null;
  if (!value.includes('/')) return value;
  const [datePart, timePart = '00:00'] = value.split(' ');
  const date = PersianCalendar.toGregorian(datePart);
  const [hours, minutes] = timePart.split(':').map((part) => Number(part) || 0);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
};
