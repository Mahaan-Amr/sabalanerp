import type { RequestEvidenceMeta, SendConfirmationResult } from '../../contractConfirmationService';
import type { Output } from './contracts';

type Meta = { meta?: RequestEvidenceMeta };
type Lookup = Meta & { contractNumber: string; phoneNumber: string };
type Token = Meta & { token: string };
type Response<T> = { success: boolean; error?: string; data?: T };
export type PublicCustomerConfirmation = {
  contract: Output; verifiedAt: string | null; linkExpiresAt: string;
  readOnly: boolean; banner: 'CANCELLED' | 'SUPERSEDED' | null;
};

/** #334 binds these hooks to the explicit persisted PARTNER_CUSTOMER kind and
 * the existing principal/session resolver. Return undefined ONLY for a known
 * ordinary contract. Missing, denied, stale or unsupported Partner evidence must
 * return a safe failure, never fall through to ordinary relation serialization.
 * No runtime registration is enabled until schema, Case and policy ports land. */
export interface PartnerConfirmationHooks {
  sendForConfirmation(input: Meta & { contractId: string; requestedBy: string; resend?: boolean; explicitToken?: string }): Promise<SendConfirmationResult | undefined>;
  getPublicContractByToken(token: string, meta?: RequestEvidenceMeta): Promise<Response<PublicCustomerConfirmation> | undefined>;
  getPublicContractByManualLookup(input: Lookup): Promise<Response<PublicCustomerConfirmation> | undefined>;
  verifyPublicOtp(input: Token & { code: string }): Promise<Response<{ status: string; verifiedAt?: string }> | undefined>;
  verifyPublicOtpByManualLookup(input: Lookup & { code: string }): Promise<Response<{ status: string; verifiedAt?: string }> | undefined>;
  resendFromPublicToken(input: Token): Promise<SendConfirmationResult | undefined>;
  resendFromManualLookup(input: Lookup): Promise<SendConfirmationResult | undefined>;
  cancelContract(input: Meta & { contractId: string; requestedBy: string; canCancelApproved: boolean }): Promise<Response<{ contractId: string; status: string }> | undefined>;
}
