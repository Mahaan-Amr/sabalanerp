import type { Prisma } from '@prisma/client';
import { partnerError, type Result } from '@sabalanerp/partner-sales-contracts';
import { decodeTechnicalSavedSnapshot } from '../cases/technicalSavedRecords';
import type { PartnerInquiryDependencies } from './service';

/** Reads the latest append-only profile assignment. Historical eligibility is
 * evidence of the selection, not current authority; the inquiry aggregate
 * independently rechecks the responder User before creating an assignment. */
export const resolveProfileResponder: PartnerInquiryDependencies['resolveInitialResponder'] = async (tx, input) => {
  const assignment = await tx.partnerProfileResponderAssignment.findFirst({ where: { profileId: input.profileId },
    orderBy: { revision: 'desc' }, select: { responderId: true, eligibilityEvidence: true } });
  if (!assignment || !assignment.eligibilityEvidence || Array.isArray(assignment.eligibilityEvidence) ||
      typeof assignment.eligibilityEvidence !== 'object') return { ok: false, error: partnerError('NOT_ASSIGNED') };
  return { ok: true, value: { responderId: assignment.responderId,
    eligibilityEvidence: assignment.eligibilityEvidence as Prisma.JsonObject } };
};

export const resolveEligibleResponder: NonNullable<PartnerInquiryDependencies['resolveResponder']> = async (tx, input) => {
  const user = await tx.user.findUnique({ where: { id: input.responderId }, select: {
    isActive: true, partnerProfile: { select: { id: true } }, role: true,
  } });
  if (!user?.isActive || user.partnerProfile) return { ok: false, error: partnerError('NOT_ASSIGNED') };
  return { ok: true, value: { responderId: input.responderId,
    eligibilityEvidence: { version: 1, source: 'CURRENT_USER_ELIGIBILITY', role: user.role } } };
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
