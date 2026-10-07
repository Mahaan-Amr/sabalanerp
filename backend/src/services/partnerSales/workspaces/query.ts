import {
  PartnerManagementWorkspaceViewV2Schema,
  PartnerQueryV2Schema,
  ResponderInquiryViewV2Schema,
  ResponderWorkspaceViewV2Schema,
  RESPONDER_CONTRACT_PAGE_SIZE,
  partnerError,
  type PartnerManagementWorkspaceViewV2,
  type PartnerQueryV2Port,
  type ResponderInquiryViewV2,
  type ResponderContractSummaryV2,
  type Result,
} from '@sabalanerp/partner-sales-contracts';

type Page = { cursor?: string; contractId?: string; summaryOnly?: boolean; limit: number; view?: 'all' | 'pending' | 'answered' | 'history'; status?: 'all' | 'approved' | 'rejected' | 'expired' | 'cancelled' | 'superseded'; section?: 'PROFILES' | 'TRANSFERS'; history?: boolean; transferStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'; search?: string; transferId?: string };

export interface PartnerWorkspaceQueryDependencies<Transaction> {
  actorId: string;
  canReadResponderWorkspace?(transaction: Transaction): Promise<boolean>;
  transaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T>;
  /** Candidate IDs are private. The service reauthorizes and validates each
   * projected inquiry before it enters the public page. */
  listResponderInquiryIds(transaction: Transaction, page: Page): Promise<{
    inquiryIds: string[];
    hasMore?: boolean;
    grouped?: boolean;
    nextCursor?: string;
    contractCounts?: { pending: number; answered: number; history: number };
    contracts?: ResponderContractSummaryV2[];
  }>;
  readResponderInquiry(transaction: Transaction, inquiryId: string): Promise<Result<ResponderInquiryViewV2>>;
  readManagementWorkspace(transaction: Transaction, page: Page): Promise<Result<PartnerManagementWorkspaceViewV2>>;
}

export function createPartnerWorkspaceQuery<Transaction>(
  dependencies: PartnerWorkspaceQueryDependencies<Transaction>,
): PartnerQueryV2Port {
  return { async query(input) {
    const parsed = PartnerQueryV2Schema.safeParse(input);
    if (!parsed.success || (parsed.data.purpose !== 'PARTNER_MANAGEMENT' &&
        parsed.data.purpose !== 'RESPONDER_WORKSPACE')) {
      return { ok: false, error: partnerError('INVALID_PAYLOAD') } as never;
    }
    const page = {
      ...(parsed.data.cursor ? { cursor: parsed.data.cursor } : {}),
      limit: parsed.data.purpose === 'RESPONDER_WORKSPACE' ? RESPONDER_CONTRACT_PAGE_SIZE : parsed.data.limit ?? 20,
      ...(parsed.data.purpose === 'RESPONDER_WORKSPACE' ? { ...(parsed.data.summaryOnly ? { summaryOnly: true } : {}), contractId: parsed.data.contractId, view: parsed.data.view ?? 'all', status: parsed.data.status ?? 'all', search: parsed.data.search } : {}),
      ...(parsed.data.purpose === 'PARTNER_MANAGEMENT' ? { section: parsed.data.section, history: parsed.data.history, transferStatus: parsed.data.transferStatus, search: parsed.data.search, transferId: parsed.data.transferId } : {}),
    };
    return dependencies.transaction(async transaction => {
      if (parsed.data.purpose === 'PARTNER_MANAGEMENT') {
        const result = await dependencies.readManagementWorkspace(transaction, page);
        if (result.ok === false) return { ok: false, error: result.error };
        const view = PartnerManagementWorkspaceViewV2Schema.safeParse(result.value);
        return view.success ? { ok: true, value: view.data } as never
          : { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as never;
      }

      if (dependencies.canReadResponderWorkspace && !await dependencies.canReadResponderWorkspace(transaction)) {
        return { ok: false, error: partnerError('FORBIDDEN') } as never;
      }
      const candidates = await dependencies.listResponderInquiryIds(transaction, page);
      if (page.summaryOnly) {
        if (!candidates.grouped || !candidates.contractCounts) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as never;
        return { ok: true, value: ResponderWorkspaceViewV2Schema.parse({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE',
          actorId: dependencies.actorId, inquiries: [], contractCounts: candidates.contractCounts }) } as never;
      }
      const inquiries: ResponderInquiryViewV2[] = [];
      if (!page.contractId && candidates.contracts) {
        const projected = ResponderWorkspaceViewV2Schema.safeParse({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE',
          actorId: dependencies.actorId, inquiries: [], contracts: candidates.contracts,
          contractCounts: candidates.contractCounts, nextCursor: candidates.nextCursor });
        return projected.success ? { ok: true, value: projected.data } as never
          : { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as never;
      }
      let scannedCursor: string | undefined;
      let hasUnscannedCandidates = false;
      for (const [index, inquiryId] of candidates.inquiryIds.entries()) {
        scannedCursor = inquiryId;
        const result = await dependencies.readResponderInquiry(transaction, inquiryId);
        if (result.ok === false) {
          if (result.error.status === 404 || result.error.code === 'NOT_ASSIGNED' || result.error.code === 'FORBIDDEN') continue;
          return result as never;
        }
        const inquiry = ResponderInquiryViewV2Schema.safeParse(result.value);
        if (!inquiry.success) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as never;
        inquiries.push(inquiry.data);
        if (!candidates.grouped && inquiries.length === page.limit) {
          hasUnscannedCandidates = index < candidates.inquiryIds.length - 1;
          break;
        }
      }
      const projected = ResponderWorkspaceViewV2Schema.safeParse({
        schemaVersion: 2,
        purpose: 'RESPONDER_WORKSPACE',
        actorId: dependencies.actorId,
        inquiries,
        ...(candidates.contractCounts ? { contractCounts: candidates.contractCounts } : {}),
        ...(candidates.grouped && candidates.nextCursor ? { nextCursor: candidates.nextCursor } : {}),
        ...(!candidates.grouped && (hasUnscannedCandidates || candidates.hasMore) && scannedCursor ? { nextCursor: scannedCursor } : {}),
      });
      return projected.success ? { ok: true, value: projected.data } as never
        : { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as never;
    });
  } };
}
