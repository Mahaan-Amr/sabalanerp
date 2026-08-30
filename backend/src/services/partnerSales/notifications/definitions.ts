import type { RegisteredNotificationEvent } from '../../notificationPolicy';

const event = (type: string, titleTemplate: string, messageTemplate: string): RegisteredNotificationEvent => ({
  type, titleTemplate, messageTemplate, mandatory: true, priority: 'NORMAL',
  allowedVariables: [], allowedChannels: ['IN_APP'], allowedRecipientResolvers: ['DIRECT_USER'],
});

// Fixed generic content. Private IDs, names, prices and evidence are never
// template variables, public push bodies, or inquiry SMS/email/WhatsApp payloads.
export const PARTNER_NOTIFICATION_EVENTS = {
  PARTNER_CUSTOMER_TRANSFER_REQUESTED: event('PARTNER_CUSTOMER_TRANSFER_REQUESTED', 'درخواست انتقال مشتری', 'یک درخواست انتقال مالکیت مشتری نیازمند بررسی شما است.'),
  PARTNER_CUSTOMER_TRANSFER_DECIDED: event('PARTNER_CUSTOMER_TRANSFER_DECIDED', 'نتیجه انتقال مشتری', 'نتیجه درخواست انتقال مالکیت مشتری آماده مشاهده است.'),
  PARTNER_INQUIRY_SUBMITTED: event('PARTNER_INQUIRY_SUBMITTED', 'استعلام جدید', 'یک استعلام برای پاسخ‌گویی به شما ارجاع شد.'),
  PARTNER_INQUIRY_CANCELLED: event('PARTNER_INQUIRY_CANCELLED', 'لغو استعلام', 'ردیف‌های در انتظار پاسخ یک استعلام لغو شدند.'),
  PARTNER_INQUIRY_PARTIAL_RESPONSE: event('PARTNER_INQUIRY_PARTIAL_RESPONSE', 'پاسخ استعلام', 'نتیجه پاسخ به ردیف‌های استعلام آماده مشاهده است.'),
  PARTNER_INQUIRY_REASSIGNED: event('PARTNER_INQUIRY_REASSIGNED', 'تغییر پاسخ‌دهنده', 'پاسخ‌دهنده ردیف‌های در انتظار پاسخ استعلام تغییر کرد.'),
  PARTNER_INQUIRY_EXPIRING: event('PARTNER_INQUIRY_EXPIRING', 'پایان اعتبار نزدیک است', 'حداکثر شش ساعت تا پایان اعتبار تأیید قیمت باقی مانده است.'),
  PARTNER_INQUIRY_EXPIRED: event('PARTNER_INQUIRY_EXPIRED', 'پایان اعتبار تأیید قیمت', 'برای استفاده جدید از این قیمت، استعلام تازه ثبت کنید.'),
};

export const isPartnerInquiryNotification = (type: string): boolean =>
  Object.prototype.hasOwnProperty.call(PARTNER_NOTIFICATION_EVENTS, type);
