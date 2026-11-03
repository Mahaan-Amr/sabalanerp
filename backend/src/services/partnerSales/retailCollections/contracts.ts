import * as contracts from '@sabalanerp/partner-sales-contracts';

export { contracts };
export type {
  IdempotencyIdentity, Money, PartnerCommand, PartnerErrorCode, PartnerEvent,
  PermissionContext, Result, RevisionRef,
} from '@sabalanerp/partner-sales-contracts';
import type { PartnerCaseView } from '@sabalanerp/partner-sales-contracts';
export type PaymentPlan = PartnerCaseView['customerPaymentPlan'];
