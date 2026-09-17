import type { CustomerPaymentPlan } from '@sabalanerp/partner-sales-contracts';

type PartnerInstallment = CustomerPaymentPlan['installments'][number];
export type PartnerPaymentFieldErrors = Partial<Record<'amount' | 'date' | 'number' | 'bank' | 'ownerName' | 'handoverDate' | 'nationalCode', string>>;

export function validatePartnerPaymentInstallment(installment: PartnerInstallment, currentDate: string): PartnerPaymentFieldErrors {
  const errors: PartnerPaymentFieldErrors = {};
  if (!installment.amount.amount || installment.amount.amount === '0') errors.amount = 'مبلغ پرداخت باید بیشتر از صفر باشد.';
  if (!installment.dueDate) errors.date = 'تاریخ پرداخت الزامی است.';
  if (installment.method === 'CHECK') {
    if (!installment.check?.ownerName?.trim()) errors.ownerName = 'نام صاحب چک الزامی است.';
    if (!installment.check?.handoverDate?.trim()) errors.handoverDate = 'تاریخ تحویل چک الزامی است.';
  }
  if (installment.method !== 'CREDIT' && installment.dueDate && installment.dueDate !== currentDate) {
    if (!installment.nationalCode?.trim()) errors.nationalCode = 'کد ملی برای پرداخت با تاریخ غیر از امروز الزامی است.';
    else if (!/^\d{10}$/.test(installment.nationalCode)) errors.nationalCode = 'کد ملی باید ۱۰ رقم باشد.';
  }
  return errors;
}

export function firstPartnerPaymentError(errors: PartnerPaymentFieldErrors): string | null {
  return Object.values(errors)[0] ?? null;
}

export function firstPartnerPaymentPlanError(plan: CustomerPaymentPlan, currentDate: string): string | null {
  for (const installment of plan.installments) {
    const error = firstPartnerPaymentError(validatePartnerPaymentInstallment(installment, currentDate));
    if (error) return error;
  }
  return null;
}
