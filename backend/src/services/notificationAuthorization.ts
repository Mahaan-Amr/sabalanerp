import type { PrismaClient } from '@prisma/client';
import { FEATURES, getUserFeatures } from '../middleware/feature';
import { getUserWorkspaces } from '../middleware/workspace';
import { canAccessTicket } from './supportTicketPolicy';

export type NotificationAuthorizationUser = {
  id: string;
  role: string;
  isActive?: boolean;
};

export type NotificationWithAuthorizationEvent = {
  id: string;
  type?: string;
  event: {
    workspace: string | null;
    feature: string | null;
    resourceType: string | null;
    resourceId: string | null;
  } | null;
};
type AuthorizedHrDuty = {
  status: string;
  currentAssigneeUserId: string | null;
  createdByUserId: string;
  destinationWorkspaceCode: string;
  assignmentHistoryUserIds: string[];
};

export const canAccessHrDutyNotification = (input: {
  userId: string;
  type?: string;
  managedWorkspaces: string[];
  duty: AuthorizedHrDuty;
}) => {
  const terminalResult = input.type === 'HR_DUTY_RESULT';
  if (terminalResult) {
    return input.duty.createdByUserId === input.userId
      || input.duty.assignmentHistoryUserIds.includes(input.userId)
      || input.managedWorkspaces.includes(input.duty.destinationWorkspaceCode.toLowerCase());
  }
  if (input.type === 'HR_DUTY_UNASSIGNED_TRIAGE' || input.type === 'HR_DUTY_MANAGER_ESCALATION') {
    return input.managedWorkspaces.includes(input.duty.destinationWorkspaceCode.toLowerCase());
  }
  return input.duty.status === 'OPEN' && input.duty.currentAssigneeUserId === input.userId;
};
type AuthorizedSupportTicket = {
  id: string;
  reporterId: string;
  reportedWorkspace: string | null;
  reportedFeature: string | null;
  restrictedIncident: boolean;
  participants: Array<{ userId: string; role: string }>;
};

export const filterCurrentlyAuthorizedNotifications = async <
  T extends NotificationWithAuthorizationEvent,
>(
  database: PrismaClient,
  user: NotificationAuthorizationUser,
  rows: T[],
) => {
  if (user.isActive === false) return [];
  if (user.role === 'ADMIN') return rows;
  const [workspaceRows, featureRows] = await Promise.all([
    getUserWorkspaces(user.id, user.role),
    getUserFeatures(user.id, user.role),
  ]);
  const accessibleWorkspaces = workspaceRows.map((row) => String(row.workspace));
  const managedWorkspaces = workspaceRows
    .filter((row) => ['edit', 'admin'].includes(row.permission))
    .map((row) => String(row.workspace));
  const accessibleFeatures = featureRows.map((row) => `${row.workspace}:${row.feature}`);
  const managedFeatures = featureRows
    .filter((row) => ['edit', 'admin'].includes(row.permission))
    .map((row) => `${row.workspace}:${row.feature}`);
  const supportTicketIds = [...new Set(rows
    .filter((row) => row.event?.resourceType === 'support-ticket' && row.event.resourceId)
    .map((row) => row.event!.resourceId!))];
  const hrDutyIds = [...new Set(rows
    .filter((row) => row.event?.resourceType === 'HR_DUTY' && row.event.resourceId)
    .map((row) => row.event!.resourceId!))];
  const [tickets, designatedIncidentHandler, hrDuties] = await Promise.all([
    supportTicketIds.length
      ? database.supportTicket.findMany({
          where: { id: { in: supportTicketIds } },
          select: {
            id: true,
            reporterId: true,
            reportedWorkspace: true,
            reportedFeature: true,
            restrictedIncident: true,
            participants: {
              where: { removedAt: null },
              select: { userId: true, role: true },
            },
          },
        })
      : [],
    database.featurePermission.count({
      where: {
        userId: user.id,
        feature: FEATURES.SUPPORT_SECURITY_INCIDENT_HANDLE,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    }).then((count) => count > 0),
    hrDutyIds.length
      ? database.hrDuty.findMany({
          where: { id: { in: hrDutyIds } },
          select: {
            id: true,
            status: true,
            currentAssigneeUserId: true,
            createdByUserId: true,
            destinationWorkspaceCode: true,
            assignmentHistory: { select: { assignedUserId: true } },
          },
        })
      : [],
  ]);
  const ticketById = new Map<string, AuthorizedSupportTicket>(
    (tickets as AuthorizedSupportTicket[]).map((ticket) => [ticket.id, ticket]),
  );
  const hrDutyById = new Map<string, AuthorizedHrDuty>(hrDuties.map((duty) => [duty.id, {
    status: duty.status,
    currentAssigneeUserId: duty.currentAssigneeUserId,
    createdByUserId: duty.createdByUserId,
    destinationWorkspaceCode: duty.destinationWorkspaceCode,
    assignmentHistoryUserIds: duty.assignmentHistory
      .map(({ assignedUserId }) => assignedUserId)
      .filter((assignedUserId): assignedUserId is string => Boolean(assignedUserId)),
  }] as const));
  return rows.filter((row) => {
    const event = row.event;
    if (!event) return true;
    if (event.resourceType === 'support-ticket' && event.resourceId) {
      const ticket = ticketById.get(event.resourceId);
      if (!ticket) return false;
      return canAccessTicket({
        id: user.id,
        role: user.role,
        managedWorkspaces,
        accessibleWorkspaces,
        accessibleFeatures,
        managedFeatures,
        securityIncidentHandler: ticket.restrictedIncident && designatedIncidentHandler,
      }, {
        reporterId: ticket.reporterId,
        workspace: ticket.reportedWorkspace,
        feature: ticket.reportedFeature,
        restrictedIncident: ticket.restrictedIncident,
        participants: ticket.participants as any,
      });
    }
    if (event.resourceType === 'HR_DUTY' && event.resourceId) {
      const duty = hrDutyById.get(event.resourceId);
      return duty ? canAccessHrDutyNotification({
        userId: user.id,
        type: row.type,
        managedWorkspaces,
        duty,
      }) : false;
    }
    if (!event.workspace) return true;
    if (!accessibleWorkspaces.includes(event.workspace)) return false;
    return !event.feature || accessibleFeatures.includes(`${event.workspace}:${event.feature}`);
  });
};
