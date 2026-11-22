import { startBackgroundJob } from './backgroundJobLifecycle';
import fs from 'node:fs';
import path from 'node:path';
import { Prisma, type PrismaClient } from '@prisma/client';
import { publishNotificationEvent } from './notificationService';
import { elapsedSupportMinutes, parseSupportCalendar } from './supportSlaPolicy';
import { resolveWorkspaceRecipientIds } from './domainNotificationRecipients';
import { supportTicketStorageDirectory, removeSupportStoredFile, runOwnedSupportFileWork } from './supportFileRuntime';
import { lockSupportTicket, lockSupportStoredFile } from './supportTicketStorage';
import { removeExpiredSupportAttachment, supportRetentionPlanProtectsStagedFile } from './supportRetentionFileJournal';

const closedStatuses = ['RESOLVED', 'CLOSED'];
const day = 86_400_000;

export const runSupportTicketMaintenance = (prisma: PrismaClient, now = new Date()) => runOwnedSupportFileWork(async () => {
  const storageDir = supportTicketStorageDirectory();
  const tickets = await prisma.supportTicket.findMany({
    where: { status: { notIn: ['CLOSED'] } },
    include: {
      participants: { where: { removedAt: null } },
      auditEvents: { select: { action: true } },
    },
  });
  const adminIds = (await prisma.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } })).map((user) => user.id);

  for (const ticket of tickets) {
    const actions = new Set(ticket.auditEvents.map((event) => event.action));
    const policy = ticket.slaPolicyVersion
      ? await prisma.supportSlaPolicyVersion.findUnique({ where: { version: ticket.slaPolicyVersion } })
      : null;
    const calendar = policy ? parseSupportCalendar(policy.calendar) : null;
    const handlerIds = ticket.participants.filter((participant) => ['HANDLER', 'COLLABORATOR'].includes(participant.role)).map((participant) => participant.userId);

    if (calendar && ticket.resolutionDueAt && !closedStatuses.includes(ticket.status)) {
      if (ticket.resolutionDueAt > now) {
        const remaining = elapsedSupportMinutes(now, ticket.resolutionDueAt, calendar);
        if (remaining <= 60 && !actions.has('SLA_WARNING_SENT')) {
          const recipients = handlerIds.length ? handlerIds : adminIds;
          await prisma.$transaction(async (tx) => {
            await tx.supportTicketAuditEvent.create({ data: { ticketId: ticket.id, action: 'SLA_WARNING_SENT', afterData: { resolutionDueAt: ticket.resolutionDueAt } } });
            await publishNotificationEvent(tx, {
              type: 'SUPPORT_TICKET_SLA_WARNING',
              deduplicationKey: `support-sla-warning:${ticket.id}:${ticket.slaPolicyVersion}`,
              recipientIds: recipients,
              workspace: ticket.reportedWorkspace,
              feature: ticket.reportedFeature,
              resourceType: 'support-ticket',
              resourceId: ticket.id,
              referenceId: ticket.referenceCode,
              actionUrl: `/dashboard/support/tickets/${ticket.id}`,
              payload: { referenceCode: ticket.referenceCode },
            });
          });
        }
      } else if (!actions.has('SLA_BREACH_MANAGER')) {
        const workspaceRecipients = ticket.reportedWorkspace
          ? await resolveWorkspaceRecipientIds(prisma, ticket.reportedWorkspace, 'edit')
          : [];
        const managerRows = workspaceRecipients.length
          ? await prisma.user.findMany({ where: { id: { in: workspaceRecipients }, role: 'MANAGER', isActive: true }, select: { id: true } })
          : [];
        const recipients = managerRows.map((user) => user.id);
        await prisma.$transaction(async (tx) => {
          await tx.supportTicketAuditEvent.create({ data: { ticketId: ticket.id, action: 'SLA_BREACH_MANAGER', afterData: { resolutionDueAt: ticket.resolutionDueAt } } });
          await publishNotificationEvent(tx, {
            type: 'SUPPORT_TICKET_SLA_BREACHED',
            deduplicationKey: `support-sla-breach-manager:${ticket.id}:${ticket.slaPolicyVersion}`,
            recipientIds: recipients.length ? recipients : adminIds,
            recipientGroups: {
              WORKSPACE_MANAGERS: recipients,
              ACTIVE_ADMINS: recipients.length ? [] : adminIds,
            },
            workspace: ticket.reportedWorkspace,
            feature: ticket.reportedFeature,
            resourceType: 'support-ticket',
            resourceId: ticket.id,
            referenceId: ticket.referenceCode,
            actionUrl: `/dashboard/support/tickets/${ticket.id}`,
            payload: { referenceCode: ticket.referenceCode },
          });
        });
      } else if (!actions.has('SLA_BREACH_ADMIN') && now.getTime() - ticket.resolutionDueAt.getTime() >= day) {
        await prisma.$transaction(async (tx) => {
          await tx.supportTicketAuditEvent.create({ data: { ticketId: ticket.id, action: 'SLA_BREACH_ADMIN', afterData: { resolutionDueAt: ticket.resolutionDueAt } } });
          await publishNotificationEvent(tx, {
            type: 'SUPPORT_TICKET_SLA_BREACHED',
            deduplicationKey: `support-sla-breach-admin:${ticket.id}:${ticket.slaPolicyVersion}`,
            recipientIds: adminIds,
            recipientGroups: { ACTIVE_ADMINS: adminIds },
            workspace: ticket.reportedWorkspace,
            feature: ticket.reportedFeature,
            resourceType: 'support-ticket',
            resourceId: ticket.id,
            referenceId: ticket.referenceCode,
            actionUrl: `/dashboard/support/tickets/${ticket.id}`,
            payload: { referenceCode: ticket.referenceCode },
          });
        });
      }
    }

    if (calendar && ticket.status === 'WAITING_REPORTER' && ticket.waitingForReporterAt && !ticket.restrictedIncident) {
      const elapsed = elapsedSupportMinutes(ticket.waitingForReporterAt, now, calendar);
      if (elapsed >= 6 * 480 && !actions.has('WAITING_REPORTER_REMINDER')) {
        await prisma.$transaction(async (tx) => {
          await tx.supportTicketAuditEvent.create({ data: { ticketId: ticket.id, action: 'WAITING_REPORTER_REMINDER' } });
          await publishNotificationEvent(tx, {
            type: 'SUPPORT_TICKET_REPORTER_REMINDER',
            deduplicationKey: `support-reporter-reminder:${ticket.id}:${ticket.waitingForReporterAt!.toISOString()}`,
            recipientIds: [ticket.reporterId],
            resourceType: 'support-ticket',
            resourceId: ticket.id,
            referenceId: ticket.referenceCode,
            actionUrl: `/dashboard/support/tickets/${ticket.id}`,
            payload: { referenceCode: ticket.referenceCode },
          });
        });
      }
      if (elapsed >= 7 * 480) {
        await prisma.$transaction(async (tx) => {
          const closed = await tx.supportTicket.updateMany({
            where: {
              id: ticket.id,
              status: 'WAITING_REPORTER',
              waitingForReporterAt: ticket.waitingForReporterAt,
            },
            data: { status: 'CLOSED', closedAt: now, reopenUntil: new Date(now.getTime() + 30 * day) },
          });
          if (!closed.count) return;
          await tx.supportTicketAuditEvent.create({ data: { ticketId: ticket.id, action: 'AUTO_CLOSED_WAITING_REPORTER' } });
          await publishNotificationEvent(tx, {
            type: 'SUPPORT_TICKET_RESPONSE',
            deduplicationKey: `support-auto-closed:${ticket.id}:${ticket.waitingForReporterAt!.toISOString()}`,
            recipientIds: [ticket.reporterId],
            recipientGroups: { DIRECT_USER: [ticket.reporterId] },
            resourceType: 'support-ticket',
            resourceId: ticket.id,
            referenceId: ticket.referenceCode,
            actionUrl: `/dashboard/support/tickets/${ticket.id}`,
            payload: { referenceCode: ticket.referenceCode },
          });
        });
      }
    }
  }

  const attachments = await prisma.supportTicketAttachment.findMany({
    where: {
      deletedAt: null,
      ticket: { closedAt: { not: null }, legalHolds: { none: { releasedAt: null } } },
    },
    include: { ticket: { select: { id: true, closedAt: true } } },
  });
  let filesDeleted = 0;
  for (const attachment of attachments) {
    if (await removeExpiredSupportAttachment(prisma, attachment.id, now)) filesDeleted += 1;
  }
  const snapshotTickets = await prisma.supportTicket.findMany({
    where: {
      closedAt: { not: null },
      sensitiveEvidenceSnapshot: { not: Prisma.DbNull },
      sensitiveEvidenceDeletedAt: null,
      legalHolds: { none: { releasedAt: null } },
    },
    select: { id: true, closedAt: true, restrictedIncident: true },
  });
  for (const candidate of snapshotTickets) {
    await prisma.$transaction(async tx => {
      await lockSupportTicket(tx, candidate.id);
      const ticket = await tx.supportTicket.findUnique({ where: { id: candidate.id },
        include: { legalHolds: { where: { releasedAt: null } } } });
      if (!ticket || ticket.sensitiveEvidenceDeletedAt || !ticket.closedAt || ticket.legalHolds.length) return;
      const retentionDays = ticket.restrictedIncident ? 365 : 90;
      if (now.getTime() - ticket.closedAt.getTime() < retentionDays * day) return;
      await tx.supportTicket.update({ where: { id: ticket.id }, data: { sensitiveEvidenceSnapshot: Prisma.DbNull, sensitiveEvidenceDeletedAt: now } });
      await tx.supportTicketAuditEvent.create({ data: {
        ticketId: ticket.id, action: 'SENSITIVE_SNAPSHOT_DELETED_BY_SYSTEM',
        afterData: { deletedAt: now.toISOString(), retentionDays },
      } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }
  for (const name of await fs.promises.readdir(storageDir).catch(error => {
    if (error?.code === 'ENOENT') return [] as string[];
    throw error;
  })) {
    if (!name.startsWith('staged-') || path.basename(name) !== name) continue;
    const removed = await prisma.$transaction(async tx => {
      await lockSupportStoredFile(tx, name);
      if (await tx.supportTicketAttachment.count({ where: { storageName: name, deletedAt: null } })) return false;
      if (await supportRetentionPlanProtectsStagedFile(tx, name)) return false;
      const target = path.join(storageDir, name);
      const stat = await fs.promises.lstat(target).catch(error => {
        if (error?.code === 'ENOENT') return null;
        throw error;
      });
      if (!stat?.isFile() || now.getTime() - stat.mtimeMs < 60 * 60 * 1_000) return false;
      await removeSupportStoredFile(name);
      return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    if (removed) filesDeleted += 1;
  }
  // Backup copies expire only through the independent backup lifecycle; this job never claims to rewrite old backups.
  return { ticketsChecked: tickets.length, filesDeleted };
});

export const startSupportTicketMaintenance = (prisma: PrismaClient) => {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await runSupportTicketMaintenance(prisma); }
    catch (error) { console.error('Support ticket maintenance failed:', error); }
    finally { running = false; }
  };
  return startBackgroundJob({ name: 'startSupportTicketMaintenance', intervalMs: 60 * 60 * 1_000, run });
};
