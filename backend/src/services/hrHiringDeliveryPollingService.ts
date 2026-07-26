import type { PrismaClient } from '@prisma/client';
import hrHiringSmsGateway from './hrHiringSmsGateway';

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
    await prisma.hrCandidateInvitation.update({
      where: { id: invitation.id },
      data: {
        providerDeliveryState: state,
        providerDeliveryAt: report.deliveryDateTime ? new Date(report.deliveryDateTime * 1000) : null,
        providerLastCheckedAt: now
      }
    });
    if (state === 'FAILED' && invitation.providerDeliveryState !== 'FAILED') {
      const recipients = await prisma.hrHiringAuthority.findMany({
        where: { authority: { in: ['HR_PROCESSOR', 'HR_MANAGER'] }, isActive: true },
        select: { userId: true },
        distinct: ['userId']
      });
      if (recipients.length) await prisma.securityNotification.createMany({
        data: recipients.map(({ userId }) => ({
          userId,
          type: 'HIRING_INVITATION_SMS_FAILED',
          title: 'عدم تحویل پیامک دعوت استخدام',
          message: 'SMS.ir عدم تحویل پیامک دعوت متقاضی را گزارش کرده است.',
          referenceId: invitation.applicationId
        }))
      });
    }
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
    await prisma.$transaction([
      ...(recipients.length ? [prisma.securityNotification.createMany({ data: recipients.map(({ userId }) => ({
        userId, type: 'HIRING_CHECKLIST_OVERDUE', title: 'پیگیری الزام معوق جذب',
        message: `الزام «${item.title}» برای ${item.application.candidate.firstName} ${item.application.candidate.lastName} در جایگاه ${item.application.position.title} معوق شده است.`,
        referenceId: item.applicationId
      })) })] : []),
      prisma.hrPreIdentityChecklistItem.update({ where: { id: item.id }, data: { overdueNotifiedAt: now } })
    ]);
  }
  return { notified: items.length };
};

export const startHiringInvitationDeliveryPolling = (prisma: PrismaClient) => {
  const run = () => Promise.all([
    pollHiringInvitationDelivery(prisma),
    notifyOverduePreIdentityChecklist(prisma)
  ]).catch((error) => console.error('HR hiring background polling failed:', error));
  run();
  const timer = setInterval(run, POLL_INTERVAL_MS);
  timer.unref();
};
