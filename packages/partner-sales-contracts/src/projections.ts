import { z } from 'zod';
import { CaseStateSchema, DateSchema, DecimalSchema, DeliverySchema, DisplayPartySchema, HashSchema, IdSchema, InstantSchema, MoneySchema, PaymentPlanSchema, ProductDisplaySchema, RevisionRefSchema, RevisionSchema, SignedDecimalSchema, TextSchema, TotalsSchema } from './primitives';

// Positive, recursively strict DTOs. Never spread a Prisma entity into these views.
// The internal Case hash is intentionally absent from the public output.
export const CustomerContractOutputSchema = z.object({
  schemaVersion: z.literal(1), purpose: z.literal('CUSTOMER_OUTPUT'),
  contractNumber: IdSchema, revision: RevisionSchema, outputHash: HashSchema,
  status: z.enum(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SIGNED', 'PRINTED', 'CANCELLED']),
  contractDate: DateSchema, seller: DisplayPartySchema, customer: DisplayPartySchema,
  products: z.array(ProductDisplaySchema.extend({ retailUnitPrice: DecimalSchema }).strict()).min(1),
  totals: TotalsSchema, customerPaymentPlan: PaymentPlanSchema, deliveries: z.array(DeliverySchema),
  legalText: TextSchema, signatures: z.array(z.object({ name: TextSchema, signedAt: TextSchema }).strict()),
  confirmation: z.enum(['NOT_SENT', 'PENDING', 'VERIFIED', 'INVALIDATED']),
}).strict();
export type CustomerContractOutput = z.infer<typeof CustomerContractOutputSchema>;

// INTERNAL session evidence. Public/PDF consumers receive content only, not this wrapper.
export const CustomerOutputSnapshotSchema = z.object({
  schemaVersion: z.literal(1), snapshotId: IdSchema, owner: RevisionRefSchema,
  normalizedRecipient: z.string().regex(/^\+[1-9]\d{7,14}$/), createdAt: InstantSchema, expiresAt: InstantSchema,
  content: CustomerContractOutputSchema,
}).strict().refine(snapshot => snapshot.owner.revision === snapshot.content.revision && snapshot.createdAt < snapshot.expiresAt);

export const PartnerCaseViewSchema = z.object({
  schemaVersion: z.literal(1), purpose: z.literal('PARTNER_CASE'), owner: RevisionRefSchema,
  caseNumber: IdSchema, customerContractNumber: IdSchema, state: CaseStateSchema,
  products: z.array(ProductDisplaySchema.extend({ wholesaleUnitPrice: DecimalSchema, retailUnitPrice: DecimalSchema }).strict()),
  retailTotals: TotalsSchema, sabalanTotals: TotalsSchema, resaleDifference: SignedDecimalSchema,
  customerPaymentPlan: PaymentPlanSchema, sabalanPaymentPlan: PaymentPlanSchema, deliveries: z.array(DeliverySchema),
}).strict();
export const SabalanInternalRecordViewSchema = z.object({
  schemaVersion: z.literal(1), purpose: z.literal('ACCOUNTING'), sourceKind: z.literal('SABALAN_TO_PARTNER'),
  owner: RevisionRefSchema, recordId: IdSchema, recordNumber: IdSchema, caseNumber: IdSchema, customerContractNumber: IdSchema,
  commercialAccountId: IdSchema, debtor: DisplayPartySchema, state: CaseStateSchema,
  products: z.array(ProductDisplaySchema.extend({ wholesaleUnitPrice: DecimalSchema, approvalEvidenceId: IdSchema }).strict()),
  totals: TotalsSchema, sabalanPaymentPlan: PaymentPlanSchema,
}).strict();
export const FulfillmentViewSchema = z.object({
  schemaVersion: z.literal(1), purpose: z.literal('FULFILLMENT'), sourceKind: z.literal('SABALAN_TO_PARTNER'),
  owner: RevisionRefSchema, recordId: IdSchema, mode: z.literal('DIRECT_TO_CUSTOMER'),
  products: z.array(ProductDisplaySchema), deliveries: z.array(DeliverySchema),
}).strict();
export const PartnerAccountViewSchema = z.object({
  schemaVersion: z.literal(1), purpose: z.literal('PARTNER_ACCOUNT'), partnerSellerId: IdSchema,
  purchases: z.array(z.object({ owner: RevisionRefSchema, caseNumber: IdSchema, amount: MoneySchema,
    sabalanPaymentPlan: PaymentPlanSchema, received: MoneySchema, balance: MoneySchema,
    status: z.enum(['AWAITING_REVIEW', 'PAYABLE', 'PARTIALLY_PAID', 'SETTLED', 'VOIDED']),
  }).strict()),
}).strict();
export const DuplicateCustomerMatchSchema = z.object({
  schemaVersion: z.literal(1), purpose: z.literal('DUPLICATE_MATCH'), matchReference: IdSchema,
  displayName: TextSchema, personType: z.enum(['NATURAL', 'LEGAL']), city: TextSchema,
  maskedWitness: z.string().regex(/^\*{4,}\d{4}$/),
}).strict();
export const PartnerProfileViewSchema = z.object({
  schemaVersion: z.literal(1), purpose: z.literal('ONBOARDING'), profileId: IdSchema, revision: RevisionSchema,
  partnerSellerId: IdSchema, status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED']),
  identityVerified: z.boolean(), commercialTermsReady: z.boolean(), creditTermsReady: z.boolean(), responderReady: z.boolean(),
  conversionCleared: z.boolean(), cohortReady: z.boolean(),
}).strict();
export type PartnerCaseView = z.infer<typeof PartnerCaseViewSchema>;
export type SabalanInternalRecordView = z.infer<typeof SabalanInternalRecordViewSchema>;
export type FulfillmentView = z.infer<typeof FulfillmentViewSchema>;
export type PartnerAccountView = z.infer<typeof PartnerAccountViewSchema>;
export type PartnerProfileView = z.infer<typeof PartnerProfileViewSchema>;
