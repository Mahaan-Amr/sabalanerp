import { z } from 'zod';
import { DecimalSchema, IdSchema, TextSchema } from './primitives';

export const WHOLESALE_MANDATORY_DEFAULT_PERCENTAGE = '20';
export const WholesaleMandatoryPolicySchema = z.object({ enabled: z.boolean(),
  percentage: DecimalSchema.refine(value => Number(value) <= 100) }).strict();
export const WholesalePricingBreakdownSchema = z.object({
  materialAmount: DecimalSchema, componentAmount: DecimalSchema, totalAmount: DecimalSchema,
  ancillaryCharges: z.array(z.object({ id: IdSchema, label: TextSchema, amount: DecimalSchema,
    quantity: DecimalSchema.optional(), unitPrice: DecimalSchema.optional(), unit: TextSchema.optional() }).strict()).optional(),
  mandatoryCharges: z.array(z.object({ subjectId: IdSchema, basisAmount: DecimalSchema,
    percentage: DecimalSchema.refine(value => Number(value) <= 100), amount: DecimalSchema }).strict()),
}).strict();
export type WholesalePricingBreakdown = z.infer<typeof WholesalePricingBreakdownSchema>;
