import { partnerError, type PartnerError } from '@sabalanerp/partner-sales-contracts';

export const getPartnerSalesErrorMessage = (error: Pick<PartnerError, 'code'>): string =>
  partnerError(error.code).message;
