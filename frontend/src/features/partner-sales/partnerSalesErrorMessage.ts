import { PartnerErrorSchema, partnerError, type PartnerError } from '@sabalanerp/partner-sales-contracts';
import { getSalesOperationalErrorKind, getSalesOperationalErrorMessage } from '@/features/sales/salesOperationalError';

export const partnerSalesActionFeedback = (error: unknown, failedAction: string) => {
  const normalized = normalizePartnerSalesOperationalError(error);
  return { kind: getSalesOperationalErrorKind(normalized), message: getSalesOperationalErrorMessage(normalized, {
    failedAction, nextStep: 'اطلاعات حفظ شده است؛ وضعیت را بررسی و دوباره تلاش کنید.',
  }) };
};

export const getPartnerSalesErrorMessage = (error: Pick<PartnerError, 'code'>): string =>
  partnerError(error.code).message;

export const normalizePartnerSalesOperationalError = (error: unknown): unknown => {
  const parsed = PartnerErrorSchema.safeParse(error);
  if (!parsed.success) return error;
  const canonical = partnerError(parsed.data.code);
  return { response: { status: canonical.status, data: { error: canonical.message } } };
};
