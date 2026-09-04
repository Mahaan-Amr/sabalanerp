import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { resolveNarrowFeatureAccess } from '../narrowFeatureAccess';
import { createAuditedPartnerAuthorization } from '../partnerSales/authorization/audited';
import type { DispatchDocumentAccessPolicy } from './ports';

export function createPrismaDispatchDocumentAccessPolicy(prisma: PrismaClient): DispatchDocumentAccessPolicy {
  const accountingActor = async (actorId: string) => {
    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: {
      id: true, role: true, isActive: true, partnerProfile: { select: { id: true } } } });
    if (!actor?.isActive) return null;
    const access = await resolveNarrowFeatureAccess(prisma, { userId: actor.id, role: actor.role,
      workspace: 'accounting', feature: 'accounting_dispatch_candidates_view', requiredPermission: 'view' });
    return access.allowed ? actor : null;
  };
  const partnerAccountingRead = (actorId: string, caseId: string) => prisma.$transaction(async tx =>
    (await createAuditedPartnerAuthorization(tx, { actorId, purpose: 'ACCOUNTING', channel: 'API' }, {
      correlationId: randomUUID(), reason: 'بررسی دسترسی سند داخلی ارسال پرونده همکار',
    }).authorize('ACCOUNTING_READ', { kind: 'CASE', id: caseId })).ok);
  return {
    canReadWaybill: async ({ actorId }) => Boolean(await accountingActor(actorId)),
    canReadCandidate: async ({ actorId }) => Boolean(await accountingActor(actorId)),
    async canReadDocuments({ actorId, candidateId, waybillId, kinds }) {
      const actor = await accountingActor(actorId);
      if (!actor || !kinds.length || (!candidateId && !waybillId)) return false;
      const candidate = await prisma.accountingDispatchCandidate.findFirst({ where: {
        ...(candidateId ? { id: candidateId } : {}),
        ...(waybillId ? { waybills: { some: { id: waybillId } } } : {}),
      }, select: { allocationRevision: { select: { sourceKind: true, partnerCaseId: true } } } });
      if (!candidate) return false;
      if (candidate.allocationRevision.sourceKind === 'SALES_CONTRACT') return true;
      if (candidate.allocationRevision.sourceKind !== 'PARTNER_CASE') return false;
      // A Partner profile cannot regain internal wholesale-document access via
      // an inherited or residual Accounting grant. Ordinary access is unchanged.
      if (kinds.every(kind => kind === 'WAYBILL')) return true;
      return !actor.partnerProfile && Boolean(candidate.allocationRevision.partnerCaseId)
        && partnerAccountingRead(actor.id, candidate.allocationRevision.partnerCaseId!);
    },
  };
}
