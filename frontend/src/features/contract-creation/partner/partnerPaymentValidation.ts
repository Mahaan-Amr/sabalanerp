import moment from 'moment-jalaali';
import { normalizeDigits } from '@/lib/numberFormat';
import { partnerPaymentChoice } from './partnerPaymentMethodAdapter';
import type { CustomerPaymentPlan } from '@sabalanerp/partner-sales-contracts';

type PartnerInstallment = CustomerPaymentPlan['installments'][number];
export type PartnerPaymentFieldErrors = Partial<Record<'amount' | 'date' | 'number' | 'bank' | 'ownerName' | 'handoverDate' | 'nationalCode', string>>;

export function partnerPaymentNeedsNationalCode(method: PartnerInstallment['method'], date: string, currentDate: string): boolean {
  if (method === 'CREDIT' || !date) return false;
  const day = (value: string) => {
    const normalized = normalizeDigits(value).trim();
    const parsed = moment(normalized, normalized.includes('/') ? 'jYYYY/jMM/jDD' : 'YYYY-MM-DD', true);
    return parsed.isValid() ? parsed.locale('en').format('YYYY-MM-DD') : null;
  };
  const paymentDay = day(date);
  return !paymentDay || paymentDay !== day(currentDate);
}

/** Only the exact retained installment is grandfathered. Opening an editor
 * must not turn a formerly same-day payment into a new dated payment. */
export function isRetainedPartnerPayment(installment: PartnerInstallment, saved?: PartnerInstallment): boolean {
  const identity = (item: PartnerInstallment) => JSON.stringify([
    item.installmentId, item.method, partnerPaymentChoice(item), item.dueDate,
    item.amount.currency, item.amount.amount, item.nationalCode?.trim() || null,
    item.check?.number?.trim() || null, item.check?.bank?.trim() || null, item.check?.dueDate?.trim() || null,
    item.check?.ownerName?.trim() || null, item.check?.handoverDate?.trim() || null,
  ]);
  return Boolean(saved && identity(installment) === identity(saved));
}

export function validatePartnerPaymentInstallment(installment: PartnerInstallment, currentDate: string,
  existingContract = false, savedInstallment?: PartnerInstallment): PartnerPaymentFieldErrors {
  const errors: PartnerPaymentFieldErrors = {};
  if (!installment.amount.amount || installment.amount.amount === '0') errors.amount = 'مبلغ پرداخت باید بیشتر از صفر باشد.';
  if (!existingContract && installment.method === 'CREDIT' && installment.subtype === 'CUSTOMER_BALANCE') {
    errors.amount = 'استفاده از باقی مانده مشتری غیرفعال است؛ روش پرداخت را اصلاح کنید.';
  }
  if (!installment.dueDate) errors.date = 'تاریخ پرداخت الزامی است.';
  if (installment.method === 'CHECK') {
    if (!installment.check?.ownerName?.trim()) errors.ownerName = 'نام صاحب چک الزامی است.';
    if (!installment.check?.handoverDate?.trim()) errors.handoverDate = 'تاریخ تحویل چک الزامی است.';
  }
  if (!isRetainedPartnerPayment(installment, savedInstallment) && partnerPaymentNeedsNationalCode(installment.method, installment.dueDate, currentDate)) {
    if (!installment.nationalCode?.trim()) errors.nationalCode = 'کد ملی برای پرداخت با تاریخ غیر از امروز الزامی است.';
    else if (!/^\d{10}$/.test(installment.nationalCode)) errors.nationalCode = 'کد ملی باید ۱۰ رقم باشد.';
  }
  return errors;
}

export function firstPartnerPaymentError(errors: PartnerPaymentFieldErrors): string | null {
  return Object.values(errors)[0] ?? null;
}

export function firstPartnerPaymentPlanError(plan: CustomerPaymentPlan, currentDate: string,
  existingContract = false, savedPlan?: CustomerPaymentPlan): string | null {
  for (const installment of plan.installments) {
    const error = firstPartnerPaymentError(validatePartnerPaymentInstallment(installment, currentDate, existingContract,
      savedPlan?.installments.find(item => item.installmentId === installment.installmentId)));
    if (error) return error;
  }
  return null;
}
