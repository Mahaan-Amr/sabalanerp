import type { Prisma, PrismaClient } from '@prisma/client';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { FEATURES } from '../../../middleware/feature';

export async function transferDecisionRecipients(tx: Prisma.TransactionClient, transferId: string, correlationId: string) {
  const transfer = await tx.partnerCustomerTransfer.findUnique({ where: { id: transferId }, select: { customerId: true } });
  if (!transfer) return [];
  // Candidate discovery is cheap; current scoped authorization below remains decisive.
  const [direct, roles, scoped, candidates] = await Promise.all([
    tx.featurePermission.findMany({ where: { feature: FEATURES.CRM_PARTNER_CUSTOMER_TRANSFERS_MANAGE, isActive: true }, select: { userId: true } }),
    tx.roleFeaturePermission.findMany({ where: { feature: FEATURES.CRM_PARTNER_CUSTOMER_TRANSFERS_MANAGE, isActive: true }, select: { role: true } }),
    tx.effectiveActionGrant.findMany({ where: { domain: 'PARTNER', action: 'CUSTOMER_TRANSFER_DECIDE', revokedAt: null }, select: { principalKind: true, principalId: true } }),
    tx.user.findMany({ where: { isActive: true, partnerProfile: null }, select: { id: true, role: true, departmentId: true } }),
  ]);
  const users = candidates.filter(user => user.role === 'ADMIN' || direct.some(grant => grant.userId === user.id)
    || roles.some(grant => grant.role === user.role) || scoped.some(grant =>
      grant.principalKind === 'USER' && grant.principalId === user.id
      || grant.principalKind === 'ROLE' && grant.principalId === user.role
      || grant.principalKind === 'DEPARTMENT' && grant.principalId === user.departmentId));
  const recipients: string[] = [];
  for (const user of users) {
    const access = await createAuditedPartnerAuthorization(tx, { actorId: user.id, purpose: 'CRM', channel: 'NOTIFICATION' },
      { correlationId, reason: 'Resolve current transfer decision notification recipients.' }, { customerTransferId: transferId })
      .authorize('CUSTOMER_TRANSFER_DECIDE', { kind: 'CUSTOMER', id: transfer.customerId });
    if (access.ok) recipients.push(user.id);
  }
  return recipients;
}

export async function canReadTransferNotice(database: PrismaClient | Prisma.TransactionClient, actorId: string, transferId: string) {
  const check = async (tx: Prisma.TransactionClient) => {
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: { isActive: true } });
    if (!actor?.isActive) return false;
    const transfer = await tx.partnerCustomerTransfer.findUnique({ where: { id: transferId }, select: {
      customerId: true, fromOwnerUserId: true, requestedBy: true, toProfile: { select: { userId: true } },
    } });
    if (!transfer) return false;
    if ([transfer.fromOwnerUserId, transfer.requestedBy, transfer.toProfile.userId].includes(actorId)) return true;
    const access = await createAuditedPartnerAuthorization(tx, { actorId, purpose: 'CRM', channel: 'NOTIFICATION' },
      { correlationId: `transfer-status:${transferId}`, reason: 'Project current transfer status visibility; commands require a separate actor reason.' }, { customerTransferId: transferId })
      .authorize('CUSTOMER_TRANSFER_DECIDE', { kind: 'CUSTOMER', id: transfer.customerId });
    return access.ok && access.value.persona === 'INTERNAL';
  };
  return '$transaction' in database ? database.$transaction(check) : check(database);
}
