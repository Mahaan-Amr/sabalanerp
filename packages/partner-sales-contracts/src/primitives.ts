import { z } from 'zod';

const normalizeNumerals = (value: unknown) => typeof value === 'string' ? value
  .replace(/[\u06F0-\u06F9]/g, digit => String(digit.charCodeAt(0) - 0x06F0))
  .replace(/[\u0660-\u0669]/g, digit => String(digit.charCodeAt(0) - 0x0660)) : value;

export const PARTNER_CONTRACT_VERSION = '1.10.0' as const;
export const PARTNER_SCHEMA_VERSION = 1 as const;
export const IdSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9:_-]*$/);
export const TextSchema = z.string().trim().min(1).max(4000);
export const PersianReasonSchema = TextSchema.refine(reason => /[\u0600-\u06ff]/u.test(reason), 'Persian business reason required');
export const DateSchema = z.preprocess(normalizeNumerals, z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).refine(value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
export const InstantSchema = z.string().datetime({ precision: 3 });
// Wire amounts are exact decimal strings, never binary floating-point numbers.
export const DecimalSchema = z.preprocess(normalizeNumerals, z.string().regex(/^(0|[1-9]\d*)(\.\d+)?$/).max(80));
export const SignedDecimalSchema = z.preprocess(normalizeNumerals, z.string().regex(/^-?(0|[1-9]\d*)(\.\d+)?$/).max(81));
export const QuantitySchema = DecimalSchema.refine(value => /[1-9]/.test(value));
export const HashSchema = z.string().regex(/^sha256-v1:[a-f0-9]{64}$/);
export const RevisionSchema = z.number().int().positive().safe();
export const CaseStateSchema = z.enum(['DRAFT', 'AWAITING_CUSTOMER_CONFIRMATION', 'CUSTOMER_APPROVED', 'COMMITTED', 'CANCELLED', 'VOIDED']);
export const PartnerPricingStateSchema = z.enum(['INCOMPLETE', 'AWAITING_INQUIRY', 'READY_TO_FINALIZE', 'EXPIRED']);
export const PartnerCustomerConfirmationStateSchema = z.enum(['NOT_SENT', 'SENT', 'APPROVED', 'REJECTED', 'RECONFIRMATION_REQUIRED']);
export const RevisionRefSchema = z.object({ caseId: IdSchema, revision: RevisionSchema, integrityHash: HashSchema }).strict();
export const MoneySchema = z.object({ amount: DecimalSchema, currency: z.enum(['IRR', 'IRT']) }).strict();
export const TotalsSchema = z.object({ net: DecimalSchema, discount: DecimalSchema, tax: DecimalSchema, charges: DecimalSchema, payable: DecimalSchema, currency: z.enum(['IRR', 'IRT']) }).strict();
export type RevisionRef = z.infer<typeof RevisionRefSchema>;
export type Money = z.infer<typeof MoneySchema>;
export type CaseState = z.infer<typeof CaseStateSchema>;
export type PartnerPricingState = z.infer<typeof PartnerPricingStateSchema>;
export type PartnerCustomerConfirmationState = z.infer<typeof PartnerCustomerConfirmationStateSchema>;

const paymentPlanSchema = (checkSchema: z.ZodTypeAny) => z.object({
  planId: IdSchema, version: RevisionSchema, effectiveDate: DateSchema,
  predecessorPlanId: IdSchema.optional(),
  installments: z.array(z.object({
    installmentId: IdSchema, dueDate: DateSchema, amount: MoneySchema,
    method: z.enum(['CASH', 'BANK_TRANSFER', 'CHECK', 'CREDIT']),
    subtype: TextSchema.optional(), check: checkSchema.optional(),
    nationalCode: z.preprocess(normalizeNumerals, z.string().regex(/^\d{10}$/)).optional(),
    notes: TextSchema.optional(),
  }).strict()),
}).strict().superRefine((plan, context) => {
  plan.installments.forEach((installment, index) => {
    if (installment.method === 'CHECK' && (!installment.check || installment.check.dueDate !== installment.dueDate)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['installments', index, 'check'],
        message: 'Check evidence and installment due date must match' });
    }
  });
});
const SabalanCheckEvidenceSchema = z.object({ number: TextSchema, bank: TextSchema, dueDate: DateSchema,
  ownerName: TextSchema.optional(), handoverDate: DateSchema.optional() }).strict();
const CustomerCheckEvidenceSchema = z.object({ number: z.string().trim().max(4000).optional(), bank: z.string().trim().max(4000).optional(),
  dueDate: DateSchema, ownerName: TextSchema.optional(), handoverDate: DateSchema.optional() }).strict();
export const PaymentPlanSchema = paymentPlanSchema(SabalanCheckEvidenceSchema);
export const CustomerPaymentPlanSchema = paymentPlanSchema(CustomerCheckEvidenceSchema);
export type PaymentPlan = z.infer<typeof PaymentPlanSchema>;
export type CustomerPaymentPlan = z.infer<typeof CustomerPaymentPlanSchema>;
export const DisplayPartySchema = z.object({ displayName: TextSchema, phone: TextSchema, address: TextSchema }).strict();
export const ProductDisplaySchema = z.object({ productRowId: IdSchema, description: TextSchema, quantity: QuantitySchema, unit: TextSchema }).strict();
export const DeliverySchema = z.object({ deliveryId: IdSchema, date: DateSchema, destination: TextSchema,
  projectManagerName: TextSchema.optional(), receiverName: TextSchema.optional(), notes: TextSchema.optional(),
  items: z.array(z.object({ productRowId: IdSchema, quantity: QuantitySchema }).strict()).min(1),
}).strict();
