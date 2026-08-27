import type * as Foundation from '../../../../../packages/partner-sales-contracts';

// #334 injects public runtime exports when installing/packaging the dependency.
export type ContractRuntime = Pick<typeof Foundation,
  'PartnerActionSchema' | 'PartnerCommandSchema' | 'PermissionContextSchema' | 'PartnerEventSchema'
  | 'IdSchema' | 'RevisionSchema' | 'InstantSchema' | 'PersianReasonSchema' | 'canonicalHash'
  | 'canonicalJson' | 'checkPartnerDomainRestrictions' | 'partnerError' | 'publicError'>;
export type PermissionContext = Foundation.PermissionContext;
export type PartnerAction = Foundation.PartnerAction;
export type PartnerCommand = Foundation.PartnerCommand;
export type PauseCommand = Extract<PartnerCommand, { type: 'OPERATIONS_PAUSE' }>;
export type Result<T> = Foundation.Result<T>;
export type ErrorCode = Foundation.PartnerErrorCode;
export type CaseState = Foundation.CaseState;

export interface OperationsState {
  revision: number;
  enrollmentPaused: boolean;
  operationalPaused: boolean;
  lastOperationalPauseAt?: string;
  cohort: { id: string; name: string; sellerIds: string[] } | null;
}

export class OperationsError extends Error {
  constructor(readonly code: ErrorCode) { super(code); }
}
