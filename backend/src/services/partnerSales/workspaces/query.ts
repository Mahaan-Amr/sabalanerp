import {
  PartnerManagementWorkspaceViewV2Schema,
  PartnerQueryV2Schema,
  ResponderInquiryViewV2Schema,
  ResponderWorkspaceViewV2Schema,
  partnerError,
  type PartnerManagementWorkspaceViewV2,
  type PartnerQueryV2Port,
  type ResponderInquiryViewV2,
  type Result,
} from '@sabalanerp/partner-sales-contracts';

type Page = { cursor?: string; limit: number };

export interface PartnerWorkspaceQueryDependencies<Transaction> {
  actorId: string;
  transaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T>;
  /** Candidate IDs are private. The service reauthorizes and validates each
   * projected inquiry before it enters the public page. */
  listResponderInquiryIds(transaction: Transaction, page: Page): Promise<{
    inquiryIds: string[];
    hasMore?: boolean;
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
      limit: parsed.data.limit ?? 20,
    };
    return dependencies.transaction(async transaction => {
      if (parsed.data.purpose === 'PARTNER_MANAGEMENT') {
        const result = await dependencies.readManagementWorkspace(transaction, page);
        if (result.ok === false) return { ok: false, error: result.error };
        const view = PartnerManagementWorkspaceViewV2Schema.safeParse(result.value);
        return view.success ? { ok: true, value: view.data } as never
          : { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as never;
      }

      const candidates = await dependencies.listResponderInquiryIds(transaction, page);
      const inquiries: ResponderInquiryViewV2[] = [];
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
        if (inquiries.length === page.limit) {
          hasUnscannedCandidates = index < candidates.inquiryIds.length - 1;
          break;
        }
      }
      const projected = ResponderWorkspaceViewV2Schema.safeParse({
        schemaVersion: 2,
        purpose: 'RESPONDER_WORKSPACE',
        actorId: dependencies.actorId,
        inquiries,
        ...((hasUnscannedCandidates || candidates.hasMore) && scannedCursor ? { nextCursor: scannedCursor } : {}),
      });
      return projected.success ? { ok: true, value: projected.data } as never
        : { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as never;
    });
  } };
}
