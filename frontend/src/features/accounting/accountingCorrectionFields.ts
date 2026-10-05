import type { AccountingActionField } from './AccountingActionModal';

export const accountingCorrectionFields: AccountingActionField[] = [
  { id: 'category', label: 'دسته اصلاح', type: 'select', defaultValue: 'OTHER', options: [
    { label: 'هویت مشتری', value: 'CUSTOMER_IDENTITY' },
    { label: 'مبلغ و قیمت', value: 'AMOUNT_PRICING' },
    { label: 'برنامه پرداخت', value: 'PAYMENT_PLAN' },
    { label: 'برنامه تحویل', value: 'DELIVERY_SCHEDULE' },
    { label: 'مالیات', value: 'TAX_INFO' },
    { label: 'اسناد و امضا', value: 'DOCUMENT_SIGNATURE' },
    { label: 'سایر', value: 'OTHER' },
  ] },
  { id: 'priority', label: 'اولویت', type: 'select', defaultValue: 'MEDIUM', options: [
    { label: 'کم', value: 'LOW' }, { label: 'متوسط', value: 'MEDIUM' },
    { label: 'زیاد', value: 'HIGH' }, { label: 'فوری', value: 'URGENT' },
  ] },
  { id: 'reason', label: 'متن درخواست اصلاح', type: 'textarea', required: true },
];
