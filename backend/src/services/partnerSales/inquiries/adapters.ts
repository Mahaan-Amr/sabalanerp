import type { Prisma } from '@prisma/client';
import { canonicalHash, partnerError, type Result } from '@sabalanerp/partner-sales-contracts';
import { randomUUID } from 'node:crypto';
import { resolveScopedActions } from '../../effectiveAccessService';
import { decodeTechnicalSavedSnapshot } from '../cases/technicalSavedRecords';
import type { PartnerInquiryDependencies } from './service';

/** Reads the latest append-only profile assignment. Historical eligibility is
 * evidence of the selection, not current authority; the inquiry aggregate
 * independently rechecks the responder User before creating an assignment. */
export const resolveProfileResponder: PartnerInquiryDependencies['resolveInitialResponder'] = async (tx, input) => {
  const assignment = await tx.partnerProfileResponderAssignment.findFirst({ where: { profileId: input.profileId },
    orderBy: { revision: 'desc' }, select: { id: true, revision: true, responderId: true,
      actorId: true, eligibilityEvidence: true } });
  if (!assignment || !assignment.eligibilityEvidence || Array.isArray(assignment.eligibilityEvidence) ||
      typeof assignment.eligibilityEvidence !== 'object') return { ok: false, error: partnerError('NOT_ASSIGNED') };
  const current = await resolveEligibleResponder(tx, { responderId: assignment.responderId });
  if (!current.ok) return current;
  return { ok: true, value: { responderId: assignment.responderId, profileAssignmentId: assignment.id,
    profileAssignmentRevision: assignment.revision, assignedByActorId: assignment.actorId,
    eligibilityEvidence: { ...(assignment.eligibilityEvidence as Prisma.JsonObject),
      currentEligibility: current.value.eligibilityEvidence } } };
};

export const resolveEligibleResponder: NonNullable<PartnerInquiryDependencies['resolveResponder']> = async (tx, input) => {
  const user = await tx.user.findUnique({ where: { id: input.responderId }, select: {
    isActive: true, partnerProfile: { select: { id: true } }, role: true,
  } });
  if (!user?.isActive || user.partnerProfile) return { ok: false, error: partnerError('NOT_ASSIGNED') };
  const authority = await resolveScopedActions(tx, input.responderId, 'PARTNER');
  const grant = authority.grants.find(candidate => candidate.action === 'INQUIRY_RESPOND' &&
    candidate.rootKind === 'INQUIRY' && candidate.purpose === 'RESPONDER' && candidate.scope === 'ASSIGNED');
  if (user.role !== 'ADMIN' && !grant) return { ok: false, error: partnerError('NOT_ASSIGNED') };
  return { ok: true, value: { responderId: input.responderId,
    eligibilityEvidence: { version: 1, source: 'CURRENT_RESPONDER_AUTHORITY', role: user.role,
      authorizationRevision: authority.authorizationRevision,
      ...(grant?.provenance ? { grantId: grant.provenance.grantId, grantVersion: grant.provenance.version } : {}) } } };
};

/** Creates one idempotent ordinary support ticket for a profile that cannot
 * submit because its configured responder is absent or no longer authorized. */
export const ensureMissingResponderSupport: NonNullable<PartnerInquiryDependencies['ensureMissingResponderSupport']> = async (tx, input) => {
  const profile = await tx.partnerProfile.findUnique({ where: { id: input.profileId }, select: { revision: true,
    responderAssignments: { orderBy: { revision: 'desc' }, take: 1, select: { revision: true } } } });
  if (!profile) return { ok: false, error: partnerError('NOT_FOUND') };
  const assignmentRevision = profile.responderAssignments[0]?.revision ?? 0;
  const key = await canonicalHash({ schemaVersion: 1, purpose: 'PARTNER_RESPONDER_UNAVAILABLE',
    profileId: input.profileId, profileRevision: profile.revision, assignmentRevision });
  const existing = await tx.supportTicket.findUnique({ where: { idempotencyKey: key }, select: { id: true, referenceCode: true } });
  if (existing) return { ok: true, value: existing };
  const handlers = await tx.user.findMany({ where: { role: 'ADMIN', isActive: true, partnerProfile: null },
    select: { id: true }, orderBy: { id: 'asc' } });
  if (!handlers.length) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const ticket = await tx.supportTicket.create({ data: { idempotencyKey: key, reporterId: input.reporterId,
    referenceCode: `SUP-${clock.now.toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 12).toUpperCase()}`,
    title: 'تعیین پاسخ‌دهنده قیمت فروشنده همکار', type: 'ACCESS_PROBLEM', impact: 'BLOCKED', workaroundExists: false,
    reportedWorkspace: 'sales', originRoute: '/dashboard/sales/partner-inquiries', suggestedPriority: 'HIGH',
    diagnosticSnapshot: { source: 'PARTNER_RESPONDER_UNAVAILABLE', profileId: input.profileId,
      profileRevision: profile.revision, assignmentRevision },
    effectiveAccessSnapshot: { source: 'PARTNER_CENTRAL_AUTHORIZATION', capturedAt: clock.now.toISOString() },
    entries: { create: { kind: 'REPORT', body: 'برای حساب فروشنده همکار، پاسخ‌دهنده قیمت فعال و مجاز تعیین نشده است.' } },
    participants: { create: handlers.map(handler => ({ userId: handler.id, role: 'HANDLER' })) },
    auditEvents: { create: { action: 'CREATED', afterData: { cause: 'RESPONDER_UNAVAILABLE', trackingKey: key } } },
  }, select: { id: true, referenceCode: true } });
  return { ok: true, value: ticket };
};

const familyLabels: Record<string, string> = {
  longitudinal: 'طولی', stair: 'پله', slab: 'اسلب', prepared: 'آماده', volumetric: 'حجمی',
};

/** Resolves an opaque saved reference from the protected recovery journal. The
 * returned public display is rebuilt from its frozen safe catalog projection;
 * private rates, graph context and pricing hashes never leave this adapter. */
export const resolveSavedTechnicalConfiguration: PartnerInquiryDependencies['resolveConfiguration'] = async (tx, input) => {
  const session = await tx.salesContractEditSession.findUnique({ where: { draftId: input.reference.recoveryId },
    select: { ownerUserId: true, recovery: true } });
  if (!session || session.ownerUserId !== input.actorId || !session.recovery || Array.isArray(session.recovery) ||
      typeof session.recovery !== 'object') return { ok: false, error: partnerError('NOT_FOUND') };
  const history = (session.recovery as Record<string, unknown>).validatedSnapshots;
  if (!Array.isArray(history)) return { ok: false, error: partnerError('NOT_FOUND') };
  for (const record of history) {
    const snapshot = await decodeTechnicalSavedSnapshot(record);
    if (!snapshot || snapshot.view.recoveryRevision !== input.reference.recoveryRevision) continue;
    const saved = snapshot.view.rows.find(row => row.configurationRef.productRowId === input.reference.productRowId);
    const identity = snapshot.identities.find(row => row.productRowId === input.reference.productRowId)?.identity;
    const graphRow = snapshot.graph.rows.find(row => row.productRowId === input.reference.productRowId);
    const context = snapshot.context as { catalog?: { products?: Array<{ catalogItemId?: unknown; name?: unknown; code?: unknown }> } };
    const product = context.catalog?.products?.find(row => row.catalogItemId === identity?.catalogProductId);
    if (!saved || !identity || !graphRow || saved.configurationRef.recoveryId !== input.reference.recoveryId ||
        saved.configurationRef.recoveryRevision !== input.reference.recoveryRevision || typeof product?.name !== 'string' ||
        typeof product.code !== 'string') return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    return { ok: true, value: { identity, description: product.name,
      configuration: [{ label: 'خانواده محصول', value: familyLabels[identity.family] ?? identity.family },
        { label: 'کد محصول', value: product.code }] } };
  }
  return { ok: false, error: partnerError('NOT_FOUND') };
};
