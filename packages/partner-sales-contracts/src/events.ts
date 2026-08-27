import { z } from 'zod';
import { DateSchema, DecimalSchema, HashSchema, IdSchema, InstantSchema, MoneySchema, PersianReasonSchema, RevisionRefSchema, SignedDecimalSchema } from './primitives';

const event = { schemaVersion: z.literal(1), eventId: IdSchema, commandId: IdSchema, correlationId: IdSchema,
  actorId: IdSchema, recordedAt: InstantSchema, effectiveDate: DateSchema, owner: RevisionRefSchema };
export const PartnerEventSchema = z.discriminatedUnion('type', [
  z.object({ ...event, type: z.literal('CASE_COMMITTED'), internalRecordId: IdSchema,
    trigger: z.enum(['SIGNED', 'PRINTED']), salesCreditOwnerId: IdSchema, sabalanNetAmount: MoneySchema }).strict(),
  z.object({ ...event, type: z.literal('SABALAN_FINANCIAL_APPROVED'), internalRecordId: IdSchema,
    accountingReceivableId: IdSchema, financialApprovalEvidenceId: IdSchema, amount: MoneySchema }).strict(),
  z.object({ ...event, type: z.literal('SABALAN_RECEIPT'), internalRecordId: IdSchema,
    accountingReceiptId: IdSchema, amount: MoneySchema }).strict(),
  z.object({ ...event, type: z.literal('SABALAN_ADJUSTMENT'), internalRecordId: IdSchema,
    originalRealizationEventId: IdSchema, correctionId: IdSchema, delta: SignedDecimalSchema,
    currency: z.enum(['IRR', 'IRT']), reason: PersianReasonSchema }).strict(),
  z.object({ ...event, type: z.literal('RETAIL_RECEIPT'), planId: IdSchema, receiptId: IdSchema, amount: MoneySchema,
    allocations: z.array(z.object({ installmentId: IdSchema, amount: DecimalSchema }).strict()) }).strict(),
  z.object({ ...event, type: z.literal('RETAIL_RECEIPT_REVERSED'), planId: IdSchema,
    originalReceiptId: IdSchema, reversalId: IdSchema, amount: MoneySchema, reason: PersianReasonSchema }).strict(),
  z.object({ ...event, type: z.literal('RETAIL_PAYMENT_DELAYED'), planId: IdSchema, installmentId: IdSchema }).strict(),
  z.object({ ...event, type: z.literal('PAYMENT_PLAN_SUCCEEDED'), purpose: z.enum(['RETAIL', 'SABALAN']),
    predecessorPlanId: IdSchema, successorPlanId: IdSchema }).strict(),
  z.object({ ...event, type: z.literal('CASE_CANCELLED'), reason: PersianReasonSchema }).strict(),
  z.object({ ...event, type: z.literal('CASE_VOIDED'), correctionId: IdSchema, commitmentEventId: IdSchema,
    adjustmentEventIds: z.array(IdSchema), dependencyEvidenceIds: z.array(IdSchema), reason: PersianReasonSchema }).strict(),
  z.object({ ...event, type: z.literal('CORRECTION_EFFECTIVE'), predecessor: RevisionRefSchema,
    correctionId: IdSchema, scope: z.enum(['RETAIL_ONLY', 'SHARED', 'SABALAN_TERMS']), gateEvidenceIds: z.array(IdSchema).min(1) }).strict(),
]);
export type PartnerEvent = z.infer<typeof PartnerEventSchema>;

export const CorrectionOpportunitySchema = z.object({
  schemaVersion: z.literal(1), opportunityId: IdSchema, predecessor: RevisionRefSchema,
  scope: z.enum(['RETAIL_ONLY', 'SHARED', 'SABALAN_TERMS']), partnerSellerId: IdSchema,
  approvedAt: InstantSchema, expiresAt: InstantSchema, calendarVersion: IdSchema,
  workingDays: z.literal(3), successfulSavesAllowed: z.literal(1),
  savedSuccessor: RevisionRefSchema.optional(), scopeHash: HashSchema,
}).strict();
