import type * as Foundation from '../../../../../packages/partner-sales-contracts';

// Type-only public package entry point. #334 owns runtime package installation
// and injects its public exports when composing the existing confirmation flow.
export type Output = Foundation.CustomerContractOutput;
export type Snapshot = ReturnType<typeof Foundation.CustomerOutputSnapshotSchema.parse>;
export type Revision = Foundation.RevisionRef;
export type Result<T> = Foundation.Result<T>;
export type OutputPort = Foundation.CustomerOutputPartnerPort;
export type Notification = Foundation.SafeNotification;
export type ContractRuntime = Pick<typeof Foundation,
  'CustomerContractOutputSchema' | 'CustomerOutputSnapshotSchema' | 'RevisionRefSchema'
  | 'InstantSchema' | 'IdSchema' | 'SafeNotificationSchema' | 'canonicalHash' | 'canonicalJson'
  | 'checkExpectedRevision' | 'partnerError'>;

export type BusinessIdentity = {
  tradeName?: string | null;
  legalName: string;
  businessPhone: string;
  businessAddress: string;
};

export type CurrentOutput = {
  owner: Revision;
  contractNumber: string;
  normalizedRecipient: string;
  state: Foundation.CaseState;
};

export const SUPPLY_CREDIT = 'تأمین و تحویل توسط سبلان';

export class CustomerOutputError extends Error {
  constructor(readonly code: Foundation.PartnerErrorCode) {
    super(code);
  }
}

export function requireValue<T>(result: Result<T>): T {
  if (!result.ok) throw new CustomerOutputError(result.error.code);
  return result.value;
}
