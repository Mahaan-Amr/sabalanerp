import { Prisma, type PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  CROSS_WORKSPACE_DUTY_DEFINITIONS,
  canClaimCrossWorkspaceDuty,
  canAccessSharedCrossWorkspaceDuty,
  canReassignCrossWorkspaceDuty,
  sharedCrossWorkspaceDutyAccessProvenance,
  crossWorkspaceDutyClaimRequiresReason,
  crossWorkspaceDutyResponseRequiresReason,
  formatCrossWorkspaceDutyDeadlineTehran,
  loadCrossWorkspaceDutySourceProjection,
  createCrossWorkspaceDutySourceProjectionReader,
} from './crossWorkspaceDutyModule';
import { countAccountingReadRows, measureAccountingReadPhase } from './accountingReadTiming';
import { resolveWorkspaceDutyAuthority } from './crossWorkspaceDutyAuthority';

type Database = PrismaClient | Prisma.TransactionClient;
type Access = 'ASSIGNEE' | 'MANAGER_TRIAGE' | 'AVAILABLE' | 'SHARED';

const WORKSPACE_CODES: Record<string, string> = {
  accounting: 'ACCOUNTING',
  sales: 'SALES',
  purchasing: 'PURCHASING',
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
  isSharedDecision?: boolean;
  isSharedEligible?: boolean;
}): { allowed: true; access: Access } | { allowed: false; code: string } => {
  if (input.duty.destinationWorkspaceCode !== input.requestedWorkspaceCode) {
    return { allowed: false, code: 'DUTY_DESTINATION_CHANGED' };
  }
  if (!input.envelopeIsCurrent) return { allowed: false, code: 'DUTY_ENVELOPE_CHANGED' };
  if (!input.sourceIsCurrent) return { allowed: false, code: 'DUTY_SOURCE_CHANGED' };
  if (input.isSharedDecision) {
    return input.isSharedEligible
      ? { allowed: true, access: 'SHARED' }
      : { allowed: false, code: 'DUTY_ASSIGNEE_INELIGIBLE' };
  }
  if (input.duty.currentAssigneeUserId === input.actorUserId) {
    if (!input.assignmentIsCurrent) return { allowed: false, code: 'DUTY_ASSIGNMENT_CHANGED' };
    return { allowed: true, access: 'ASSIGNEE' };
  }
  if (input.duty.currentAssigneeUserId !== null && input.isDestinationManager) {
    return { allowed: true, access: 'MANAGER_TRIAGE' };
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
    dueAt: Date | null;
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
  resultActor?: { id: string; displayName: string; username: string } | null;
  currentAssignee?: { id: string; displayName: string; username: string } | null;
  accessProvenance?: string[];
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
  if (allowedFields.has('dueAt')) fields.dueAt = input.duty.dueAt?.toISOString() ?? null;
  return {
    id: input.duty.id,
    status: input.duty.status,
    access: input.access,
    canReassign: Boolean(input.canReassign && input.duty.status === 'OPEN'),
    claimRequiresReason: Boolean(input.claimRequiresReason && input.duty.status === 'OPEN' && input.access === 'AVAILABLE'),
    responseRequiresReason: Boolean(input.responseRequiresReason && input.duty.status === 'OPEN'
      && (input.access === 'ASSIGNEE' || input.access === 'SHARED')),
    currentAssigneeUserId: input.duty.currentAssigneeUserId,
    currentAssignee: input.currentAssignee ?? null,
    accessProvenance: input.accessProvenance ?? [],
    workspace: crossWorkspaceDutyDestinationSlug(input.duty.destinationWorkspaceCode),
    sourceActionCode: input.duty.sourceActionCode,
    sourceVersion: input.duty.sourceVersion,
    envelopeVersion: input.duty.envelopeVersion,
    dueAt: input.duty.dueAt?.toISOString() ?? null,
    dueAtDisplay: input.duty.dueAt ? formatCrossWorkspaceDutyDeadlineTehran(input.duty.dueAt) : 'بدون مهلت',
    overdue: input.duty.status === 'OPEN' && !!input.duty.dueAt && input.duty.dueAt < input.now,
    fields,
    destinationHref: input.source.destinationHref ?? null,
    // Evidence is deliberately a type-only capability descriptor. The duty schema stores no
    // evidence snapshot/reference, so projecting source-case evidence here would cross the boundary.
    evidence: stringList(input.envelope.allowedEvidenceJson).map((kind) => ({ kind })),
    allowedActionCodes: input.duty.status === 'OPEN' && (input.access === 'ASSIGNEE' || input.access === 'SHARED')
      ? stringList(input.envelope.allowedActionCodesJson)
      : [],
    result: input.duty.structuredResultJson,
    resultActor: input.resultActor ?? null,
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
  if (user.role === 'ADMIN' || workspaceCode === 'PURCHASING' && user.role === 'MANAGER') return true;
  const workspace = crossWorkspaceDutyDestinationSlug(workspaceCode);
  return (await resolveWorkspaceDutyAuthority(database, {
    userId, workspace, feature: '__destination_manager_scope__', at: now,
  })).isWorkspaceAdmin;
};

const include = {
  envelope: true,
  auditVersions: { orderBy: { version: 'asc' as const } },
} as const;

const authorizeLoadedDuty = async (
  database: Database,
  duty: any,
  actorUserId: string,
  requestedWorkspaceCode: string,
  now: Date,
  knownManager?: boolean,
  summaryOnly = false,
  readSource = loadCrossWorkspaceDutySourceProjection,
  view?: DutyView,
) => {
  if (duty.status === 'OPEN' && duty.sourceType === 'SALES_CONTRACT_CORRECTION'
    && duty.sourceActionCode === 'SALES_EDIT_CONTRACT_CORRECTION' && duty.dueAt <= now) {
    throw new Error('DUTY_SALES_EDIT_EXPIRED');
  }
  const source = await readSource(database, {
    sourceType: duty.sourceType,
    sourceId: duty.sourceId,
    sourceActionCode: duty.sourceActionCode,
    sourceVersion: duty.sourceVersion,
  });
  const access = await resolveLoadedDutyAccess(database, duty, actorUserId, requestedWorkspaceCode, now, knownManager, source.sourceIsCurrent);
  if (summaryOnly || (view && view !== 'history' && !matchesActiveView(access, view))) return { duty, source, access };
  if (access === 'AVAILABLE') return {
    duty, source, access,
    claimRequiresReason: await crossWorkspaceDutyClaimRequiresReason(database, { dutyId: duty.id, actorUserId, policyVersion: 1, now }),
  };
  const resultActorUser = duty.respondedByUserId ? await database.user.findUnique({
    where: { id: duty.respondedByUserId },
    select: { id: true, firstName: true, lastName: true, username: true },
  }) : null;
  const resultActor = resultActorUser ? {
    id: resultActorUser.id,
    displayName: `${resultActorUser.firstName} ${resultActorUser.lastName}`.trim() || resultActorUser.username,
    username: resultActorUser.username,
  } : null;
  const assigneeUser = duty.currentAssigneeUserId ? await database.user.findUnique({
    where: { id: duty.currentAssigneeUserId },
    select: { id: true, firstName: true, lastName: true, username: true },
  }) : null;
  const currentAssignee = assigneeUser ? {
    id: assigneeUser.id,
    displayName: `${assigneeUser.firstName} ${assigneeUser.lastName}`.trim() || assigneeUser.username,
    username: assigneeUser.username,
  } : null;
  return {
    duty,
    source,
    access,
    resultActor,
    currentAssignee,
    accessProvenance: access === 'SHARED'
      ? await sharedCrossWorkspaceDutyAccessProvenance(database, { dutyId: duty.id, actorUserId, now })
      : [],
    responseRequiresReason: access === 'ASSIGNEE' || access === 'SHARED'
      ? await crossWorkspaceDutyResponseRequiresReason(database, { dutyId: duty.id, actorUserId })
      : false,
  };
};

const resolveLoadedDutyAccess = async (
  database: Database,
  duty: any,
  actorUserId: string,
  requestedWorkspaceCode: string,
  now: Date,
  knownManager: boolean | undefined,
  sourceIsCurrent: boolean,
): Promise<Access> => {
  // Named-responsibility assignments are retained only as historical evidence.
  // Existing duties keep their snapshotted assignee until completion; new duties
  // are created by the action-permission shared-work flow instead.
  const assignmentIsCurrent = true;
  const definition = definitionFor(duty.sourceActionCode);
  const isSharedDecision = definition?.accountabilityModel === 'SHARED_DECISION';
  const isSharedEligible = Boolean(isSharedDecision && await canAccessSharedCrossWorkspaceDuty(database, {
    dutyId: duty.id,
    actorUserId,
    includeCompleted: duty.status !== 'OPEN',
    now,
  }));
  if (!isSharedDecision && duty.currentAssigneeUserId === null && await canClaimCrossWorkspaceDuty(database, {
    dutyId: duty.id, actorUserId, policyVersion: 1, now,
  })) return 'AVAILABLE';
  const decision = authorizeCrossWorkspaceDutyInbox({
    duty,
    actorUserId,
    requestedWorkspaceCode,
    isDestinationManager: knownManager ?? await isManager(database, actorUserId, requestedWorkspaceCode, now),
    envelopeIsCurrent: envelopeIsCurrent(duty),
    // Source-version currency gates mutable work. A completed duty is immutable
    // history and remains readable after its successful transition advances the source.
    sourceIsCurrent: duty.status === 'OPEN' ? sourceIsCurrent : true,
    assignmentIsCurrent,
    isSharedDecision,
    isSharedEligible,
  });
  if (!decision.allowed) throw new Error(decision.code);
  return decision.access;
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
    resultActor: authorized.resultActor,
    currentAssignee: authorized.currentAssignee,
    accessProvenance: authorized.accessProvenance,
    envelope: duty.envelope,
    access: authorized.access,
    claimRequiresReason: authorized.claimRequiresReason,
    responseRequiresReason: authorized.responseRequiresReason,
    canReassign: manager && authorized.access !== 'SHARED' && await canReassignCrossWorkspaceDuty(database, {
      dutyId: duty.id, actorUserId: input.actorUserId, now,
    }),
    includeHistory: true,
    audit: duty.auditVersions,
    now,
  });
};

type DutyView = 'assigned' | 'available' | 'triage' | 'history';
type DutyReadInput = { actorUserId: string; workspaceCode: string; now?: Date };
type DutyListInput = DutyReadInput & { view: DutyView; search?: string };

const matchesActiveView = (access: Access, view: Exclude<DutyView, 'history'>) => {
  if (view === 'assigned') return access === 'ASSIGNEE' || access === 'SHARED';
  if (view === 'available') return access === 'AVAILABLE';
  return access !== 'SHARED';
};

const sharedDecisionActionCodes = Object.values(CROSS_WORKSPACE_DUTY_DEFINITIONS)
  .filter(definition => definition.accountabilityModel === 'SHARED_DECISION')
  .map(definition => definition.sourceActionCode);

const activeCandidateWhere = (actorUserId: string, manager: boolean, view?: DutyView): Prisma.CrossWorkspaceDutyWhereInput => {
  const shared = { sourceActionCode: { in: sharedDecisionActionCodes } };
  const individual = { sourceActionCode: { notIn: sharedDecisionActionCodes } };
  const assigned = { currentAssigneeUserId: actorUserId };
  const unassigned = { currentAssigneeUserId: null };
  if (view === 'assigned') return { OR: [assigned, shared] };
  if (view === 'available') return { ...unassigned, ...individual };
  if (view === 'triage') return individual;
  return manager ? {} : { OR: [assigned, unassigned, shared] };
};

const closedStatuses = ['COMPLETED', 'WAIVED', 'CANCELLED'] as const;
const dutyOrder = [{ dueAt: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }] as const;
const normalizeHistorySearch = (value: string) => value.normalize('NFKC')
  .replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
  .replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\u200c/g, ' ').toLocaleLowerCase().trim();

const sourcePhase = {
  CONTRACT_DISPATCH: 'dutySourceContractDispatch',
  LOADING_CANCELLATION: 'dutySourceLoadingCancellation',
  PURCHASING_INQUIRY: 'dutySourcePurchasingInquiry',
  HR_WORK_ITEM: 'dutySourceHrWorkItem',
  SALES_CONTRACT_CORRECTION: 'dutySourceSalesCorrection',
  HR_HIRING_FINANCE: 'dutySourceHiringFinance',
  PARTNER_PRICING: 'dutySourcePartnerPricing',
} as const;

const readInbox = async (database: Database, input: DutyReadInput) => {
  const now = input.now ?? new Date();
  const workspaceCode = crossWorkspaceDutyDestinationCode(input.workspaceCode);
  const manager = await isManager(database, input.actorUserId, workspaceCode, now);
  const loadSource = createCrossWorkspaceDutySourceProjectionReader();
  const readSource: typeof loadSource = (db, source) => {
    const phase = Object.prototype.hasOwnProperty.call(sourcePhase, source.sourceType)
      ? sourcePhase[source.sourceType as keyof typeof sourcePhase]
      : 'dutySourceOther';
    return measureAccountingReadPhase(phase, () => loadSource(db, source));
  };

  const read = async (options: {
    view?: DutyView;
    summaryOnly?: boolean;
    updatedAfter?: Date;
    updatedThrough?: Date;
    search?: string;
    page?: { after?: string; size: number };
  }) => {
    const history = options.view === 'history';
    if (options.view === 'triage' && !manager) throw new Error('DUTY_MANAGER_TRIAGE_FORBIDDEN');
    const where: Prisma.CrossWorkspaceDutyWhereInput = {
      destinationWorkspaceCode: workspaceCode,
      status: history ? { in: [...closedStatuses] } : 'OPEN',
      ...(options.updatedAfter || options.updatedThrough ? {
        updatedAt: { gt: options.updatedAfter, lte: options.updatedThrough },
      } : {}),
      ...(!history ? activeCandidateWhere(input.actorUserId, manager, options.view) : {}),
    };
    // Only the requesting actor's former assignments can affect the redacted history fallback.
    const relations = {
      envelope: true,
      assignmentHistory: history && !manager
        ? { where: { assignedUserId: input.actorUserId }, select: { assignedUserId: true }, take: 1 }
        : false,
      auditVersions: history && !options.summaryOnly
        ? { orderBy: { version: 'asc' as const }, select: { version: true, eventCode: true, reason: true, createdAt: true } }
        : false,
    } as const;
    const findCandidates = (after?: string, batchSize?: number) => database.crossWorkspaceDuty.findMany({
      where,
      include: relations,
      // The first history page includes the most recent visible change so
      // opening it can advance the actor's receipt through the same cutoff.
      orderBy: options.page ? [{ updatedAt: 'desc' }, { id: 'asc' }] : [...dutyOrder],
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      take: batchSize,
    });
    type Candidate = Awaited<ReturnType<typeof findCandidates>>[number];
    const search = history ? normalizeHistorySearch((options.search ?? '').slice(0, 200)) : '';
    const authorize = async (duty: Candidate) => {
      try {
        const authorized = await authorizeLoadedDuty(
          database, duty, input.actorUserId, workspaceCode, now, manager, options.summaryOnly, readSource, options.view,
        );
        if (options.view && options.view !== 'history' && !matchesActiveView(authorized.access, options.view)) return null;
        return { duty, access: authorized.access, authorized };
      } catch {
        if (!history || definitionFor(duty.sourceActionCode)?.accountabilityModel === 'SHARED_DECISION') return null;
        if (!manager && !duty.assignmentHistory?.length) return null;
        return { duty, access: manager ? 'MANAGER_TRIAGE' as const : 'ASSIGNEE' as const, authorized: null };
      }
    };
    const project = (row: NonNullable<Awaited<ReturnType<typeof authorize>>>) => {
      const { duty, access, authorized } = row;
      const projected = projectCrossWorkspaceDuty({
        duty: authorized ? duty : { ...duty, structuredResultJson: null },
        source: authorized?.source ?? { title: '', description: null },
        resultActor: authorized?.resultActor,
        currentAssignee: authorized?.currentAssignee,
        accessProvenance: authorized?.accessProvenance,
        envelope: authorized ? duty.envelope : { allowedFieldsJson: [], allowedEvidenceJson: [], allowedActionCodesJson: [] },
        access,
        claimRequiresReason: authorized?.claimRequiresReason,
        responseRequiresReason: authorized?.responseRequiresReason,
        includeHistory: history,
        audit: authorized ? duty.auditVersions : duty.auditVersions?.map(event => ({ ...event, reason: null })),
        now,
      });
      projected.detailAvailable = Boolean(authorized);
      return projected;
    };

    const rows: Array<{ access: Access; dueAt: Date | null; updatedAt: Date }> = [];
    const duties: Array<ReturnType<typeof projectCrossWorkspaceDuty>> = [];
    const batchSize = options.page && options.page.size + 1;
    let after = options.page?.after;
    if (after) {
      const cursor = await database.crossWorkspaceDuty.findFirst({ where: { ...where, id: after }, include: relations });
      // A client-supplied cursor cannot reveal the position of a hidden record.
      if (!cursor || !await authorize(cursor)) return { duties, rows, nextCursor: null };
    }
    do {
      const candidates = await findCandidates(after, batchSize);
      countAccountingReadRows(history ? 'dutyHistoryCandidates' : 'dutyActiveCandidates', candidates.length);
      // Bound the provider reads while retaining the database ordering.
      for (let offset = 0; offset < candidates.length; offset += 4) {
        const batch = await Promise.all(candidates.slice(offset, offset + 4).map(authorize));
        for (const row of batch) {
          if (!row) continue;
          if (options.summaryOnly) {
            rows.push({ access: row.access, dueAt: row.duty.dueAt, updatedAt: row.duty.updatedAt });
            continue;
          }
          const duty = project(row);
          // Search only fields permitted by the envelope and current authorization.
          if (search && !normalizeHistorySearch([duty.fields.title, duty.fields.description].filter(Boolean).join(' ')).includes(search)) continue;
          if (options.page && duties.length === options.page.size) {
            return { duties, rows, nextCursor: duties[duties.length - 1].id };
          }
          duties.push(duty);
        }
      }
      after = batchSize && candidates.length === batchSize ? candidates[candidates.length - 1].id : undefined;
    } while (after);
    return { duties, rows, nextCursor: null };
  };
  return { workspaceCode, now, manager, read };
};

export const listCrossWorkspaceDuties = async (database: Database, input: DutyListInput) =>
  measureAccountingReadPhase(input.view === 'history' ? 'dutyHistoryList' : 'dutyActiveList', async () => (
    (await (await readInbox(database, input)).read(input)).duties
  ));

export const listCrossWorkspaceDutyHistoryPage = async (
  database: Database,
  input: DutyReadInput & { search?: string; after?: string },
) => measureAccountingReadPhase('dutyHistoryList', async () => {
  const { read } = await readInbox(database, input);
  const { duties, nextCursor } = await read({ view: 'history', search: input.search, page: { after: input.after, size: 50 } });
  return { duties, nextCursor };
});

export const getCrossWorkspaceDutySummary = async (database: Database, input: DutyReadInput) => {
  const { workspaceCode, now, manager, read } = await readInbox(database, input);
  const where = { userId_destinationWorkspaceCode: { userId: input.actorUserId, destinationWorkspaceCode: workspaceCode } };
  const select = { lastSeenAt: true } as const;
  const [active, availableReceipt, history] = await Promise.all([
    measureAccountingReadPhase('dutyActiveCounters', () => read({ summaryOnly: true })),
    database.crossWorkspaceDutyAvailableReceipt.findUnique({ where, select }),
    measureAccountingReadPhase('dutyHistoryCounters', async () => {
      const receipt = await database.crossWorkspaceDutyHistoryReceipt.findUnique({ where, select });
      return read({ view: 'history', summaryOnly: true, updatedAfter: receipt?.lastSeenAt });
    }),
  ]);
  const assigned = active.rows.filter(row => matchesActiveView(row.access, 'assigned'));
  const available = active.rows.filter(row => matchesActiveView(row.access, 'available'));
  const availableUnseen = available.filter(row => !availableReceipt || row.updatedAt > availableReceipt.lastSeenAt).length;
  const dueSoonThrough = now.getTime() + 24 * 60 * 60 * 1_000;
  return {
    open: assigned.length,
    available: available.length,
    availableUnseen,
    attention: assigned.length + availableUnseen,
    dueSoon: assigned.filter(row => row.dueAt && row.dueAt.getTime() <= dueSoonThrough).length,
    overdue: assigned.filter(row => row.dueAt && row.dueAt < now).length,
    triage: manager ? active.rows.filter(row => matchesActiveView(row.access, 'triage')).length : 0,
    historyUnseen: history.rows.length,
    canManageTriage: manager,
  };
};

export const markCrossWorkspaceDutyAvailableSeen = async (
  database: Database,
  input: { actorUserId: string; workspaceCode: string; seenThrough: Date; now?: Date },
) => {
  const now = input.now ?? new Date();
  const destinationWorkspaceCode = crossWorkspaceDutyDestinationCode(input.workspaceCode);
  const { read } = await readInbox(database, { ...input, now });
  const { rows } = await read({
    view: 'available', summaryOnly: true, updatedThrough: new Date(Math.min(input.seenThrough.getTime(), now.getTime())),
  });
  const visibleCutoff = rows.reduce<Date | null>((latest, { updatedAt }) => (
    !latest || updatedAt > latest ? updatedAt : latest
  ), null);
  if (!visibleCutoff) return { lastSeenAt: null };
  const receipts = await database.$queryRaw<Array<{ lastSeenAt: Date }>>(Prisma.sql`
    INSERT INTO "cross_workspace_duty_available_receipts"
      ("id", "userId", "destinationWorkspaceCode", "lastSeenAt", "createdAt", "updatedAt")
    VALUES
      (${randomUUID()}, ${input.actorUserId}, ${destinationWorkspaceCode}, ${visibleCutoff}, ${now}, ${now})
    ON CONFLICT ("userId", "destinationWorkspaceCode") DO UPDATE
    SET "lastSeenAt" = GREATEST(
      "cross_workspace_duty_available_receipts"."lastSeenAt",
      EXCLUDED."lastSeenAt"
    ),
    "updatedAt" = EXCLUDED."updatedAt"
    RETURNING "lastSeenAt"
  `);
  return { lastSeenAt: receipts[0]?.lastSeenAt ?? visibleCutoff };
};

export const markCrossWorkspaceDutyHistorySeen = async (
  database: Database,
  input: { actorUserId: string; workspaceCode: string; seenThrough: Date; now?: Date },
) => {
  const now = input.now ?? new Date();
  const destinationWorkspaceCode = crossWorkspaceDutyDestinationCode(input.workspaceCode);
  const { read } = await readInbox(database, { ...input, now });
  const { rows } = await read({
    view: 'history', summaryOnly: true, updatedThrough: new Date(Math.min(input.seenThrough.getTime(), now.getTime())),
  });
  const visibleCutoff = rows.reduce<Date | null>((latest, { updatedAt }) => (
    !latest || updatedAt > latest ? updatedAt : latest
  ), null);
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
