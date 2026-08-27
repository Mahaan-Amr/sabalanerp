import { Result, partnerError } from '../errors';
import { PartnerInquiryViewV2Schema } from '../inquiry-v2';
import { PartnerQueryV2, PartnerQueryV2Port, PartnerQueryV2Results, PartnerQueryV2Schema } from '../ports-v2';
import { PartnerManagementWorkspaceViewV2Schema, ResponderInquiryViewV2Schema, ResponderWorkspaceViewV2Schema } from '../workspaces-v2';
import { createPartnerFixtures } from './fixtures';

/** Synthetic display/evidence references only. No mutation, registration or readiness authority. */
export function createPartnerWorkspaceFixturesV2() {
  const v1 = createPartnerFixtures();
  const inquiry = PartnerInquiryViewV2Schema.parse({ ...v1.inquiry, schemaVersion: 2,
    rows: v1.inquiry.rows.map(row => ({ ...row, configurationRef: v1.configurationDraft,
      successor: { inquiryId: 'fixture-v2-successor-inquiry', rowId: 'fixture-v2-successor-row', revision: 1, state: 'PENDING' },
    })),
  });
  const responder = ResponderInquiryViewV2Schema.parse({ ...v1.responder, schemaVersion: 2, actions: [],
    rows: [
      ...v1.responder.rows.map(row => ({ ...row, state: 'APPROVED', approvedAt: v1.approval.approvedAt,
        expiresAt: v1.approval.expiresAt, actions: [] })),
      { rowId: 'fixture-v2-pending-row', revision: 1, identity: v1.responder.rows[0].identity, used: false,
        state: 'PENDING', actions: [{ action: 'INQUIRY_RESPOND', enabled: true }] },
    ],
  });
  const management = PartnerManagementWorkspaceViewV2Schema.parse({
    schemaVersion: 2, purpose: 'PARTNER_MANAGEMENT', actorId: 'fixture-v2-manager', personaLabel: 'مدیر آزمایشی',
    actions: [{ action: 'PROFILE_CREATE', enabled: true }],
    identityCandidates: [{ identityEvidenceId: 'fixture-v2-identity-candidate', displayName: 'هویت آزمایشی جدید' }],
    profiles: [{ profile: v1.profile, displayName: 'همکار آزمایشی', actions: [
      { action: 'IDENTITY_VERIFY', enabled: true }, { action: 'COMMERCIAL_TERMS_MANAGE', enabled: true },
      { action: 'CREDIT_TERMS_MANAGE', enabled: true }, { action: 'RESPONDER_REASSIGN', enabled: true },
      { action: 'PROFILE_CONVERSION_MANAGE', enabled: true },
      { action: 'PROFILE_ACTIVATE', enabled: false, disabledReason: partnerError('COHORT_NOT_READY') },
    ], identity: { evidenceId: 'fixture-v2-profile-identity', legalName: 'همکار آزمایشی', phone: '09120000000',
      address: 'نشانی آزمایشی تهران', personType: 'NATURAL' },
    commercialTerms: { summary: 'شرایط تجاری آزمایشی', options: [{ id: 'fixture-v2-commercial-terms', label: 'نسخه آزمایشی شرایط تجاری' }] },
    creditTerms: { summary: 'شرایط اعتبار آزمایشی', options: [{ id: 'fixture-v2-credit-terms', label: 'نسخه آزمایشی شرایط اعتبار' }] },
    responder: { currentId: 'fixture-313-responder', displayName: 'پاسخ‌دهنده آزمایشی',
      eligibleOptions: [{ id: 'fixture-v2-eligible-responder', label: 'پاسخ‌دهنده واجد شرایط آزمایشی' }],
      pendingInquiries: [{ inquiryId: responder.inquiryId, assignmentRevision: responder.assignmentRevision,
        label: 'استعلام دارای ردیف در انتظار', actions: [{ action: 'RESPONDER_REASSIGN', enabled: true }] }],
    },
    conversion: { started: true, irreversible: false, blockers: [{ id: 'fixture-v2-open-work', label: 'تعیین تکلیف کار باز' }],
      dispositionEvidenceIds: ['fixture-v2-disposition'] },
    }], transfers: [],
  });
  const responderWorkspace = ResponderWorkspaceViewV2Schema.parse({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE',
    actorId: 'fixture-313-responder', inquiries: [responder] });
  return { inquiry, responder, management, responderWorkspace };
}

/** Explicit purpose selection models a fixture consumer, never production authorization. */
export class FixturePartnerQueryV2Adapter implements PartnerQueryV2Port {
  private readonly fixtures = createPartnerWorkspaceFixturesV2();
  private readonly allowed: ReadonlySet<PartnerQueryV2['purpose']>;
  constructor(purposes: readonly PartnerQueryV2['purpose'][]) { this.allowed = new Set(purposes); }
  async query<P extends PartnerQueryV2['purpose']>(input: Extract<PartnerQueryV2, { purpose: P }>): Promise<Result<PartnerQueryV2Results[P]>> {
    const parsed = PartnerQueryV2Schema.safeParse(input);
    if (!parsed.success) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    const query = parsed.data;
    if (!this.allowed.has(query.purpose)) return { ok: false, error: partnerError('NOT_FOUND') };
    if ('inquiryId' in query && query.inquiryId !== this.fixtures.inquiry.inquiryId) return { ok: false, error: partnerError('NOT_FOUND') };
    // The fixture has one page. Do not silently accept an arbitrary stale/forged cursor.
    if ('cursor' in query && query.cursor) return { ok: false, error: partnerError('ROW_STALE') };
    const views: PartnerQueryV2Results = { PARTNER_INQUIRY: this.fixtures.inquiry, RESPONDER_INQUIRY: this.fixtures.responder,
      PARTNER_MANAGEMENT: this.fixtures.management, RESPONDER_WORKSPACE: this.fixtures.responderWorkspace };
    return { ok: true, value: structuredClone(views[query.purpose]) as PartnerQueryV2Results[P] };
  }
}
