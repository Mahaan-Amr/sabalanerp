import type { Prisma, PrismaClient } from '@prisma/client';
import { FEATURES, getUserFeatures } from '../middleware/feature';
import { getUserWorkspaces } from '../middleware/workspace';
import { canAccessTicket } from './supportTicketPolicy';
import { canReadPartnerNotification, PARTNER_NOTIFICATION_RESOURCE } from './partnerSales/notifications/access';
import { activeHrActionPermissionsForUser } from './hrAuthorizationService';

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

const PERFORMANCE_NOTIFICATION_TYPES = new Set([
  'PERFORMANCE_SUPERVISOR_TASK',
  'PERFORMANCE_REVIEW_READY',
  'PERFORMANCE_SUBMISSION_DECIDED',
  'PERFORMANCE_REMINDER',
  'PERFORMANCE_CONSEQUENCE_REVIEW_REQUIRED',
  'PERFORMANCE_SUMMARY_UPDATED',
  'PERFORMANCE_PRIVACY_NOTICE',
  'PERFORMANCE_PRIVACY_DEADLINE',
  'PERFORMANCE_LEGAL_HOLD_NOTICE',
]);
type PerformanceNotificationContext = {
  personnelId: string | null;
  permissions: Set<string>;
};

const canAccessPerformanceNotification = async (
  database: PrismaClient | Prisma.TransactionClient,
  userId: string,
  row: NotificationWithAuthorizationEvent,
  contextPromise: Promise<PerformanceNotificationContext | null>,
) => {
  if (!row.type || !PERFORMANCE_NOTIFICATION_TYPES.has(row.type) || !row.event) return null;
  const context = await contextPromise;
  if (!context) return false;
  const { personnelId, permissions } = context;
  const { resourceType, resourceId } = row.event;
  if (row.type === 'PERFORMANCE_PRIVACY_NOTICE' || row.type === 'PERFORMANCE_PRIVACY_DEADLINE') {
    if (resourceType !== 'PERFORMANCE_PRIVACY_CASE' || !resourceId) return false;
    const privacyCase = await database.performancePrivacyCase.findUnique({
      where: { id: resourceId }, select: { subjectId: true },
    });
    if (!privacyCase) return false;
    if (row.type === 'PERFORMANCE_PRIVACY_DEADLINE') return permissions.has('VIEW_PERFORMANCE_PRIVACY_CASE');
    if (!personnelId) return false;
    const subject = await database.performanceSubject.findUnique({
      where: { id: privacyCase.subjectId }, select: { personnelId: true },
    });
    return subject?.personnelId === personnelId;
  }
  if (row.type === 'PERFORMANCE_LEGAL_HOLD_NOTICE') {
    if (resourceType !== 'PERFORMANCE_LEGAL_HOLD' || !resourceId || !personnelId) return false;
    const hold = await database.performanceLegalHold.findUnique({
      where: { id: resourceId }, select: { aggregateType: true, aggregateId: true },
    });
    if (!hold) return false;
    const evaluationId = hold.aggregateType === 'EVALUATION' ? hold.aggregateId
      : hold.aggregateType === 'EVALUATION_SECTION'
        ? (await database.performanceEvaluationSection.findUnique({
            where: { id: hold.aggregateId }, select: { evaluationId: true },
          }))?.evaluationId
        : null;
    const subjectId = hold.aggregateType === 'PERFORMANCE_SUBJECT' ? hold.aggregateId
      : evaluationId
        ? (await database.performanceEvaluation.findUnique({
            where: { id: evaluationId }, select: { subjectId: true },
          }))?.subjectId
        : null;
    if (!subjectId) return false;
    const subject = await database.performanceSubject.findUnique({
      where: { id: subjectId }, select: { personnelId: true },
    });
    return subject?.personnelId === personnelId;
  }
  if (row.type === 'PERFORMANCE_REVIEW_READY') {
    return permissions.has('REVIEW_PERFORMANCE_EVALUATION');
  }
  if (row.type === 'PERFORMANCE_SUMMARY_UPDATED') {
    if (resourceType !== 'PERFORMANCE_SUBJECT' || !resourceId || !personnelId) return false;
    const subject = await database.performanceSubject.findUnique({ where: { id: resourceId }, select: { personnelId: true } });
    return subject?.personnelId === personnelId;
  }
  if (row.type === 'PERFORMANCE_CONSEQUENCE_REVIEW_REQUIRED') {
    if (resourceType !== 'PERFORMANCE_CONSEQUENCE_HANDOFF' || !resourceId) return false;
    const handoff = await database.performanceConsequenceHandoff.findUnique({
      where: { id: resourceId }, select: { createdByUserId: true, packageId: true },
    });
    if (!handoff) return false;
    if (handoff.createdByUserId === userId && permissions.has('CREATE_PERFORMANCE_CONSEQUENCE_HANDOFF')) return true;
    if (!handoff.packageId || !permissions.has('VIEW_ASSIGNED_PERFORMANCE_CONSEQUENCE_HANDOFF')) return false;
    const packageRecord = await database.performanceConsequencePackage.findUnique({
      where: { id: handoff.packageId }, select: { assignedDestinationUserId: true, destinationResponsibilityId: true },
    });
    if (packageRecord?.assignedDestinationUserId !== userId) return false;
    const responsibility = await database.hrNamedResponsibility.findFirst({
      where: {
        id: packageRecord.destinationResponsibilityId,
        assignedUserId: userId,
        effectiveFrom: { lte: new Date() },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
        responsibilityType: { isActive: true },
      }, select: { id: true },
    });
    return Boolean(responsibility);
  }
  if (resourceType === 'PERFORMANCE_SUBMISSION' && resourceId) {
    const submission = await database.performanceSubmission.findUnique({
      where: { id: resourceId }, select: { supervisorUserId: true },
    });
    if (row.type === 'PERFORMANCE_SUBMISSION_DECIDED') return submission?.supervisorUserId === userId;
    return permissions.has('REVIEW_PERFORMANCE_EVALUATION');
  }
  if (resourceType === 'PERFORMANCE_EVALUATION_SECTION' && resourceId) {
    const section = await database.performanceEvaluationSection.findUnique({
      where: { id: resourceId }, select: { responsibleSupervisorPersonnelId: true },
    });
    const ownsSection = Boolean(personnelId && section?.responsibleSupervisorPersonnelId === personnelId);
    if (row.type === 'PERFORMANCE_SUPERVISOR_TASK' || row.type === 'PERFORMANCE_SUBMISSION_DECIDED') return ownsSection;
    return ownsSection || permissions.has('REVIEW_PERFORMANCE_EVALUATION') || permissions.has('MANAGE_PERFORMANCE_CYCLE');
  }
  return row.type === 'PERFORMANCE_REMINDER' && permissions.has('MANAGE_PERFORMANCE_CYCLE');
};

export const filterCurrentlyAuthorizedNotifications = async <
  T extends NotificationWithAuthorizationEvent,
>(
  database: PrismaClient | Prisma.TransactionClient,
  user: NotificationAuthorizationUser,
  rows: T[],
) => {
  if (user.isActive === false) return [];
  // Partner restrictions precede the general ADMIN override. Unwired central
  // authorization, revoked grants and old assignments all deny access.
  const partnerRows = rows.filter(row => row.event?.resourceType === PARTNER_NOTIFICATION_RESOURCE);
  const partnerAllowed = new Set((await Promise.all(partnerRows.map(async row =>
    await canReadPartnerNotification(database, user.id, row.id) ? row.id : null,
  ))).filter((id): id is string => id !== null));
  rows = rows.filter(row => row.event?.resourceType !== PARTNER_NOTIFICATION_RESOURCE || partnerAllowed.has(row.id));
  if (rows.every(row => row.event?.resourceType === PARTNER_NOTIFICATION_RESOURCE)) return rows;
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
  const crossWorkspaceDutyIds = [...new Set(rows
    .filter((row) => row.event?.resourceType === 'HR_DUTY' && row.event.resourceId)
    .map((row) => row.event!.resourceId!))];
  const hasPerformanceNotifications = rows.some((row) => row.type && PERFORMANCE_NOTIFICATION_TYPES.has(row.type));
  const performanceContext: Promise<PerformanceNotificationContext | null> = hasPerformanceNotifications
    ? Promise.all([
        database.user.findUnique({ where: { id: user.id }, select: { personnelId: true } }),
        activeHrActionPermissionsForUser(database, user.id),
      ]).then(([currentUser, permissions]) => currentUser
        ? { personnelId: currentUser.personnelId, permissions: new Set(permissions) }
        : null)
    : Promise.resolve(null);
  const performanceAccess = new Map<string, boolean>();
  await Promise.all(rows.map(async (row) => {
    const allowed = await canAccessPerformanceNotification(database, user.id, row, performanceContext);
    if (allowed !== null) performanceAccess.set(row.id, allowed);
  }));
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
    crossWorkspaceDutyIds.length
      ? database.crossWorkspaceDuty.findMany({
          where: { id: { in: crossWorkspaceDutyIds } },
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
  const crossWorkspaceDutyById = new Map<string, AuthorizedHrDuty>(hrDuties.map((duty) => [duty.id, {
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
    if (event?.resourceType === PARTNER_NOTIFICATION_RESOURCE) return partnerAllowed.has(row.id);
    if (performanceAccess.has(row.id)) return performanceAccess.get(row.id) === true;
    // Performance notifications are protected by their resource-specific checks above.
    // ADMIN bypass applies only to ordinary workspace/feature notifications.
    if (user.role === 'ADMIN') return true;
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
      const duty = crossWorkspaceDutyById.get(event.resourceId);
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
