import { z } from 'zod';
import { CaseStateSchema, DateSchema, DecimalSchema, DeliverySchema, HashSchema, IdSchema, MoneySchema, PaymentPlanSchema, RevisionRefSchema, RevisionSchema, TextSchema } from './primitives';
import { IdempotencySchema } from './integrity';
import { InquiryIdentitySchema } from './inquiry';
import { PartnerErrorSchema } from './errors';

const envelope = { schemaVersion: z.literal(1), commandId: IdSchema, correlationId: IdSchema, idempotency: IdempotencySchema };
const expected = { expected: RevisionRefSchema, expectedState: CaseStateSchema };
export const PersianReasonSchema = TextSchema.refine(reason => /[\u0600-\u06ff]/u.test(reason), 'Persian business reason required');
export const CaseDraftIntentSchema = z.object({
  customerId: IdSchema, projectId: IdSchema.optional(), contractDate: DateSchema,
  // The Case writer resolves this immutable private recovery graph; no second graph owner.
  recoveryId: IdSchema, recoveryRevision: RevisionSchema, graphHash: HashSchema,
  rows: z.array(z.object({ productRowId: IdSchema, approvalId: IdSchema, approvalRevision: RevisionSchema,
    approvalHash: HashSchema, configurationHash: HashSchema, retailUnitPrice: MoneySchema }).strict()).min(1),
  customerPaymentPlan: PaymentPlanSchema, sabalanTermsVersionId: IdSchema,
  retailDiscount: MoneySchema, belowCostConfirmed: z.boolean(), deliveries: z.array(DeliverySchema),
}).strict();
const decision = z.discriminatedUnion('outcome', [
  z.object({ rowId: IdSchema, expectedRevision: RevisionSchema, outcome: z.literal('APPROVED'), wholesaleUnitPrice: MoneySchema, note: TextSchema.optional() }).strict(),
  z.object({ rowId: IdSchema, expectedRevision: RevisionSchema, outcome: z.literal('REJECTED'), reason: PersianReasonSchema }).strict(),
]);
export const PartnerCommandSchema = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.literal('CASE_SUBMIT'), intent: CaseDraftIntentSchema }).strict(),
  z.object({ ...envelope, ...expected, type: z.literal('CASE_DRAFT_REVISE'), intent: CaseDraftIntentSchema }).strict(),
  z.object({ ...envelope, ...expected, type: z.literal('CASE_CANCEL'), reason: PersianReasonSchema }).strict(),
  z.object({ ...envelope, ...expected, type: z.literal('CASE_COMMIT'), trigger: z.enum(['SIGNED', 'PRINTED']), authenticatedOutputEvidenceId: IdSchema }).strict(),
  z.object({ ...envelope, ...expected, type: z.literal('CUSTOMER_CONFIRMATION_SEND'), normalizedRecipient: TextSchema }).strict(),
  z.object({ ...envelope, type: z.literal('INQUIRY_SUBMIT'), partnerSellerId: IdSchema,
    rows: z.array(z.object({ rowId: IdSchema, identity: InquiryIdentitySchema, predecessorRowId: IdSchema.optional() }).strict()).min(1) }).strict(),
  z.object({ ...envelope, type: z.literal('INQUIRY_DECIDE'), inquiryId: IdSchema, expectedAssignmentRevision: RevisionSchema, decisions: z.array(decision).min(1) }).strict(),
  z.object({ ...envelope, type: z.literal('INQUIRY_CANCEL'), inquiryId: IdSchema, expectedRevision: RevisionSchema, reason: PersianReasonSchema }).strict(),
  z.object({ ...envelope, type: z.literal('INQUIRY_REASSIGN'), inquiryId: IdSchema, expectedAssignmentRevision: RevisionSchema, responderId: IdSchema, reason: PersianReasonSchema }).strict(),
  z.object({ ...envelope, ...expected, type: z.literal('CORRECTION_REQUEST'), scope: z.enum(['RETAIL_ONLY', 'SHARED', 'SABALAN_TERMS', 'VOID']), reason: PersianReasonSchema }).strict(),
  z.object({ ...envelope, ...expected, type: z.literal('RETAIL_CORRECTION_SAVE'), opportunityId: IdSchema,
    retailPrices: z.array(z.object({ productRowId: IdSchema, retailUnitPrice: MoneySchema }).strict()), customerPaymentPlan: PaymentPlanSchema }).strict(),
  z.object({ ...envelope, ...expected, type: z.literal('SHARED_CORRECTION_SAVE'), opportunityId: IdSchema, intent: CaseDraftIntentSchema, dependencyEvidenceIds: z.array(IdSchema) }).strict(),
  z.object({ ...envelope, ...expected, type: z.literal('VOID_REMEDIATION_REQUEST'), reason: PersianReasonSchema }).strict(),
  z.object({ ...envelope, ...expected, type: z.literal('CORRECTION_GATE'), correctionId: IdSchema,
    gate: z.enum(['SALES_SCOPE', 'ACCOUNTING_PROCESS', 'ACCOUNTING_MANAGER', 'ACCOUNTING_VERIFY', 'CUSTOMER_CONFIRM']),
    outcome: z.enum(['APPROVE', 'REJECT']), evidenceId: IdSchema, reason: PersianReasonSchema }).strict(),
  z.object({ ...envelope, ...expected, type: z.literal('RETAIL_RECEIPT'), planId: IdSchema, receiptId: IdSchema,
    amount: MoneySchema, effectiveDate: DateSchema, allocations: z.array(z.object({ installmentId: IdSchema, amount: DecimalSchema }).strict()) }).strict(),
  z.object({ ...envelope, ...expected, type: z.literal('RETAIL_RECEIPT_REVERSE'), receiptId: IdSchema, effectiveDate: DateSchema, reason: PersianReasonSchema }).strict(),
  z.object({ ...envelope, type: z.literal('PROFILE_TRANSITION'), profileId: IdSchema, expectedRevision: RevisionSchema,
    to: z.enum(['ACTIVE', 'SUSPENDED', 'TERMINATED']), reason: PersianReasonSchema, gateEvidenceIds: z.array(IdSchema) }).strict(),
  z.object({ ...envelope, type: z.literal('CUSTOMER_TRANSFER_DECIDE'), transferId: IdSchema, expectedRevision: RevisionSchema,
    outcome: z.enum(['APPROVE', 'REJECT']), reason: PersianReasonSchema }).strict(),
  z.object({ ...envelope, type: z.literal('OPERATIONS_PAUSE'), kind: z.enum(['ENROLLMENT', 'OPERATIONAL']), paused: z.boolean(), expectedRevision: RevisionSchema, reason: PersianReasonSchema }).strict(),
]).superRefine((command, context) => {
  const invalid = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
  if (command.idempotency.operation !== command.type) invalid('Idempotency operation must match command');
  if ('expected' in command && command.idempotency.targetId !== command.expected.caseId) invalid('Idempotency target must match Case');
  if (command.type === 'INQUIRY_DECIDE' && new Set(command.decisions.map(row => row.rowId)).size !== command.decisions.length) invalid('Duplicate decision row');
});
export type PartnerCommand = z.infer<typeof PartnerCommandSchema>;
export const InquiryBatchResultSchema = z.object({
  schemaVersion: z.literal(1), commandId: IdSchema,
  outcomes: z.array(z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), rowId: IdSchema, outcomeId: IdSchema, revision: RevisionSchema, outcome: z.enum(['APPROVED', 'REJECTED']) }).strict(),
    z.object({ ok: z.literal(false), rowId: IdSchema, error: PartnerErrorSchema }).strict(),
  ])),
}).strict();
export type InquiryBatchResult = z.infer<typeof InquiryBatchResultSchema>;
