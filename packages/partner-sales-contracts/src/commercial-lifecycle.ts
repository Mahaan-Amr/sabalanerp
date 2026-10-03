import { z } from 'zod';

export const PartnerCommercialStateSchema = z.object({
  version: z.literal(1), revision: z.number().int().positive(),
  status: z.enum(['NOTE', 'DRAFT', 'CUSTOMER_SIGNED', 'FINAL', 'QUOTED', 'EXPIRED', 'CANCELLED']),
  salesApproved: z.boolean(), customerAccepted: z.boolean(),
  inquiry: z.enum(['ACCEPTED', 'REJECTED', 'WAITING', 'CORRECTION_REQUIRED']),
  expiresAt: z.string().datetime().nullable(), firstFinancialRecordAt: z.string().datetime().nullable(),
}).strict();
export type PartnerCommercialState = z.infer<typeof PartnerCommercialStateSchema>;

export function partnerCommercialStatus(input: { salesApproved: boolean; customerAccepted: boolean;
  pricingAccepted: boolean; pricingReceived?: boolean; expired?: boolean; cancelled?: boolean }): PartnerCommercialState['status'] {
  if (input.cancelled) return 'CANCELLED';
  if (input.expired) return 'EXPIRED';
  if (input.salesApproved && input.customerAccepted && input.pricingAccepted) return 'FINAL';
  if (input.pricingReceived || input.pricingAccepted) return 'QUOTED';
  if (input.customerAccepted) return 'CUSTOMER_SIGNED';
  return input.salesApproved ? 'DRAFT' : 'NOTE';
}
export const partnerCommercialLabels: Record<PartnerCommercialState['status'], string> = {
  NOTE: 'یادداشت', DRAFT: 'پیش‌نویس', CUSTOMER_SIGNED: 'امضا شده', FINAL: 'قطعی',
  QUOTED: 'استعلام شده', EXPIRED: 'منقضی شده', CANCELLED: 'لغو شده',
};
export const partnerInquiryLabels: Record<PartnerCommercialState['inquiry'], string> = {
  ACCEPTED: 'تأیید استعلام', REJECTED: 'رد استعلام', WAITING: 'در حال انتظار', CORRECTION_REQUIRED: 'نیازمند اصلاح',
};
