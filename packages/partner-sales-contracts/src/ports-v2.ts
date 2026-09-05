import { z } from 'zod';
import { Result } from './errors';
import { PartnerInquiryViewV2 } from './inquiry-v2';
import { IdSchema } from './primitives';
import { PartnerManagementWorkspaceViewV2, ResponderInquiryViewV2, ResponderWorkspaceViewV2 } from './workspaces-v2';

const page = { cursor: IdSchema.optional(), limit: z.number().int().min(1).max(100).optional() };
export const PartnerQueryV2Schema = z.discriminatedUnion('purpose', [
  z.object({ schemaVersion: z.literal(2), purpose: z.literal('PARTNER_INQUIRY'), inquiryId: IdSchema }).strict(),
  z.object({ schemaVersion: z.literal(2), purpose: z.literal('RESPONDER_INQUIRY'), inquiryId: IdSchema }).strict(),
  z.object({ schemaVersion: z.literal(2), purpose: z.literal('PARTNER_MANAGEMENT'), ...page }).strict(),
  z.object({ schemaVersion: z.literal(2), purpose: z.literal('RESPONDER_WORKSPACE'), ...page }).strict(),
]);
export type PartnerQueryV2 = z.infer<typeof PartnerQueryV2Schema>;
export interface PartnerQueryV2Results {
  PARTNER_INQUIRY: PartnerInquiryViewV2;
  RESPONDER_INQUIRY: ResponderInquiryViewV2;
  PARTNER_MANAGEMENT: PartnerManagementWorkspaceViewV2;
  RESPONDER_WORKSPACE: ResponderWorkspaceViewV2;
}
export interface PartnerQueryV2Port {
  /** Authenticated adapter filters every row/section/action before pagination.
   * Actor, scope and grants are server-bound; IDs/cursors do not grant access.
   * Unsupported v2 purposes fail closed, never fall back to a broader v1 view.
   */
  query<P extends PartnerQueryV2['purpose']>(query: Extract<PartnerQueryV2, { purpose: P }>): Promise<Result<PartnerQueryV2Results[P]>>;
}
