import type { Prisma, PrismaClient } from '@prisma/client';
import { HR_DUTY_DEFINITIONS, formatHrDutyDeadlineTehran } from './hrDutyEngine';
import { resolveHrNamedResponsibility } from './hrAuthorizationService';

type Database = PrismaClient | Prisma.TransactionClient;
type Access = 'ASSIGNEE' | 'MANAGER_TRIAGE';

const WORKSPACE_CODES: Record<string, string> = {
  accounting: 'ACCOUNTING',
  sales: 'SALES',
  crm: 'CRM',
  inventory: 'INVENTORY',
  security: 'SECURITY',
  bi: 'BI',
  logistics: 'LOGISTICS',
  hr: 'HUMAN_RESOURCES',
};

export const destinationWorkspaceCode = (value: string) => {
  const normalized = value.trim();
  const code = WORKSPACE_CODES[normalized.toLowerCase()] ?? normalized.toUpperCase();
  if (!Object.values(WORKSPACE_CODES).includes(code)) throw new Error('DUTY_DESTINATION_UNAVAILABLE');
  return code;
};

export const destinationWorkspaceSlug = (code: string) => (
  Object.entries(WORKSPACE_CODES).find(([, candidate]) => candidate === code)?.[0] ?? code.toLowerCase()
);

export const authorizeDestinationDutySurface = (input: {
  duty: {
    status: string;
    destinationWorkspaceCode: string;
    currentAssigneeUserId: string | null;
  };
  actorUserId: string;
  requestedWorkspaceCode: string;
  isDestinationManager: boolean;
  envelopeIsCurrent: boolean;
  sourceIsCurrent: boolean;
  assignmentIsCurrent: boolean;
}): { allowed: true; access: Access } | { allowed: false; code: string } => {
  if (input.duty.destinationWorkspaceCode !== input.requestedWorkspaceCode) {
    return { allowed: false, code: 'DUTY_DESTINATION_CHANGED' };
  }
  if (!input.envelopeIsCurrent) return { allowed: false, code: 'DUTY_ENVELOPE_CHANGED' };
  if (!input.sourceIsCurrent) return { allowed: false, code: 'DUTY_SOURCE_CHANGED' };
  if (input.duty.currentAssigneeUserId === input.actorUserId) {
    if (!input.assignmentIsCurrent) return { allowed: false, code: 'DUTY_ASSIGNMENT_CHANGED' };
    return { allowed: true, access: 'ASSIGNEE' };
  }
  if (input.duty.currentAssigneeUserId === null && input.isDestinationManager) {
    return { allowed: true, access: 'MANAGER_TRIAGE' };
  }
  return { allowed: false, code: 'DUTY_ASSIGNEE_CHANGED' };
};

const stringList = (value: unknown) => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === 'string')
  : [];

export const projectDestinationDuty = (input: {
  duty: {
    id: string;
    status: string;
    sourceActionCode: string;
    sourceVersion: number;
    envelopeVersion: number;
    destinationWorkspaceCode: string;
    dueAt: Date;
    createdAt: Date;
    respondedAt: Date | null;
    structuredResultJson: unknown;
  };
  source: {
    title: string;
    description: string | null;
    destinationHref?: string;
    sourceKey?: string | null;
    createdByUserId?: string | null;
  };
  envelope: {
    allowedFieldsJson: unknown;
    allowedEvidenceJson: unknown;
    allowedActionCodesJson: unknown;
  };
  access: Access;
  includeHistory: boolean;
  now: Date;
  audit?: Array<{ version: number; eventCode: string; reason: string | null; createdAt: Date }>;
}) => {
  const allowedFields = new Set(stringList(input.envelope.allowedFieldsJson));
  const fields: Record<string, string | null> = {};
  if (allowedFields.has('title')) fields.title = input.source.title;
  if (allowedFields.has('description')) fields.description = input.source.description;
  if (allowedFields.has('dueAt')) fields.dueAt = input.duty.dueAt.toISOString();
  return {
    id: input.duty.id,
    status: input.duty.status,
    access: input.access,
    workspace: destinationWorkspaceSlug(input.duty.destinationWorkspaceCode),
    sourceActionCode: input.duty.sourceActionCode,
    sourceVersion: input.duty.sourceVersion,
    envelopeVersion: input.duty.envelopeVersion,
    dueAt: input.duty.dueAt.toISOString(),
    dueAtDisplay: formatHrDutyDeadlineTehran(input.duty.dueAt),
    overdue: input.duty.status === 'OPEN' && input.duty.dueAt < input.now,
    fields,
    // Evidence is deliberately a type-only capability descriptor. The duty schema stores no
    // evidence snapshot/reference, so projecting source-case evidence here would cross the boundary.
    evidence: stringList(input.envelope.allowedEvidenceJson).map((kind) => ({ kind })),
    allowedActionCodes: input.duty.status === 'OPEN' && input.access === 'ASSIGNEE'
      ? stringList(input.envelope.allowedActionCodesJson)
      : [],
    result: input.duty.structuredResultJson,
    detailAvailable: true,
    createdAt: input.duty.createdAt.toISOString(),
    respondedAt: input.duty.respondedAt?.toISOString() ?? null,
    history: input.includeHistory
      ? (input.audit ?? []).map((event) => ({
        version: event.version,
        eventCode: event.eventCode,
        reason: event.reason,
        createdAt: event.createdAt.toISOString(),
      }))
      : [],
  };
};

const definitionFor = (action: string) => Object.values(HR_DUTY_DEFINITIONS)
  .find((definition) => definition.sourceActionCode === action);
const canonicalJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalJson(item)]),
  );
  return value;
};
const jsonEqual = (left: unknown, right: unknown) => (
  JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right))
);
const envelopeIsCurrent = (duty: any) => {
  const definition = definitionFor(duty.sourceActionCode);
  if (!definition || duty.envelopeVersion !== definition.envelopeVersion || !duty.envelope.isActive) return false;
  const expectedCode = definition.destinationWorkspaceCode
    ? definition.envelopeCode
    : `${definition.envelopeCode}@${duty.destinationWorkspaceCode}`;
  return duty.envelopeCode === expectedCode
    && (!definition.destinationWorkspaceCode || definition.destinationWorkspaceCode === duty.destinationWorkspaceCode)
    && jsonEqual(duty.envelope.allowedFieldsJson, [...definition.allowedFields])
    && jsonEqual(duty.envelope.allowedEvidenceJson, [...definition.allowedEvidence])
    && jsonEqual(duty.envelope.allowedActionCodesJson, [...definition.allowedActionCodes])
    && jsonEqual(duty.envelope.responseSchemaJson, definition.responseSchema);
};

const isManager = async (database: Database, userId: string, workspaceCode: string, now: Date) => {
  const user = await database.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });
  if (!user?.isActive) return false;
  if (user.role === 'ADMIN') return true;
  if (workspaceCode === 'HUMAN_RESOURCES') {
    return Boolean(await database.hrWorkspaceAccessGrant.findFirst({
      where: {
        userId, workspaceCode, level: 'ADMIN', status: 'ACTIVE', effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
      },
      select: { id: true },
    }));
  }
  return Boolean(await database.workspacePermission.findFirst({
    where: {
      userId, workspace: destinationWorkspaceSlug(workspaceCode), permissionLevel: 'admin', isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true },
  }));
};

const include = {
  envelope: true,
  responsibility: true,
  assignmentHistory: true,
  auditVersions: { orderBy: { version: 'asc' as const } },
} as const;

const authorizeLoadedDuty = async (
  database: Database,
  duty: any,
  actorUserId: string,
  requestedWorkspaceCode: string,
  now: Date,
  knownManager?: boolean,
) => {
  const source = await database.hrWorkItem.findUnique({ where: { id: duty.sourceId } });
  if (!source) throw new Error('DUTY_SOURCE_CHANGED');
  const currentSourceVersion = (await database.hrWorkItemAudit.count({
    where: { workItemId: source.id, NOT: { eventType: { startsWith: 'DUTY_' } } },
  })) + 1;
  const routingType = duty.routingResponsibilityTypeCode ?? duty.responsibility?.responsibilityTypeCode;
  const routingScope = duty.routingScopeType ?? duty.responsibility?.scopeType;
  const resolution = routingType && routingScope
    ? await resolveHrNamedResponsibility(database, {
      sourceActionCode: duty.sourceActionCode,
      responsibilityTypeCode: routingType,
      scopeType: routingScope,
      scopeId: duty.routingScopeId ?? duty.responsibility?.scopeId ?? null,
      sourceActorUserId: duty.sourceActorUserId ?? undefined,
      now,
    })
    : null;
  const assignmentIsCurrent = duty.currentAssigneeUserId === null || (
    resolution?.status === 'RESOLVED'
    && resolution.responsibilityId === duty.responsibilityId
    && resolution.assignedUserId === duty.currentAssigneeUserId
  );
  const decision = authorizeDestinationDutySurface({
    duty,
    actorUserId,
    requestedWorkspaceCode,
    isDestinationManager: knownManager ?? await isManager(database, actorUserId, requestedWorkspaceCode, now),
    envelopeIsCurrent: envelopeIsCurrent(duty),
    sourceIsCurrent: currentSourceVersion === duty.sourceVersion,
    assignmentIsCurrent,
  });
  if (!decision.allowed) throw new Error(decision.code);
  return { duty, source, access: decision.access };
};

export const getDestinationDutyDetail = async (
  database: Database,
  input: { dutyId: string; actorUserId: string; workspaceCode: string; now?: Date },
) => {
  const now = input.now ?? new Date();
  const workspaceCode = destinationWorkspaceCode(input.workspaceCode);
  const duty = await database.hrDuty.findUnique({ where: { id: input.dutyId }, include });
  if (!duty) throw new Error('DUTY_NOT_AVAILABLE');
  const authorized = await authorizeLoadedDuty(database, duty, input.actorUserId, workspaceCode, now);
  return projectDestinationDuty({
    duty,
    source: authorized.source,
    envelope: duty.envelope,
    access: authorized.access,
    includeHistory: true,
    audit: duty.auditVersions,
    now,
  });
};

export const listDestinationDuties = async (
  database: Database,
  input: { actorUserId: string; workspaceCode: string; view: 'assigned' | 'triage' | 'history'; now?: Date },
) => {
  const now = input.now ?? new Date();
  const workspaceCode = destinationWorkspaceCode(input.workspaceCode);
  const manager = await isManager(database, input.actorUserId, workspaceCode, now);
  if (input.view === 'triage' && !manager) throw new Error('DUTY_MANAGER_TRIAGE_FORBIDDEN');
  const duties = await database.hrDuty.findMany({
    where: {
      destinationWorkspaceCode: workspaceCode,
      ...(input.view === 'triage'
        ? { status: 'OPEN', currentAssigneeUserId: null }
        : input.view === 'history'
          ? { status: { in: ['COMPLETED', 'WAIVED', 'CANCELLED'] }, ...(manager ? {} : { currentAssigneeUserId: input.actorUserId }) }
          : { status: 'OPEN', currentAssigneeUserId: input.actorUserId }),
    },
    include,
    orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
  });
  const visible: Array<ReturnType<typeof projectDestinationDuty>> = [];
  for (const duty of duties) {
    try {
      const authorized = await authorizeLoadedDuty(database, duty, input.actorUserId, workspaceCode, now, manager);
      visible.push(projectDestinationDuty({
        duty, source: authorized.source, envelope: duty.envelope, access: authorized.access,
        includeHistory: input.view === 'history', audit: duty.auditVersions, now,
      }));
    } catch {
      if (input.view !== 'history') continue;
      const wasAssigned = duty.assignmentHistory.some((assignment: { assignedUserId: string | null }) => (
        assignment.assignedUserId === input.actorUserId
      ));
      if (!manager && !wasAssigned) continue;
      const historical = projectDestinationDuty({
        duty: { ...duty, structuredResultJson: null },
        source: { title: '', description: null },
        envelope: {
          ...duty.envelope,
          allowedFieldsJson: [],
          allowedEvidenceJson: [],
          allowedActionCodesJson: [],
        },
        access: manager ? 'MANAGER_TRIAGE' : 'ASSIGNEE',
        includeHistory: true,
        audit: duty.auditVersions.map((event: { version: number; eventCode: string; createdAt: Date }) => ({
          ...event,
          reason: null,
        })),
        now,
      });
      historical.allowedActionCodes = [];
      historical.detailAvailable = false;
      visible.push(historical);
    }
  }
  return visible;
};

export const getDestinationDutySummary = async (
  database: Database,
  input: { actorUserId: string; workspaceCode: string; now?: Date },
) => {
  const now = input.now ?? new Date();
  const assigned = await listDestinationDuties(database, { ...input, view: 'assigned', now });
  const manager = await isManager(database, input.actorUserId, destinationWorkspaceCode(input.workspaceCode), now);
  const triage = manager
    ? await listDestinationDuties(database, { ...input, view: 'triage', now })
    : [];
  return {
    open: assigned.length,
    dueSoon: assigned.filter((duty) => (
      new Date(duty.dueAt).getTime() <= now.getTime() + 24 * 60 * 60 * 1_000
    )).length,
    overdue: assigned.filter((duty) => duty.overdue).length,
    triage: triage.length,
    canManageTriage: manager,
  };
};
