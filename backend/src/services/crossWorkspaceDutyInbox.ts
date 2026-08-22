import { Prisma, type PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  CROSS_WORKSPACE_DUTY_DEFINITIONS,
  canClaimCrossWorkspaceDuty,
  crossWorkspaceDutyClaimRequiresReason,
  crossWorkspaceDutyResponseRequiresReason,
  formatCrossWorkspaceDutyDeadlineTehran,
  loadCrossWorkspaceDutySourceProjection,
} from './crossWorkspaceDutyModule';

type Database = PrismaClient | Prisma.TransactionClient;
type Access = 'ASSIGNEE' | 'MANAGER_TRIAGE' | 'AVAILABLE';

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

export const crossWorkspaceDutyDestinationCode = (value: string) => {
  const normalized = value.trim();
  const code = WORKSPACE_CODES[normalized.toLowerCase()] ?? normalized.toUpperCase();
  if (!Object.values(WORKSPACE_CODES).includes(code)) throw new Error('DUTY_DESTINATION_UNAVAILABLE');
  return code;
};

export const crossWorkspaceDutyDestinationSlug = (code: string) => (
  Object.entries(WORKSPACE_CODES).find(([, candidate]) => candidate === code)?.[0] ?? code.toLowerCase()
);

export const authorizeCrossWorkspaceDutyInbox = (input: {
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

export const projectCrossWorkspaceDuty = (input: {
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
    updatedAt: Date;
    currentAssigneeUserId: string | null;
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
  canReassign?: boolean;
  claimRequiresReason?: boolean;
  responseRequiresReason?: boolean;
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
    canReassign: Boolean(input.canReassign && input.duty.status === 'OPEN'),
    claimRequiresReason: Boolean(input.claimRequiresReason && input.duty.status === 'OPEN' && input.access === 'AVAILABLE'),
    responseRequiresReason: Boolean(input.responseRequiresReason && input.duty.status === 'OPEN' && input.access === 'ASSIGNEE'),
    currentAssigneeUserId: input.duty.currentAssigneeUserId,
    workspace: crossWorkspaceDutyDestinationSlug(input.duty.destinationWorkspaceCode),
    sourceActionCode: input.duty.sourceActionCode,
    sourceVersion: input.duty.sourceVersion,
    envelopeVersion: input.duty.envelopeVersion,
    dueAt: input.duty.dueAt.toISOString(),
    dueAtDisplay: formatCrossWorkspaceDutyDeadlineTehran(input.duty.dueAt),
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
    updatedAt: input.duty.updatedAt.toISOString(),
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

const definitionFor = (action: string) => Object.values(CROSS_WORKSPACE_DUTY_DEFINITIONS)
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
  const workspace = crossWorkspaceDutyDestinationSlug(workspaceCode);
  const [direct, inherited] = await Promise.all([
    database.workspacePermission.findFirst({
      where: {
        userId, workspace, permissionLevel: 'admin', isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { id: true },
    }),
    database.roleWorkspacePermission.findFirst({
      where: {
        role: user.role, workspace, permissionLevel: 'admin', isActive: true,
      },
      select: { id: true },
    }),
  ]);
  return Boolean(direct || inherited);
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
  const source = await loadCrossWorkspaceDutySourceProjection(database, {
    sourceType: duty.sourceType,
    sourceId: duty.sourceId,
    sourceVersion: duty.sourceVersion,
  });
  // Named-responsibility assignments are retained only as historical evidence.
  // Existing duties keep their snapshotted assignee until completion; new duties
  // are created by the action-permission shared-work flow instead.
  const assignmentIsCurrent = true;
  if (duty.currentAssigneeUserId === null && await canClaimCrossWorkspaceDuty(database, {
    dutyId: duty.id, actorUserId, policyVersion: 1, now,
  })) return {
    duty,
    source,
    access: 'AVAILABLE' as const,
    claimRequiresReason: await crossWorkspaceDutyClaimRequiresReason(database, {
      dutyId: duty.id, actorUserId, policyVersion: 1, now,
    }),
  };
  const decision = authorizeCrossWorkspaceDutyInbox({
    duty,
    actorUserId,
    requestedWorkspaceCode,
    isDestinationManager: knownManager ?? await isManager(database, actorUserId, requestedWorkspaceCode, now),
    envelopeIsCurrent: envelopeIsCurrent(duty),
    // Source-version currency gates mutable work. A completed duty is immutable
    // history and remains readable after its successful transition advances the source.
    sourceIsCurrent: duty.status === 'OPEN' ? source.sourceIsCurrent : true,
    assignmentIsCurrent,
  });
  if (!decision.allowed) throw new Error(decision.code);
  return {
    duty,
    source,
    access: decision.access,
    claimRequiresReason: false,
    responseRequiresReason: decision.access === 'ASSIGNEE'
      ? await crossWorkspaceDutyResponseRequiresReason(database, { dutyId: duty.id, actorUserId })
      : false,
  };
};

export const getCrossWorkspaceDutyDetail = async (
  database: Database,
  input: { dutyId: string; actorUserId: string; workspaceCode: string; now?: Date },
) => {
  const now = input.now ?? new Date();
  const workspaceCode = crossWorkspaceDutyDestinationCode(input.workspaceCode);
  const duty = await database.crossWorkspaceDuty.findUnique({ where: { id: input.dutyId }, include });
  if (!duty) throw new Error('DUTY_NOT_AVAILABLE');
  const manager = await isManager(database, input.actorUserId, workspaceCode, now);
  const authorized = await authorizeLoadedDuty(database, duty, input.actorUserId, workspaceCode, now, manager);
  return projectCrossWorkspaceDuty({
    duty,
    source: authorized.source,
    envelope: duty.envelope,
    access: authorized.access,
    claimRequiresReason: authorized.claimRequiresReason,
    responseRequiresReason: authorized.responseRequiresReason,
    canReassign: manager,
    includeHistory: true,
    audit: duty.auditVersions,
    now,
  });
};

export const listCrossWorkspaceDuties = async (
  database: Database,
  input: { actorUserId: string; workspaceCode: string; view: 'assigned' | 'available' | 'triage' | 'history'; now?: Date },
) => {
  const now = input.now ?? new Date();
  const workspaceCode = crossWorkspaceDutyDestinationCode(input.workspaceCode);
  const manager = await isManager(database, input.actorUserId, workspaceCode, now);
  if (input.view === 'triage' && !manager) throw new Error('DUTY_MANAGER_TRIAGE_FORBIDDEN');
  const duties = await database.crossWorkspaceDuty.findMany({
    where: {
      destinationWorkspaceCode: workspaceCode,
      ...(input.view === 'triage' || input.view === 'available'
        ? { status: 'OPEN', currentAssigneeUserId: null }
        : input.view === 'history'
          ? { status: { in: ['COMPLETED', 'WAIVED', 'CANCELLED'] }, ...(manager ? {} : { OR: [
            { currentAssigneeUserId: input.actorUserId },
            { assignmentHistory: { some: { assignedUserId: input.actorUserId } } },
          ] }) }
          : { status: 'OPEN', currentAssigneeUserId: input.actorUserId }),
    },
    include,
    orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
  });
  const visible: Array<ReturnType<typeof projectCrossWorkspaceDuty>> = [];
  for (const duty of duties) {
    try {
      const authorized = await authorizeLoadedDuty(database, duty, input.actorUserId, workspaceCode, now, manager);
      if (input.view === 'available' && authorized.access !== 'AVAILABLE') continue;
      visible.push(projectCrossWorkspaceDuty({
        duty, source: authorized.source, envelope: duty.envelope, access: authorized.access,
        claimRequiresReason: authorized.claimRequiresReason,
        responseRequiresReason: authorized.responseRequiresReason,
        includeHistory: input.view === 'history', audit: duty.auditVersions, now,
      }));
    } catch {
      if (input.view !== 'history') continue;
      const wasAssigned = duty.assignmentHistory.some((assignment: { assignedUserId: string | null }) => (
        assignment.assignedUserId === input.actorUserId
      ));
      if (!manager && !wasAssigned) continue;
      const historical = projectCrossWorkspaceDuty({
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

export const getCrossWorkspaceDutySummary = async (
  database: Database,
  input: { actorUserId: string; workspaceCode: string; now?: Date },
) => {
  const now = input.now ?? new Date();
  const assigned = await listCrossWorkspaceDuties(database, { ...input, view: 'assigned', now });
  const available = await listCrossWorkspaceDuties(database, { ...input, view: 'available', now });
  const manager = await isManager(database, input.actorUserId, crossWorkspaceDutyDestinationCode(input.workspaceCode), now);
  const triage = manager
    ? await listCrossWorkspaceDuties(database, { ...input, view: 'triage', now })
    : [];
  const destinationWorkspaceCode = crossWorkspaceDutyDestinationCode(input.workspaceCode);
  const historyReceipt = await database.crossWorkspaceDutyHistoryReceipt.findUnique({
    where: { userId_destinationWorkspaceCode: {
      userId: input.actorUserId,
      destinationWorkspaceCode,
    } },
    select: { lastSeenAt: true },
  });
  const historyUnseen = await database.crossWorkspaceDuty.count({ where: {
    destinationWorkspaceCode,
    status: { in: ['COMPLETED', 'WAIVED', 'CANCELLED'] },
    ...(historyReceipt ? { updatedAt: { gt: historyReceipt.lastSeenAt } } : {}),
    ...(manager ? {} : { OR: [
      { currentAssigneeUserId: input.actorUserId },
      { assignmentHistory: { some: { assignedUserId: input.actorUserId } } },
    ] }),
  } });
  return {
    open: assigned.length,
    available: available.length,
    dueSoon: assigned.filter((duty) => (
      new Date(duty.dueAt).getTime() <= now.getTime() + 24 * 60 * 60 * 1_000
    )).length,
    overdue: assigned.filter((duty) => duty.overdue).length,
    triage: triage.length,
    historyUnseen,
    canManageTriage: manager,
  };
};

export const markCrossWorkspaceDutyHistorySeen = async (
  database: Database,
  input: { actorUserId: string; workspaceCode: string; seenThrough: Date; now?: Date },
) => {
  const now = input.now ?? new Date();
  const destinationWorkspaceCode = crossWorkspaceDutyDestinationCode(input.workspaceCode);
  const visibleHistory = await listCrossWorkspaceDuties(database, {
    actorUserId: input.actorUserId,
    workspaceCode: destinationWorkspaceCode,
    view: 'history',
    now,
  });
  const visibleCutoff = visibleHistory.reduce<Date | null>((latest, duty) => {
    const changedAt = new Date(duty.updatedAt);
    if (changedAt > input.seenThrough || changedAt > now) return latest;
    return !latest || changedAt > latest ? changedAt : latest;
  }, null);
  if (!visibleCutoff) return { lastSeenAt: null };
  const receipts = await database.$queryRaw<Array<{ lastSeenAt: Date }>>(Prisma.sql`
    INSERT INTO "cross_workspace_duty_history_receipts"
      ("id", "userId", "destinationWorkspaceCode", "lastSeenAt", "createdAt", "updatedAt")
    VALUES
      (${randomUUID()}, ${input.actorUserId}, ${destinationWorkspaceCode}, ${visibleCutoff}, ${now}, ${now})
    ON CONFLICT ("userId", "destinationWorkspaceCode") DO UPDATE
    SET "lastSeenAt" = GREATEST(
      "cross_workspace_duty_history_receipts"."lastSeenAt",
      EXCLUDED."lastSeenAt"
    ),
    "updatedAt" = EXCLUDED."updatedAt"
    RETURNING "lastSeenAt"
  `);
  return { lastSeenAt: receipts[0]?.lastSeenAt ?? visibleCutoff };
};
