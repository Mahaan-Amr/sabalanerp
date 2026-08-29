import { z } from 'zod';
import { DateSchema, HashSchema, IdSchema, PersianReasonSchema } from './primitives';
import type { Result } from './errors';

const decimal = z.string().max(80).regex(/^(0|[1-9]\d*)(?:\.\d+)?$/);
const positiveDecimal = decimal.refine(value => /[1-9]/.test(value));
const percentage = decimal.refine(value => {
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) < 100 || (whole === '100' && !/[1-9]/.test(fraction));
});

export const PartnerTechnicalPricingPolicySchema = z.object({
  schemaVersion: z.literal(1), purpose: z.literal('PARTNER_TECHNICAL_PRICING'),
  calculationPolicy: z.object({
    calculation: IdSchema, packing: IdSchema, pricing: IdSchema, rounding: IdSchema,
  }).strict(),
  mandatoryPercentage: percentage,
  mandatoryEnabled: z.boolean(),
  slabCuttingPricingMethod: z.enum(['lineBased', 'squareMeter']),
  sawKerfMeters: decimal,
  materialRateScale: positiveDecimal,
  currency: z.literal('IRT'),
  rates: z.object({
    longitudinalCutRateToman: decimal,
    crossCutRateToman: decimal,
    calibrationCutRateToman: decimal,
    verticalCutRateToman: decimal,
    squareMeterCutRateToman: decimal,
  }).strict(),
}).strict();

export const PartnerTechnicalPolicyPublishSchema = z.object({
  schemaVersion: z.literal(1), purpose: z.literal('PARTNER_TECHNICAL_POLICY_PUBLISH'),
  profileId: IdSchema, expectedVersion: z.number().int().nonnegative().safe(),
  effectiveDate: DateSchema, reason: PersianReasonSchema,
  policy: PartnerTechnicalPricingPolicySchema,
}).strict();

const persistedPolicy = PartnerTechnicalPricingPolicySchema.extend({
  policyId: IdSchema, version: z.number().int().positive().safe(),
  effectiveDate: DateSchema, integrityHash: HashSchema,
}).strict();

export const PartnerTechnicalPolicyViewSchema = z.object({
  schemaVersion: z.literal(1), purpose: z.literal('PARTNER_TECHNICAL_POLICY'),
  profileId: IdSchema, accountVersion: z.number().int().nonnegative().safe(),
  policy: persistedPolicy,
}).strict();

export const PartnerTechnicalPolicyReceiptSchema = PartnerTechnicalPolicyViewSchema;

export type PartnerTechnicalPricingPolicy = z.infer<typeof PartnerTechnicalPricingPolicySchema>;
export type PartnerTechnicalPolicyPublish = z.infer<typeof PartnerTechnicalPolicyPublishSchema>;
export type PartnerTechnicalPolicyView = z.infer<typeof PartnerTechnicalPolicyViewSchema>;
export type PartnerTechnicalPolicyReceipt = z.infer<typeof PartnerTechnicalPolicyReceiptSchema>;

export interface PartnerTechnicalPolicyPort {
  read(profileId: string): Promise<Result<PartnerTechnicalPolicyView>>;
  publish(command: PartnerTechnicalPolicyPublish): Promise<Result<PartnerTechnicalPolicyReceipt>>;
}
