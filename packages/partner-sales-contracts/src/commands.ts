import { z } from 'zod';
import { CaseStateSchema, CustomerPaymentPlanSchema, DateSchema, DecimalSchema, DeliverySchema, HashSchema, IdSchema, MoneySchema, PersianReasonSchema, RevisionRefSchema, RevisionSchema, TextSchema } from './primitives';
import { IdempotencySchema } from './integrity';
import { ApprovedRowBindingSchema, PartnerConfigurationRefSchema } from './inquiry';
import { PartnerErrorSchema } from './errors';

const envelope = { schemaVersion: z.literal(1), commandId: IdSchema, correlationId: IdSchema, idempotency: IdempotencySchema };
const expected = { expected: RevisionRefSchema, expectedState: CaseStateSchema };
export const PartnerDraftSubmissionRefSchema = z.object({
  customerId: IdSchema, recoveryId: IdSchema, recoveryRevision: RevisionSchema,
  graphHash: HashSchema, sabalanTermsVersionId: IdSchema.optional(),
}).strict();
const inquiryDimensions = z.object({
  lengthMeters: DecimalSchema.optional(), widthMeters: DecimalSchema.optional(),
  thicknessCentimeters: DecimalSchema.optional(),
}).strict();
const inquiryRows = z.array(z.object({ rowId: IdSchema, configuration: PartnerConfigurationRefSchema,
  sellerNote: TextSchema.optional(),
  dimensions: inquiryDimensions.optional(),
  deliveryFacts: z.array(z.object({ date: DateSchema, quantity: DecimalSchema }).strict()).min(1).optional(),
  predecessor: z.object({ rowId: IdSchema, revision: RevisionSchema, reason: PersianReasonSchema.optional() }).strict().optional(),
}).strict()).min(1);
export const CaseDraftIntentSchema = PartnerDraftSubmissionRefSchema.extend({
  projectId: IdSchema.optional(), contractDate: DateSchema,
  // The Case writer resolves this immutable private recovery graph; no second graph owner.
  rows: z.array(z.object({ productRowId: IdSchema, approvedRowBinding: ApprovedRowBindingSchema.optional(),
    retailUnitPrice: MoneySchema }).strict()).min(1),
  additionalMaterialApprovals: z.array(z.object({ pricingSubjectId: IdSchema,
    approvedRowBinding: ApprovedRowBindingSchema }).strict()).optional(),
  customerPaymentPlan: CustomerPaymentPlanSchema,
  retailDiscount: MoneySchema, belowCostConfirmed: z.boolean(), deliveries: z.array(DeliverySchema),
  pricingRequest: z.object({ inquiryId: IdSchema, rows: inquiryRows }).strict().optional(),
}).strict();
export const PartnerDraftEditLeaseSchema = z.object({
  recoveryId: IdSchema,
  browserSessionId: IdSchema,
  leaseToken: IdSchema,
  baseRevision: z.number().int().nonnegative().safe(),
}).strict();
const decision = z.discriminatedUnion('outcome', [
  z.object({ rowId: IdSchema, expectedRevision: RevisionSchema, outcome: z.literal('APPROVED'), wholesaleUnitPrice: MoneySchema }).strict(),
  z.object({ rowId: IdSchema, expectedRevision: RevisionSchema, outcome: z.literal('REJECTED'), reason: PersianReasonSchema }).strict(),
]);
export const PartnerCommandSchema = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.literal('CASE_SUBMIT'), intent: CaseDraftIntentSchema }).strict(),
  z.object({ ...envelope, ...expected, type: z.literal('CASE_DRAFT_REVISE'),
    editLease: PartnerDraftEditLeaseSchema, intent: CaseDraftIntentSchema }).strict(),
  z.object({ ...envelope, ...expected, type: z.literal('CASE_CANCEL'), reason: PersianReasonSchema }).strict(),
  z.object({ ...envelope, ...expected, type: z.literal('CASE_COMMIT'), trigger: z.enum(['FINALIZED', 'SIGNED', 'PRINTED']),
    authenticatedOutputEvidenceId: IdSchema, lossAccepted: z.boolean() }).strict(),
  z.object({ ...envelope, ...expected, type: z.literal('CUSTOMER_CONFIRMATION_SEND'), normalizedRecipient: TextSchema }).strict(),
  z.object({ ...envelope, type: z.literal('INQUIRY_SUBMIT'), partnerSellerId: IdSchema,
    rows: inquiryRows }).strict(),
  z.object({ ...envelope, type: z.literal('CASE_PRICING_SUBMIT'), expected: RevisionRefSchema, caseId: IdSchema, inquiryId: IdSchema,
    rows: inquiryRows }).strict(),
  z.object({ ...envelope, type: z.literal('INQUIRY_DECIDE'), inquiryId: IdSchema, expectedAssignmentRevision: RevisionSchema, decisions: z.array(decision).min(1) }).strict(),
  z.object({ ...envelope, type: z.literal('INQUIRY_CANCEL'), inquiryId: IdSchema, expectedRevision: RevisionSchema, reason: PersianReasonSchema }).strict(),
  z.object({ ...envelope, type: z.literal('INQUIRY_REASSIGN'), inquiryId: IdSchema, expectedAssignmentRevision: RevisionSchema, responderId: IdSchema, reason: PersianReasonSchema }).strict(),
  z.object({ ...envelope, ...expected, type: z.literal('CORRECTION_REQUEST'), scope: z.enum(['RETAIL_ONLY', 'SHARED', 'SABALAN_TERMS', 'VOID']), reason: PersianReasonSchema }).strict(),
  z.object({ ...envelope, ...expected, type: z.literal('RETAIL_CORRECTION_SAVE'), opportunityId: IdSchema,
    retailPrices: z.array(z.object({ productRowId: IdSchema, retailUnitPrice: MoneySchema }).strict()), customerPaymentPlan: CustomerPaymentPlanSchema }).strict(),
  z.object({ ...envelope, ...expected, type: z.literal('SHARED_CORRECTION_SAVE'), opportunityId: IdSchema, intent: CaseDraftIntentSchema, dependencyEvidenceIds: z.array(IdSchema) }).strict(),
  z.object({ ...envelope, ...expected, type: z.literal('VOID_REMEDIATION_REQUEST'), reason: PersianReasonSchema }).strict(),
  z.object({ ...envelope, ...expected, type: z.literal('CORRECTION_GATE'), correctionId: IdSchema,
    gate: z.enum(['SALES_SCOPE', 'ACCOUNTING_PROCESS', 'ACCOUNTING_MANAGER', 'ACCOUNTING_VERIFY', 'CUSTOMER_CONFIRM']),
    outcome: z.enum(['APPROVE', 'REJECT']), evidenceId: IdSchema, reason: PersianReasonSchema }).strict(),
  z.object({ ...envelope, ...expected, type: z.literal('RETAIL_RECEIPT'), planId: IdSchema, receiptId: IdSchema,
    amount: MoneySchema, effectiveDate: DateSchema, method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'OTHER']),
    reference: TextSchema.optional(), note: TextSchema.optional(),
    allocations: z.array(z.object({ installmentId: IdSchema, amount: DecimalSchema }).strict()) }).strict(),
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
  if (command.type === 'CASE_PRICING_SUBMIT' && command.idempotency.targetId !== command.caseId) {
    invalid('Pricing request target must match Case');
  }
  if (command.type === 'CASE_PRICING_SUBMIT' && command.expected.caseId !== command.caseId) {
    invalid('Pricing request revision must match Case');
  }
  if (command.type === 'CASE_DRAFT_REVISE' && command.editLease.recoveryId !== command.intent.recoveryId) {
    invalid('Edit lease must match recovery');
  }
  if (command.type === 'INQUIRY_DECIDE' && new Set(command.decisions.map(row => row.rowId)).size !== command.decisions.length) invalid('Duplicate decision row');
  if (command.type === 'INQUIRY_DECIDE' && command.decisions.some(row =>
    row.outcome === 'APPROVED' && !/[1-9]/.test(row.wholesaleUnitPrice.amount))) invalid('Approved price must be positive');
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
