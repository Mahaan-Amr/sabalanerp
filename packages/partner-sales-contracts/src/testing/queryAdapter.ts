import { PartnerQuery, PartnerQueryPort, PartnerQueryResults, PartnerQuerySchema } from '../ports';
import { Result, checkExpectedRevision, partnerError } from '../errors';
import { createPartnerFixtures } from './fixtures';

/** Read-only fixture adapter, intentionally incapable of activation or mutation.
 * An explicit purpose list models a consumer, NOT production authorization.
 */
export class FixturePartnerQueryAdapter implements PartnerQueryPort {
  private readonly fixtures = createPartnerFixtures();
  private readonly allowed: ReadonlySet<PartnerQuery['purpose']>;
  constructor(purposes: readonly PartnerQuery['purpose'][]) { this.allowed = new Set(purposes); }
  async query<P extends PartnerQuery['purpose']>(input: Extract<PartnerQuery, { purpose: P }>): Promise<Result<PartnerQueryResults[P]>> {
    const parsed = PartnerQuerySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    const query = parsed.data;
    if (!this.allowed.has(query.purpose)) return { ok: false, error: partnerError('NOT_FOUND') };
    if ('expected' in query) {
      const conflict = checkExpectedRevision(query.expected, this.fixtures.case.head);
      if (conflict) return { ok: false, error: conflict };
    }
    const views: PartnerQueryResults = { PARTNER_CASE: this.fixtures.partner, ACCOUNTING: this.fixtures.accounting,
      FULFILLMENT: this.fixtures.fulfillment, CUSTOMER_OUTPUT: this.fixtures.customer,
      PARTNER_ACCOUNT: this.fixtures.account, ONBOARDING: this.fixtures.profile,
      PARTNER_INQUIRY: this.fixtures.inquiry, RESPONDER_INQUIRY: this.fixtures.responder };
    if (query.purpose === 'CUSTOMER_OUTPUT' && (query.snapshotId !== 'fixture-313-snapshot' || query.outputHash !== this.fixtures.customer.outputHash)) return { ok: false, error: partnerError('NOT_FOUND') };
    if (query.purpose === 'PARTNER_ACCOUNT' && query.partnerSellerId !== this.fixtures.account.partnerSellerId) return { ok: false, error: partnerError('NOT_FOUND') };
    if (query.purpose === 'ONBOARDING' && query.profileId !== this.fixtures.profile.profileId) return { ok: false, error: partnerError('NOT_FOUND') };
    if ('inquiryId' in query && query.inquiryId !== this.fixtures.inquiry.inquiryId) return { ok: false, error: partnerError('NOT_FOUND') };
    const view = views[query.purpose];
    if (!view) return { ok: false, error: partnerError('NOT_FOUND') };
    return { ok: true, value: structuredClone(view) as PartnerQueryResults[P] };
  }
}
