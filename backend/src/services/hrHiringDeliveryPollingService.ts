import type { PrismaClient } from '@prisma/client';
import hrHiringSmsGateway from './hrHiringSmsGateway';
import { getRecoveryRuntimeState } from './recoveryRuntime';
import { publishNotificationEvent } from './notificationService';

const POLL_INTERVAL_MS = 5 * 60_000;
const REPORT_WINDOW_MS = 24 * 60 * 60_000;

export const mapSmsIrDeliveryState = (deliveryState?: number | null) =>
  deliveryState === 1
    ? 'DELIVERED'
    : [2, 3].includes(Number(deliveryState))
      ? 'FAILED'
      : 'ACCEPTED';

export const pollHiringInvitationDelivery = async (prisma: PrismaClient, now = new Date()) => {
  const rows = await prisma.hrCandidateInvitation.findMany({
    where: {
      providerMessageId: { not: null },
      providerDeliveryState: { notIn: ['DELIVERED', 'FAILED'] },
      accessConfirmedAt: null,
      createdAt: { gte: new Date(now.getTime() - REPORT_WINDOW_MS) },
      OR: [
        { providerLastCheckedAt: null },
        { providerLastCheckedAt: { lte: new Date(now.getTime() - POLL_INTERVAL_MS) } }
      ]
    },
    take: 100,
    orderBy: { createdAt: 'asc' }
  });
  let updated = 0;
  for (const invitation of rows) {
    const report = await hrHiringSmsGateway.getDeliveryReport(Number(invitation.providerMessageId));
    const state = report.success ? mapSmsIrDeliveryState(report.deliveryState) : 'UNKNOWN';
    await prisma.$transaction(async (tx) => {
      await tx.hrCandidateInvitation.update({
        where: { id: invitation.id },
        data: {
          providerDeliveryState: state,
          providerDeliveryAt: report.deliveryDateTime ? new Date(report.deliveryDateTime * 1000) : null,
          providerLastCheckedAt: now
        }
      });
      if (state === 'FAILED' && invitation.providerDeliveryState !== 'FAILED') {
        const recipients = await tx.hrHiringAuthority.findMany({
          where: { authority: { in: ['HR_PROCESSOR', 'HR_MANAGER'] }, isActive: true },
          select: { userId: true },
          distinct: ['userId']
        });
        if (recipients.length) await publishNotificationEvent(tx, {
          type: 'HIRING_INVITATION_SMS_FAILED',
          deduplicationKey: `hiring-invitation-sms-failed:${invitation.id}`,
          recipientIds: recipients.map(({ userId }) => userId),
          workspace: 'hr',
          feature: 'hr_hiring',
          resourceType: 'HrJobApplication',
          resourceId: invitation.applicationId,
          referenceId: invitation.applicationId,
          actionUrl: `/dashboard/hr/hiring/${invitation.applicationId}`,
        });
      }
    });
    updated += 1;
  }
  return { checked: rows.length, updated };
};

export const notifyOverduePreIdentityChecklist = async (prisma: PrismaClient, now = new Date()) => {
  const items = await prisma.hrPreIdentityChecklistItem.findMany({
    where: {
      dueAt: { lt: now }, overdueNotifiedAt: null, status: { in: ['PENDING', 'IN_PROGRESS'] },
      application: { stage: { not: 'CLOSED' }, disposition: null }
    },
    include: { application: { include: { candidate: true, position: true } } },
    take: 100,
    orderBy: { dueAt: 'asc' }
  });
  if (!items.length) return { notified: 0 };
  const recipients = await prisma.hrHiringAuthority.findMany({
    where: { authority: { in: ['HR_PROCESSOR', 'HR_MANAGER'] }, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    select: { userId: true }, distinct: ['userId']
  });
  for (const item of items) {
    await prisma.$transaction(async (tx) => {
      if (recipients.length) await publishNotificationEvent(tx, {
        type: 'HIRING_CHECKLIST_OVERDUE',
        deduplicationKey: `hiring-checklist-overdue:${item.id}`,
        recipientIds: recipients.map(({ userId }) => userId),
        workspace: 'hr',
        feature: 'hr_hiring',
        resourceType: 'HrJobApplication',
        resourceId: item.applicationId,
        referenceId: item.applicationId,
        actionUrl: `/dashboard/hr/hiring/${item.applicationId}`,
        payload: {
          itemTitle: item.title,
          candidateName: `${item.application.candidate.firstName} ${item.application.candidate.lastName}`,
          positionTitle: item.application.position.title,
        },
      });
      await tx.hrPreIdentityChecklistItem.update({ where: { id: item.id }, data: { overdueNotifiedAt: now } });
    });
  }
  return { notified: items.length };
};

export const startHiringInvitationDeliveryPolling = (prisma: PrismaClient) => {
  const run = () => {
    if (getRecoveryRuntimeState().mode !== 'NORMAL') return Promise.resolve();
    return Promise.all([
      pollHiringInvitationDelivery(prisma),
      notifyOverduePreIdentityChecklist(prisma)
    ]).then(() => undefined).catch((error) => console.error('HR hiring background polling failed:', error));
  };
  run();
  const timer = setInterval(run, POLL_INTERVAL_MS);
  timer.unref();
};
