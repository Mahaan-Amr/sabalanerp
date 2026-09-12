import { PartnerErrorSchema, partnerError, type PartnerError } from '@sabalanerp/partner-sales-contracts';

export const getPartnerSalesErrorMessage = (error: Pick<PartnerError, 'code'>): string =>
  partnerError(error.code).message;

export const normalizePartnerSalesOperationalError = (error: unknown): unknown => {
  const parsed = PartnerErrorSchema.safeParse(error);
  if (!parsed.success) return error;
  const canonical = partnerError(parsed.data.code);
  return { response: { status: canonical.status, data: { error: canonical.message } } };
};
