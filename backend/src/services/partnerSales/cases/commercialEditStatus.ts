import { partnerCommercialStatus } from '@sabalanerp/partner-sales-contracts';

/** Editing depends only on these terminal statuses. Inquiry presentation cannot
 * change them, so navigation need not reconstruct private pricing catalogs. */
export function partnerCommercialEditStatus(input: Parameters<typeof partnerCommercialStatus>[0]) {
  const status = partnerCommercialStatus({ ...input, pricingReceived: false, inquiryWaiting: false });
  if (status === 'FINAL' || status === 'EXPIRED' || status === 'CANCELLED') return status;
  return 'OTHER' as const;
}
