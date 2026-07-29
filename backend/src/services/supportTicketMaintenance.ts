import fs from 'node:fs';
import path from 'node:path';
import { Prisma, type PrismaClient } from '@prisma/client';
import { publishNotificationEvent } from './notificationService';
import { elapsedSupportMinutes, parseSupportCalendar } from './supportSlaPolicy';
import { resolveWorkspaceRecipientIds } from './domainNotificationRecipients';

const storageDir = path.resolve(process.env.SUPPORT_TICKET_STORAGE_DIR || path.join(process.cwd(), 'storage', 'support-tickets'));
const closedStatuses = ['RESOLVED', 'CLOSED'];
const day = 86_400_000;

const safeDeleteStoredFile = (storageName: string | null) => {
  if (!storageName || path.basename(storageName) !== storageName) return false;
  const target = path.resolve(storageDir, storageName);
  if (!target.startsWith(`${storageDir}${path.sep}`)) return false;
  try {
    fs.unlinkSync(target);
    return true;
  } catch (error: any) {
    return error?.code === 'ENOENT';
  }
};

export const runSupportTicketMaintenance = async (prisma: PrismaClient, now = new Date()) => {
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
    const retentionDays = attachment.retentionClass === 'SENSITIVE_90_DAYS' ? 90 : 365;
    if (!attachment.ticket.closedAt || now.getTime() - attachment.ticket.closedAt.getTime() < retentionDays * day) continue;
    if (!safeDeleteStoredFile(attachment.storageName)) continue;
    await prisma.$transaction([
      prisma.supportTicketAttachment.update({
        where: { id: attachment.id },
        data: {
          storageName: null,
          deletedAt: now,
          deletionPolicy: `${attachment.retentionClass}:${retentionDays}_DAYS_AFTER_CLOSURE`,
        },
      }),
      prisma.supportTicketAuditEvent.create({
        data: {
          ticketId: attachment.ticket.id,
          action: 'RETENTION_FILE_DELETED_BY_SYSTEM',
          afterData: {
            attachmentId: attachment.id,
            sha256: attachment.sha256,
            deletedAt: now,
            policy: attachment.retentionClass,
          },
        },
      }),
    ]);
    filesDeleted += 1;
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
  for (const ticket of snapshotTickets) {
    const retentionDays = ticket.restrictedIncident ? 365 : 90;
    if (!ticket.closedAt || now.getTime() - ticket.closedAt.getTime() < retentionDays * day) continue;
    await prisma.$transaction([
      prisma.supportTicket.update({
        where: { id: ticket.id },
        data: { sensitiveEvidenceSnapshot: Prisma.DbNull, sensitiveEvidenceDeletedAt: now },
      }),
      prisma.supportTicketAuditEvent.create({
        data: {
          ticketId: ticket.id,
          action: 'SENSITIVE_SNAPSHOT_DELETED_BY_SYSTEM',
          afterData: { deletedAt: now.toISOString(), retentionDays },
        },
      }),
    ]);
  }
  const referencedStagedFiles = new Set(
    (
      await prisma.supportTicketAttachment.findMany({
        where: { storageName: { startsWith: 'staged-' }, deletedAt: null },
        select: { storageName: true },
      })
    ).map((attachment) => attachment.storageName).filter(Boolean),
  );
  for (const name of await fs.promises.readdir(storageDir).catch(() => [] as string[])) {
    if (!name.startsWith('staged-') || referencedStagedFiles.has(name)) continue;
    const target = path.join(storageDir, name);
    const stat = await fs.promises.stat(target).catch(() => null);
    if (stat && now.getTime() - stat.mtimeMs >= 60 * 60 * 1_000) {
      await fs.promises.unlink(target).catch(() => undefined);
      filesDeleted += 1;
    }
  }
  // Backup copies expire only through the independent backup lifecycle; this job never claims to rewrite old backups.
  return { ticketsChecked: tickets.length, filesDeleted };
};

export const startSupportTicketMaintenance = (prisma: PrismaClient) => {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await runSupportTicketMaintenance(prisma); }
    catch (error) { console.error('Support ticket maintenance failed:', error); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(() => void run(), 60 * 60 * 1_000);
  timer.unref?.();
  return () => clearInterval(timer);
};
