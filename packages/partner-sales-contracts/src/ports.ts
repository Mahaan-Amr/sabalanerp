import { z } from 'zod';
import { HashSchema, IdSchema, InstantSchema, RevisionRefSchema } from './primitives';
import { PartnerCommand, InquiryBatchResult } from './commands';
import { PartnerEvent } from './events';
import { Result } from './errors';
import { CustomerContractOutput, FulfillmentView, PartnerAccountView, PartnerCaseView, PartnerProfileView, SabalanInternalRecordView } from './projections';
import { PartnerInquiryViewSchema, ResponderInquiryViewSchema } from './inquiry';

export const PartnerQuerySchema = z.discriminatedUnion('purpose', [
  z.object({ schemaVersion: z.literal(1), purpose: z.literal('PARTNER_CASE'), expected: RevisionRefSchema }).strict(),
  z.object({ schemaVersion: z.literal(1), purpose: z.literal('ACCOUNTING'), expected: RevisionRefSchema }).strict(),
  z.object({ schemaVersion: z.literal(1), purpose: z.literal('FULFILLMENT'), expected: RevisionRefSchema }).strict(),
  z.object({ schemaVersion: z.literal(1), purpose: z.literal('CUSTOMER_OUTPUT'), snapshotId: IdSchema, outputHash: HashSchema }).strict(),
  z.object({ schemaVersion: z.literal(1), purpose: z.literal('PARTNER_ACCOUNT'), partnerSellerId: IdSchema }).strict(),
  z.object({ schemaVersion: z.literal(1), purpose: z.literal('ONBOARDING'), profileId: IdSchema }).strict(),
  z.object({ schemaVersion: z.literal(1), purpose: z.literal('PARTNER_INQUIRY'), inquiryId: IdSchema }).strict(),
  z.object({ schemaVersion: z.literal(1), purpose: z.literal('RESPONDER_INQUIRY'), inquiryId: IdSchema }).strict(),
]);
export type PartnerQuery = z.infer<typeof PartnerQuerySchema>;
export interface PartnerQueryResults {
  PARTNER_CASE: PartnerCaseView;
  ACCOUNTING: SabalanInternalRecordView;
  FULFILLMENT: FulfillmentView;
  CUSTOMER_OUTPUT: CustomerContractOutput;
  PARTNER_ACCOUNT: PartnerAccountView;
  ONBOARDING: PartnerProfileView;
  PARTNER_INQUIRY: z.infer<typeof PartnerInquiryViewSchema>;
  RESPONDER_INQUIRY: z.infer<typeof ResponderInquiryViewSchema>;
}
export interface PartnerQueryPort {
  /** Trusted adapter binds authenticated actor/session; IDs never grant access. */
  query<P extends PartnerQuery['purpose']>(query: Extract<PartnerQuery, { purpose: P }>): Promise<Result<PartnerQueryResults[P]>>;
}
export interface PartnerCommandPort {
  /** Owners implement transaction/CAS, current authorization and durable same-intent replay. */
  execute(command: PartnerCommand): Promise<Result<{
    commandId: string; replayed: boolean;
    // Never returns the internal aggregate to a Partner/browser.
    case?: PartnerCaseView; batch?: InquiryBatchResult; eventIds: readonly string[];
  }>>;
}
export interface TransactionClock {
  /** Production adapter reads database time within the owning transaction. */
  now(): Promise<string>;
}
export interface TehranWorkingCalendar {
  readonly version: string;
  addWorkingDays(instant: string, days: 3): Promise<string>;
}
export interface AccountingPartnerPort {
  enqueueCommitted(view: SabalanInternalRecordView, event: Extract<PartnerEvent, { type: 'CASE_COMMITTED' }>): Promise<Result<{ queueEvidenceId: string }>>;
}
export interface FulfillmentPartnerPort {
  inspectDependencies(view: FulfillmentView): Promise<Result<{ evidenceIds: readonly string[]; blockedProductRowIds: readonly string[] }>>;
}
export interface CustomerOutputPartnerPort {
  issue(view: CustomerContractOutput, mode: 'PREVIEW' | 'FINAL' | 'DOWNLOAD_EXISTING'): Promise<Result<{ artifactId: string; outputHash: string }>>;
}
// An internal dispatch request references immutable allowlisted evidence. No raw
// SMS body, OTP/token, phone or economic payload enters notification telemetry.
export const SafeNotificationSchema = z.object({
  schemaVersion: z.literal(1), notificationId: IdSchema, correlationId: IdSchema,
  kind: z.enum(['INQUIRY_PENDING', 'INQUIRY_DECIDED', 'APPROVAL_EXPIRING', 'RESPONDER_UNAVAILABLE', 'CUSTOMER_CONFIRMATION', 'CUSTOMER_CANCELLED']),
  recipientEvidenceId: IdSchema, projectionEvidenceId: IdSchema, notBefore: InstantSchema,
}).strict();
export type SafeNotification = z.infer<typeof SafeNotificationSchema>;
export interface NotificationGateway {
  enqueue(notification: SafeNotification): Promise<Result<{ deliveryId: string; mode: 'SANDBOX' | 'LIVE' }>>;
}
