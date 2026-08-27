import { z } from 'zod';

export const PARTNER_CONTRACT_VERSION = '1.0.0' as const;
export const PARTNER_SCHEMA_VERSION = 1 as const;
export const IdSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9:_-]*$/);
export const TextSchema = z.string().trim().min(1).max(4000);
export const PersianReasonSchema = TextSchema.refine(reason => /[\u0600-\u06ff]/u.test(reason), 'Persian business reason required');
export const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});
export const InstantSchema = z.string().datetime({ precision: 3 });
// Wire amounts are exact decimal strings, never binary floating-point numbers.
export const DecimalSchema = z.string().regex(/^(0|[1-9]\d*)(\.\d+)?$/).max(80);
export const SignedDecimalSchema = z.string().regex(/^-?(0|[1-9]\d*)(\.\d+)?$/).max(81);
export const QuantitySchema = DecimalSchema.refine(value => /[1-9]/.test(value));
export const HashSchema = z.string().regex(/^sha256-v1:[a-f0-9]{64}$/);
export const RevisionSchema = z.number().int().positive().safe();
export const CaseStateSchema = z.enum(['DRAFT', 'AWAITING_CUSTOMER_CONFIRMATION', 'CUSTOMER_APPROVED', 'COMMITTED', 'CANCELLED', 'VOIDED']);
export const RevisionRefSchema = z.object({ caseId: IdSchema, revision: RevisionSchema, integrityHash: HashSchema }).strict();
export const MoneySchema = z.object({ amount: DecimalSchema, currency: z.enum(['IRR', 'IRT']) }).strict();
export const TotalsSchema = z.object({ net: DecimalSchema, discount: DecimalSchema, tax: DecimalSchema, charges: DecimalSchema, payable: DecimalSchema, currency: z.enum(['IRR', 'IRT']) }).strict();
export type RevisionRef = z.infer<typeof RevisionRefSchema>;
export type Money = z.infer<typeof MoneySchema>;
export type CaseState = z.infer<typeof CaseStateSchema>;

export const PaymentPlanSchema = z.object({
  planId: IdSchema, version: RevisionSchema, effectiveDate: DateSchema,
  predecessorPlanId: IdSchema.optional(),
  installments: z.array(z.object({
    installmentId: IdSchema, dueDate: DateSchema, amount: MoneySchema,
    method: z.enum(['CASH', 'BANK_TRANSFER', 'CHECK', 'CREDIT']),
    subtype: TextSchema.optional(), check: z.object({ number: TextSchema, bank: TextSchema, dueDate: DateSchema }).strict().optional(),
    notes: TextSchema.optional(),
  }).strict()),
}).strict();
export const DisplayPartySchema = z.object({ displayName: TextSchema, phone: TextSchema, address: TextSchema }).strict();
export const ProductDisplaySchema = z.object({ productRowId: IdSchema, description: TextSchema, quantity: QuantitySchema, unit: TextSchema }).strict();
export const DeliverySchema = z.object({ deliveryId: IdSchema, date: DateSchema, destination: TextSchema,
  items: z.array(z.object({ productRowId: IdSchema, quantity: QuantitySchema }).strict()).min(1),
}).strict();
