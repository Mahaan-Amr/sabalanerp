import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { activeHrActionPermissionsForUser } from './hrAuthorizationService';
import { publishNotificationEvent } from './notificationService';
import { canonicalPerformanceHash } from './personnelPerformancePolicy';
import { addTehranWorkingDays } from './tehranBusinessCalendar';
import { runPerformanceSerializableTransaction } from './personnelPerformancePolicyStore';

type Client = PrismaClient | Prisma.TransactionClient;
type OperationalRoute = 'SYSTEM_OWNER' | 'HUMAN_RESOURCES' | 'SECURITY_PRIVACY';
type HeartbeatComponent = 'METRIC' | 'DASHBOARD' | 'ALERT';
type OperationalScope = 'ALL' | 'COHORT';
type Severity = 'WARNING' | 'HIGH' | 'CRITICAL';

type MetricDefinition = {
  metricKey: string;
  denominator: string;
  samplingSeconds: number;
  retentionDays: number;
  dashboardKey: string;
  routeKey: OperationalRoute;
  p95Ms?: number;
  p99Ms?: number;
};

export const PERFORMANCE_OPERATIONAL_METRICS: readonly MetricDefinition[] = [
  { metricKey: 'BADGE_API_LATENCY', denominator: 'eligible badge projection reads', samplingSeconds: 300, retentionDays: 30, dashboardKey: 'performance-api-latency', routeKey: 'SYSTEM_OWNER', p95Ms: 200, p99Ms: 500 },
  { metricKey: 'AUTHORIZED_READ_API_LATENCY', denominator: 'authorized list, filter, and detail requests', samplingSeconds: 300, retentionDays: 30, dashboardKey: 'performance-api-latency', routeKey: 'SYSTEM_OWNER', p95Ms: 500, p99Ms: 1_000 },
  { metricKey: 'DRAFT_SAVE_API_LATENCY', denominator: 'accepted draft-save requests', samplingSeconds: 300, retentionDays: 30, dashboardKey: 'performance-api-latency', routeKey: 'SYSTEM_OWNER', p95Ms: 750, p99Ms: 1_500 },
  { metricKey: 'ATOMIC_TRANSITION_API_LATENCY', denominator: 'submit, accept, reject, and suspend requests', samplingSeconds: 300, retentionDays: 30, dashboardKey: 'performance-api-latency', routeKey: 'SYSTEM_OWNER', p95Ms: 1_000, p99Ms: 2_000 },
  { metricKey: 'ANALYTICS_API_LATENCY', denominator: 'authorized analytics and ranking requests', samplingSeconds: 300, retentionDays: 30, dashboardKey: 'performance-api-latency', routeKey: 'SYSTEM_OWNER', p95Ms: 1_500, p99Ms: 3_000 },
  { metricKey: 'BROWSER_USABLE_LATENCY', denominator: 'real-browser usable-page measurements', samplingSeconds: 300, retentionDays: 30, dashboardKey: 'performance-browser-latency', routeKey: 'SYSTEM_OWNER', p95Ms: 2_000, p99Ms: 3_000 },
  { metricKey: 'RESULT_REPRODUCTION_LATENCY', denominator: 'accepted result reproductions', samplingSeconds: 300, retentionDays: 30, dashboardKey: 'performance-calculation-latency', routeKey: 'SYSTEM_OWNER', p95Ms: 500, p99Ms: 1_000 },
  { metricKey: 'HTTP_5XX_RATE', denominator: 'all non-input performance HTTP requests', samplingSeconds: 300, retentionDays: 30, dashboardKey: 'performance-failure-rate', routeKey: 'SYSTEM_OWNER' },
  { metricKey: 'TIMEOUT_RATE', denominator: 'all performance operations', samplingSeconds: 300, retentionDays: 30, dashboardKey: 'performance-failure-rate', routeKey: 'SYSTEM_OWNER' },
  { metricKey: 'DATABASE_POOL_UTILIZATION', denominator: 'configured application connection-pool capacity', samplingSeconds: 300, retentionDays: 30, dashboardKey: 'performance-pool', routeKey: 'SYSTEM_OWNER' },
  { metricKey: 'EXPORT_QUEUE_AGE', denominator: 'queued performance export jobs', samplingSeconds: 300, retentionDays: 30, dashboardKey: 'performance-export-queue', routeKey: 'SYSTEM_OWNER' },
  { metricKey: 'EXPORT_JOB_FAILURE', denominator: 'performance export jobs attempted', samplingSeconds: 300, retentionDays: 30, dashboardKey: 'performance-export-queue', routeKey: 'SYSTEM_OWNER' },
  { metricKey: 'WORKFLOW_OVERDUE_RATE', denominator: 'open performance workflow items with an applicable SLA', samplingSeconds: 300, retentionDays: 30, dashboardKey: 'performance-workflow-overdue', routeKey: 'HUMAN_RESOURCES' },
  { metricKey: 'WORKFLOW_MAX_OVERDUE', denominator: 'overdue performance workflow items', samplingSeconds: 300, retentionDays: 30, dashboardKey: 'performance-workflow-overdue', routeKey: 'HUMAN_RESOURCES' },
  { metricKey: 'PERMISSION_DENIAL_RATE', denominator: 'all performance authorization decisions', samplingSeconds: 900, retentionDays: 30, dashboardKey: 'performance-security', routeKey: 'SECURITY_PRIVACY' },
] as const;

const definitions = new Map(PERFORMANCE_OPERATIONAL_METRICS.map((definition) => [definition.metricKey, definition]));
const openIncidentStatuses = ['OPEN', 'ACKNOWLEDGED', 'CONTAINED', 'ESCALATED'];
const error = (code: string, status = 409) => Object.assign(new Error('شواهد عملیاتی پایش عملکرد نامعتبر یا ناکافی است.'), { code, status });
const transaction = runPerformanceSerializableTransaction;
const validHash = (value: string) => /^[a-f0-9]{64}$/.test(value);
const validReasonCode = (value: string) => /^[A-Z][A-Z0-9_]{2,79}$/.test(value);
const addMinutes = (value: Date, minutes: number) => new Date(value.getTime() + minutes * 60_000);

export const configurePerformanceOperationalRoute = async (client: Client, input: {
  actorUserId: string; routeKey: OperationalRoute; recipientUserId: string; verifiedAt: Date; reason: string;
}) => transaction(client, async (tx) => {
  if (!['SYSTEM_OWNER', 'HUMAN_RESOURCES', 'SECURITY_PRIVACY'].includes(input.routeKey)
    || !input.recipientUserId || !Number.isFinite(input.verifiedAt.getTime()) || input.reason.trim().length < 8) {
    throw error('PERFORMANCE_OPERATIONAL_ROUTE_INVALID', 422);
  }
  const permissions = await activeHrActionPermissionsForUser(tx, input.actorUserId, input.verifiedAt);
  if (!permissions.includes('MANAGE_PERFORMANCE_ROLLOUT')) throw error('PERFORMANCE_OPERATIONAL_ROUTE_PERMISSION_REQUIRED', 403);
  const recipient = await tx.user.findUnique({ where: { id: input.recipientUserId }, select: { id: true, isActive: true } });
  if (!recipient?.isActive) throw error('PERFORMANCE_OPERATIONAL_ROUTE_RECIPIENT_INVALID', 422);
  const route = await tx.performanceOperationalRoute.upsert({ where: { routeKey: input.routeKey }, update: {
    recipientUserId: input.recipientUserId, verifiedAt: input.verifiedAt, configuredById: input.actorUserId, reason: input.reason.trim(),
  }, create: { routeKey: input.routeKey, recipientUserId: input.recipientUserId, verifiedAt: input.verifiedAt,
    configuredById: input.actorUserId, reason: input.reason.trim() } });
  const auditId = randomUUID();
  await tx.performanceAuditEvent.create({ data: { id: auditId, aggregateType: 'PERFORMANCE_OPERATIONAL_ROUTE', aggregateId: route.id,
    eventType: 'PERFORMANCE_OPERATIONAL_ROUTE_CONFIGURED', actorUserId: input.actorUserId,
    reason: 'EXPLICIT_OPERATIONAL_OWNER_ASSIGNMENT', authorityHash: canonicalPerformanceHash({ permission: 'MANAGE_PERFORMANCE_ROLLOUT', permissions: permissions.sort() }),
    eventHash: canonicalPerformanceHash({ auditId, routeKey: route.routeKey, recipientUserId: route.recipientUserId, verifiedAt: route.verifiedAt }) } });
  return route;
});

export const recordPerformanceOperationalHeartbeat = async (client: Client, input: {
  component: HeartbeatComponent; observedAt?: Date;
}) => transaction(client, async (tx) => {
  if (!['METRIC', 'DASHBOARD', 'ALERT'].includes(input.component)) throw error('PERFORMANCE_OPERATIONAL_HEARTBEAT_INVALID', 422);
  const observedAt = input.observedAt ?? new Date();
  if (!Number.isFinite(observedAt.getTime())) throw error('PERFORMANCE_OPERATIONAL_HEARTBEAT_INVALID', 422);
  return tx.performanceOperationalHeartbeat.upsert({ where: { component: input.component }, update: { observedAt },
    create: { component: input.component, observedAt } });
});

export const recordPerformanceRequestObservation = async (client: Client, input: {
  metricKey: string; durationMs: number; responseStatus: number; timedOut?: boolean; observedAt?: Date;
}) => {
  const definition = definitions.get(input.metricKey);
  if (!definition?.p95Ms || !Number.isInteger(input.durationMs) || input.durationMs < 0
    || !Number.isInteger(input.responseStatus) || input.responseStatus < 100 || input.responseStatus > 599) {
    throw error('PERFORMANCE_OPERATIONAL_REQUEST_OBSERVATION_INVALID', 422);
  }
  return client.performanceOperationalRequestObservation.create({ data: { metricKey: input.metricKey,
    durationMs: input.durationMs, responseStatus: input.responseStatus,
    authorizationDecision: [401, 403].includes(input.responseStatus) ? 'DENIED' : 'ALLOWED',
    timedOut: input.timedOut ?? [408, 504].includes(input.responseStatus), observedAt: input.observedAt ?? new Date() } });
};

type WindowInput = {
  metricKey: string; scope: OperationalScope; cohortVersionId?: string; windowStart: Date; windowEnd: Date;
  numerator: number; denominator: number; p95Ms?: number; p99Ms?: number; maxAgeSeconds?: number;
  baselineBps?: number; retryExhausted?: boolean;
};

const evaluateThreshold = async (tx: Prisma.TransactionClient, definition: MetricDefinition, input: WindowInput, measuredBps: number) => {
  if (definition.p95Ms !== undefined && definition.p99Ms !== undefined) {
    if ((input.p99Ms ?? 0) > definition.p99Ms) return { severity: 'HIGH' as const, code: 'P99_BUDGET_BREACH', pause: false };
    if ((input.p95Ms ?? 0) > definition.p95Ms) {
      const previous = await tx.performanceOperationalWindow.findMany({ where: { metricKey: input.metricKey, scope: input.scope,
        cohortVersionId: input.cohortVersionId ?? null, windowEnd: { lt: input.windowEnd } }, orderBy: { windowEnd: 'desc' }, take: 2 });
      const windows = [...previous].reverse();
      const consecutive = windows.length === 2 && windows.every((window, index) => window.p95Ms! > definition.p95Ms!
        && window.windowEnd.getTime() === input.windowStart.getTime() - (1 - index) * definition.samplingSeconds * 1_000);
      if (consecutive) return { severity: 'HIGH' as const, code: 'P95_THREE_CONSECUTIVE_WINDOWS', pause: false };
    }
    return null;
  }
  switch (input.metricKey) {
    case 'HTTP_5XX_RATE':
      if (measuredBps > 100) return { severity: 'CRITICAL' as const, code: 'HTTP_5XX_RATE_PAUSE', pause: true };
      if (measuredBps > 10) return { severity: 'HIGH' as const, code: 'HTTP_5XX_RATE_HIGH', pause: false };
      return null;
    case 'TIMEOUT_RATE': return measuredBps > 50 ? { severity: 'CRITICAL' as const, code: 'TIMEOUT_RATE_PAUSE', pause: true } : null;
    case 'DATABASE_POOL_UTILIZATION':
      if (measuredBps >= 8_500) return { severity: 'CRITICAL' as const, code: 'POOL_EXPANSION_BLOCKER', pause: false };
      if (measuredBps >= 7_500) return { severity: 'CRITICAL' as const, code: 'POOL_CRITICAL', pause: false };
      if (measuredBps >= 6_000) return { severity: 'WARNING' as const, code: 'POOL_WARNING', pause: false };
      return null;
    case 'EXPORT_QUEUE_AGE': return (input.maxAgeSeconds ?? 0) > 300 ? { severity: 'HIGH' as const, code: 'EXPORT_QUEUE_OVER_FIVE_MINUTES', pause: false } : null;
    case 'EXPORT_JOB_FAILURE': return input.retryExhausted ? { severity: 'HIGH' as const, code: 'EXPORT_RETRY_EXHAUSTED', pause: false } : null;
    case 'WORKFLOW_OVERDUE_RATE': return measuredBps > 500 ? { severity: 'WARNING' as const, code: 'WORKFLOW_OVERDUE_OVER_FIVE_PERCENT', pause: false } : null;
    case 'WORKFLOW_MAX_OVERDUE': return (input.maxAgeSeconds ?? 0) > 8 * 60 * 60 ? { severity: 'WARNING' as const, code: 'WORKFLOW_OVER_ONE_WORKING_DAY', pause: false } : null;
    case 'PERMISSION_DENIAL_RATE': return input.baselineBps !== undefined && measuredBps > input.baselineBps * 3
      ? { severity: 'WARNING' as const, code: 'PERMISSION_DENIAL_OVER_BASELINE', pause: false } : null;
    default: return null;
  }
};

const ensureAutomaticPause = async (tx: Prisma.TransactionClient, incident: { id: string; scope: string; cohortVersionId: string | null; thresholdCode: string }, observedAt: Date) => {
  await tx.$executeRaw`UPDATE performance_disclosure_revision SET revision = revision + 1 WHERE id = 1`;
  const phase = await tx.performanceFeaturePhaseVersion.findFirst({ where: { effectiveFrom: { lte: observedAt } },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }], select: { id: true } });
  if (!phase) throw error('PERFORMANCE_OPERATIONAL_PAUSE_PHASE_MISSING');
  const existing = await tx.performanceSafetyPause.findFirst({ where: { status: 'ACTIVE', scope: incident.scope,
    cohortVersionId: incident.cohortVersionId } });
  const pause = existing ?? await tx.performanceSafetyPause.create({ data: { phaseVersionId: phase.id,
    scope: incident.scope, cohortVersionId: incident.cohortVersionId, reasonCode: incident.thresholdCode,
    reason: 'پایش خودکار عملکرد از مرز توقف ایمن عبور کرد.',
    startedByUserId: null, startedAt: observedAt, sourceIncidentId: incident.id } });
  await tx.performanceOperationalIncident.update({ where: { id: incident.id }, data: { safetyPauseId: pause.id } });
  if (!existing) {
    const auditId = randomUUID();
    await tx.performanceAuditEvent.create({ data: { id: auditId, aggregateType: 'PERFORMANCE_SAFETY_PAUSE', aggregateId: pause.id,
      eventType: 'PERFORMANCE_OPERATIONAL_SAFETY_PAUSE_STARTED', actorUserId: null, reason: incident.thresholdCode,
      authorityHash: canonicalPerformanceHash({ system: 'PERSONNEL_PERFORMANCE_MONITOR', incidentId: incident.id }),
      eventHash: canonicalPerformanceHash({ auditId, incidentId: incident.id, pauseId: pause.id, scope: pause.scope, cohortVersionId: pause.cohortVersionId }) } });
  }
  return pause;
};

const openOrUpdateIncident = async (tx: Prisma.TransactionClient, input: {
  category: string; metricKey?: string; routeKey: OperationalRoute; scope: OperationalScope; cohortVersionId?: string;
  severity: Severity; thresholdCode: string; observedAt: Date; pause: boolean;
}) => {
  const existing = await tx.performanceOperationalIncident.findFirst({ where: { category: input.category,
    metricKey: input.metricKey ?? null, scope: input.scope, cohortVersionId: input.cohortVersionId ?? null,
    status: { in: openIncidentStatuses } }, orderBy: { firstObservedAt: 'asc' } });
  const critical = input.severity === 'CRITICAL';
  const high = input.severity === 'HIGH';
  const deadlines = { acknowledgeDueAt: addMinutes(input.observedAt, critical ? 5 : high ? 15 : 60),
    containmentDueAt: critical ? addMinutes(input.observedAt, 15) : null,
    escalationDueAt: high ? addMinutes(input.observedAt, 60) : null };
  let incident = existing ? await tx.performanceOperationalIncident.update({ where: { id: existing.id }, data: {
    lastObservedAt: input.observedAt, occurrenceCount: { increment: 1 },
    ...(existing.severity === 'WARNING' && input.severity !== 'WARNING' ? { severity: input.severity, ...deadlines } : {}),
  } }) : await tx.performanceOperationalIncident.create({ data: { deduplicationKey: canonicalPerformanceHash({
    category: input.category, metricKey: input.metricKey, scope: input.scope, cohortVersionId: input.cohortVersionId, firstObservedAt: input.observedAt,
  }), category: input.category, metricKey: input.metricKey, routeKey: input.routeKey, scope: input.scope,
  cohortVersionId: input.cohortVersionId, severity: input.severity, thresholdCode: input.thresholdCode,
  firstObservedAt: input.observedAt, lastObservedAt: input.observedAt, ...deadlines } });
  if (input.pause && !incident.safetyPauseId) {
    const pause = await ensureAutomaticPause(tx, incident, input.observedAt);
    incident = await tx.performanceOperationalIncident.findUniqueOrThrow({ where: { id: incident.id } });
    if (incident.safetyPauseId !== pause.id) throw error('PERFORMANCE_OPERATIONAL_PAUSE_RACE');
  }
  if (!existing) {
    const route = await tx.performanceOperationalRoute.findUnique({ where: { routeKey: input.routeKey } });
    if (route) await publishNotificationEvent(tx, { type: 'PERFORMANCE_OPERATIONAL_ALERT',
      deduplicationKey: `performance-operational-alert:${incident.id}`, recipientIds: [route.recipientUserId],
      actorId: null, workspace: 'hr', feature: 'PERSONNEL_PERFORMANCE', resourceType: 'PERFORMANCE_OPERATIONAL_INCIDENT',
      resourceId: incident.id, actionUrl: '/dashboard/hr/performance/operations', payload: {} });
  }
  return incident;
};

export const recordPerformanceOperationalWindow = async (client: Client, input: WindowInput) => transaction(client, async (tx) => {
  const definition = definitions.get(input.metricKey);
  const duration = input.windowEnd.getTime() - input.windowStart.getTime();
  if (!definition || !['ALL', 'COHORT'].includes(input.scope) || (input.scope === 'COHORT' && !input.cohortVersionId)
    || (input.scope === 'ALL' && input.cohortVersionId !== undefined) || duration !== definition?.samplingSeconds * 1_000
    || !Number.isInteger(input.numerator) || input.numerator < 0 || !Number.isInteger(input.denominator) || input.denominator <= 0
    || input.numerator > input.denominator) throw error('PERFORMANCE_OPERATIONAL_WINDOW_INVALID', 422);
  const measuredBps = Math.round(input.numerator * 10_000 / input.denominator);
  const threshold = await evaluateThreshold(tx, definition, input, measuredBps);
  const existing = await tx.performanceOperationalWindow.findFirst({ where: { metricKey: input.metricKey, scope: input.scope,
    cohortVersionId: input.cohortVersionId ?? null, windowStart: input.windowStart, windowEnd: input.windowEnd } });
  const window = existing ? await tx.performanceOperationalWindow.update({ where: { id: existing.id }, data: {
    numerator: input.numerator, denominator: input.denominator, p95Ms: input.p95Ms, p99Ms: input.p99Ms,
    maxAgeSeconds: input.maxAgeSeconds, baselineBps: input.baselineBps, retryExhausted: input.retryExhausted ?? false,
    measuredBps, thresholdState: threshold?.code ?? 'HEALTHY',
  } }) : await tx.performanceOperationalWindow.create({ data: { metricKey: input.metricKey, scope: input.scope,
    cohortVersionId: input.cohortVersionId, windowStart: input.windowStart, windowEnd: input.windowEnd,
    numerator: input.numerator, denominator: input.denominator, p95Ms: input.p95Ms, p99Ms: input.p99Ms,
    maxAgeSeconds: input.maxAgeSeconds, baselineBps: input.baselineBps, retryExhausted: input.retryExhausted ?? false,
    measuredBps, thresholdState: threshold?.code ?? 'HEALTHY' } });
  const incident = threshold ? await openOrUpdateIncident(tx, { category: threshold.code, metricKey: input.metricKey,
    routeKey: definition.routeKey, scope: input.scope, cohortVersionId: input.cohortVersionId,
    severity: threshold.severity, thresholdCode: threshold.code, observedAt: input.windowEnd, pause: threshold.pause }) : null;
  return { window, incident };
});

export const recordPerformanceIntegrityIncident = async (client: Client, input: {
  category: 'CONFIDENTIALITY' | 'AUTHORITY' | 'RESULT_INTEGRITY' | 'LINEAGE' | 'AUDIT' | 'RETENTION' | 'EXPORT_SCOPE' | 'POST_PAUSE_WRITE' | 'COHORT_BYPASS';
  scope: OperationalScope; cohortVersionId?: string; observedAt?: Date;
}) => transaction(client, async (tx) => {
  const routeKey: OperationalRoute = input.category === 'CONFIDENTIALITY' || input.category === 'AUTHORITY' || input.category === 'COHORT_BYPASS'
    ? 'SECURITY_PRIVACY' : 'SYSTEM_OWNER';
  return openOrUpdateIncident(tx, { ...input, routeKey, severity: 'CRITICAL', thresholdCode: `INTEGRITY_${input.category}`,
    observedAt: input.observedAt ?? new Date(), pause: true });
});

const integrityFailureCategories = new Map<string, Parameters<typeof recordPerformanceIntegrityIncident>[1]['category']>([
  ['PERFORMANCE_OPERATIONAL_INTEGRITY_CONFIDENTIALITY', 'CONFIDENTIALITY'],
  ['PERFORMANCE_OPERATIONAL_INTEGRITY_AUTHORITY', 'AUTHORITY'],
  ['PERFORMANCE_OPERATIONAL_INTEGRITY_RESULT', 'RESULT_INTEGRITY'],
  ['PERFORMANCE_POLICY_PREVIEW_HASH_MISMATCH', 'RESULT_INTEGRITY'],
  ['PERFORMANCE_EXPORT_INTEGRITY_FAILED', 'RESULT_INTEGRITY'],
  ['PERFORMANCE_OPERATIONAL_INTEGRITY_LINEAGE', 'LINEAGE'],
  ['PERFORMANCE_EXPORT_LINEAGE_UNVERIFIED', 'LINEAGE'],
  ['PERFORMANCE_OPERATIONAL_INTEGRITY_AUDIT', 'AUDIT'],
  ['PERFORMANCE_OPERATIONAL_INTEGRITY_RETENTION', 'RETENTION'],
  ['PERFORMANCE_ERASURE_RETENTION_DRIFT', 'RETENTION'],
  ['PERFORMANCE_RETENTION_DEPENDENCY_UNVERIFIED', 'RETENTION'],
  ['PERFORMANCE_OPERATIONAL_INTEGRITY_EXPORT_SCOPE', 'EXPORT_SCOPE'],
  ['PERFORMANCE_OPERATIONAL_INTEGRITY_POST_PAUSE_WRITE', 'POST_PAUSE_WRITE'],
  ['PERFORMANCE_OPERATIONAL_INTEGRITY_COHORT_BYPASS', 'COHORT_BYPASS'],
]);

export const classifyPerformanceIntegrityFailure = (failure: unknown) => {
  const detail = failure && typeof failure === 'object'
    ? failure as { code?: unknown; message?: unknown; meta?: { message?: unknown } }
    : {};
  const candidates = [detail.code, detail.message, detail.meta?.message].filter((value): value is string => typeof value === 'string');
  for (const [code, category] of integrityFailureCategories) {
    if (candidates.some((candidate) => candidate === code || candidate.includes(code))) return category;
  }
  return null;
};

export const recordPerformanceIntegrityFailure = async (client: Client, failure: unknown, observedAt = new Date()) => {
  const category = classifyPerformanceIntegrityFailure(failure);
  if (!category) return null;
  const cohortScoped = category === 'POST_PAUSE_WRITE' || category === 'COHORT_BYPASS';
  const phase = cohortScoped ? await client.performanceFeaturePhaseVersion.findFirst({ where: {
    effectiveFrom: { lte: observedAt }, releaseEnabled: true, cohortVersionId: { not: null },
  }, orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }], select: { cohortVersionId: true } }) : null;
  return recordPerformanceIntegrityIncident(client, { category,
    scope: phase?.cohortVersionId ? 'COHORT' : 'ALL', cohortVersionId: phase?.cohortVersionId ?? undefined, observedAt });
};

export const recordPerformanceMaintenanceFailure = async (client: Client, input: { operationCode: string; observedAt?: Date }) =>
  transaction(client, async (tx) => {
    if (!/^[A-Z][A-Z0-9_]{2,79}$/.test(input.operationCode)) throw error('PERFORMANCE_MAINTENANCE_FAILURE_INVALID', 422);
    return openOrUpdateIncident(tx, { category: 'MAINTENANCE_FAILURE', metricKey: undefined, routeKey: 'SYSTEM_OWNER',
      scope: 'ALL', severity: 'HIGH', thresholdCode: input.operationCode, observedAt: input.observedAt ?? new Date(), pause: false });
  });

export const acknowledgePerformanceOperationalIncident = async (client: Client, input: {
  actorUserId: string; incidentId: string; action: 'ACKNOWLEDGE' | 'CONTAIN' | 'ESCALATE' | 'RESOLVE';
  reasonCode: string; evidenceHash: string; now?: Date;
}) => transaction(client, async (tx) => {
  if (!validReasonCode(input.reasonCode) || !validHash(input.evidenceHash)) throw error('PERFORMANCE_OPERATIONAL_INCIDENT_ACTION_INVALID', 422);
  const incident = await tx.performanceOperationalIncident.findUnique({ where: { id: input.incidentId } });
  if (!incident || incident.status === 'RESOLVED') throw error('PERFORMANCE_OPERATIONAL_INCIDENT_UNAVAILABLE', 404);
  const route = await tx.performanceOperationalRoute.findUnique({ where: { routeKey: incident.routeKey } });
  if (!route || route.recipientUserId !== input.actorUserId) throw error('PERFORMANCE_OPERATIONAL_INCIDENT_OWNER_REQUIRED', 403);
  const now = input.now ?? new Date();
  const next = ({ ACKNOWLEDGE: 'ACKNOWLEDGED', CONTAIN: 'CONTAINED', ESCALATE: 'ESCALATED', RESOLVE: 'RESOLVED' } as const)[input.action];
  if (input.action === 'RESOLVE' && !['CONTAINED', 'ESCALATED'].includes(incident.status)) throw error('PERFORMANCE_OPERATIONAL_INCIDENT_CONTAINMENT_REQUIRED');
  if (input.action === 'RESOLVE' && incident.safetyPauseId) {
    const pause = await tx.performanceSafetyPause.findUnique({ where: { id: incident.safetyPauseId }, select: { status: true } });
    if (pause?.status === 'ACTIVE') throw error('PERFORMANCE_OPERATIONAL_INCIDENT_RESUME_REQUIRED');
  }
  const updated = await tx.performanceOperationalIncident.update({ where: { id: incident.id }, data: { status: next,
    ...(input.action === 'ACKNOWLEDGE' ? { acknowledgedAt: now } : {}), ...(input.action === 'CONTAIN' ? { containedAt: now } : {}),
    ...(input.action === 'ESCALATE' ? { escalatedAt: now } : {}), ...(input.action === 'RESOLVE' ? { resolvedAt: now } : {}) } });
  await tx.performanceOperationalIncidentEvidence.create({ data: { incidentId: incident.id, action: input.action,
    actorUserId: input.actorUserId, reasonCode: input.reasonCode, evidenceHash: input.evidenceHash, recordedAt: now } });
  const auditId = randomUUID();
  await tx.performanceAuditEvent.create({ data: { id: auditId, aggregateType: 'PERFORMANCE_OPERATIONAL_INCIDENT', aggregateId: incident.id,
    eventType: `PERFORMANCE_OPERATIONAL_INCIDENT_${input.action}`, actorUserId: input.actorUserId, reason: input.reasonCode,
    authorityHash: canonicalPerformanceHash({ routeKey: incident.routeKey, recipientUserId: route.recipientUserId }),
    eventHash: canonicalPerformanceHash({ auditId, incidentId: incident.id, action: input.action, evidenceHash: input.evidenceHash, at: now }) } });
  return updated;
});

export const getPerformanceOperationalDashboard = async (client: Client, now = new Date()) => {
  const [routes, heartbeats, phase, openIncidents, activePauses, recentWindows] = await Promise.all([
    client.performanceOperationalRoute.findMany({ select: { routeKey: true, recipientUserId: true, verifiedAt: true } }),
    client.performanceOperationalHeartbeat.findMany(),
    client.performanceFeaturePhaseVersion.findFirst({ where: { effectiveFrom: { lte: now } }, orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
      select: { releaseEnabled: true, cohortVersionId: true, effectiveFrom: true } }),
    client.performanceOperationalIncident.findMany({ where: { status: { in: openIncidentStatuses } }, orderBy: [{ severity: 'desc' }, { firstObservedAt: 'asc' }] }),
    client.performanceSafetyPause.findMany({ where: { status: 'ACTIVE' }, select: { id: true, scope: true, cohortVersionId: true, reasonCode: true, startedAt: true } }),
    client.performanceOperationalWindow.findMany({ orderBy: { windowEnd: 'desc' }, take: PERFORMANCE_OPERATIONAL_METRICS.length * 2 }),
  ]);
  const requiredRoutes: OperationalRoute[] = ['SYSTEM_OWNER', 'HUMAN_RESOURCES', 'SECURITY_PRIVACY'];
  const routeByKey = new Map(routes.map((route) => [route.routeKey, route]));
  const heartbeatByComponent = new Map(heartbeats.map((heartbeat) => [heartbeat.component, heartbeat]));
  const heartbeatCutoff = new Date(now.getTime() - 5 * 60_000);
  const missingHeartbeats = (['METRIC', 'DASHBOARD', 'ALERT'] as HeartbeatComponent[])
    .filter((component) => !heartbeatByComponent.get(component) || heartbeatByComponent.get(component)!.observedAt < heartbeatCutoff);
  const hypercare = Boolean(phase?.releaseEnabled && phase.cohortVersionId && phase.effectiveFrom <= now
    && addTehranWorkingDays(phase.effectiveFrom, 5) > now);
  const blockers = new Set<string>();
  if (requiredRoutes.some((key) => !routeByKey.has(key))) blockers.add('PERFORMANCE_OPERATIONAL_OWNER_MISSING');
  if (hypercare && missingHeartbeats.length) blockers.add('PERFORMANCE_OPERATIONAL_HEARTBEAT_MISSING');
  if (openIncidents.some((incident) => ['HIGH', 'CRITICAL'].includes(incident.severity))) blockers.add('PERFORMANCE_OPERATIONAL_INCIDENT_OPEN');
  if (openIncidents.some((incident) => incident.thresholdCode === 'POOL_EXPANSION_BLOCKER')) blockers.add('PERFORMANCE_POOL_EXPANSION_BLOCKER');
  if (activePauses.length) blockers.add('PERFORMANCE_SAFETY_PAUSED');
  return { generatedAt: now, hypercare, expansionAllowed: blockers.size === 0, expansionBlockers: [...blockers].sort(), missingHeartbeats,
    metricDefinitions: PERFORMANCE_OPERATIONAL_METRICS, routeConfiguration: requiredRoutes.map((routeKey) => ({ routeKey,
      configured: routeByKey.has(routeKey), verifiedAt: routeByKey.get(routeKey)?.verifiedAt ?? null })),
    heartbeats: (['METRIC', 'DASHBOARD', 'ALERT'] as HeartbeatComponent[]).map((component) => ({ component,
      observedAt: heartbeatByComponent.get(component)?.observedAt ?? null })), openIncidents, activePauses, recentWindows };
};

export const assertPerformanceOperationalExpansionReady = async (client: Client, now = new Date()) => {
  const dashboard = await getPerformanceOperationalDashboard(client, now);
  if (!dashboard.expansionAllowed) throw error(dashboard.expansionBlockers[0]);
  return dashboard;
};

export const detectMissingPerformanceOperationalHeartbeats = async (client: Client, now = new Date()) => transaction(client, async (tx) => {
  const dashboard = await getPerformanceOperationalDashboard(tx, now);
  if (!dashboard.hypercare || !dashboard.missingHeartbeats.length) return { incidents: [] };
  const incidents: string[] = [];
  for (const component of dashboard.missingHeartbeats) incidents.push((await openOrUpdateIncident(tx, {
    category: 'HEARTBEAT_MISSING', metricKey: component, routeKey: 'SYSTEM_OWNER', scope: 'ALL', severity: 'HIGH',
    thresholdCode: `HEARTBEAT_${component}_MISSING`, observedAt: now, pause: false,
  })).id);
  return { incidents };
});

export const purgeExpiredPerformanceOperationalWindows = async (client: Client, now = new Date()) => {
  const oldestRetentionDays = Math.max(...PERFORMANCE_OPERATIONAL_METRICS.map(({ retentionDays }) => retentionDays));
  const cutoff = new Date(now.getTime() - oldestRetentionDays * 86_400_000);
  const [windows, requestObservations] = await Promise.all([
    client.performanceOperationalWindow.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    client.performanceOperationalRequestObservation.deleteMany({ where: { observedAt: { lt: cutoff } } }),
  ]);
  return { windows: windows.count, requestObservations: requestObservations.count };
};

export const escalateOverduePerformanceOperationalIncidents = async (client: Client, now = new Date()) => transaction(client, async (tx) => {
  const overdue = await tx.performanceOperationalIncident.findMany({ where: { status: { in: ['OPEN', 'ACKNOWLEDGED'] }, OR: [
    { containmentDueAt: { lt: now } }, { escalationDueAt: { lt: now } }, { acknowledgeDueAt: { lt: now } },
  ] } });
  for (const incident of overdue) {
    const route = await tx.performanceOperationalRoute.findUnique({ where: { routeKey: incident.routeKey } });
    await tx.performanceOperationalIncident.update({ where: { id: incident.id }, data: { status: 'ESCALATED', escalatedAt: now } });
    const evidenceHash = canonicalPerformanceHash({ system: 'PERSONNEL_PERFORMANCE_MONITOR', incidentId: incident.id,
      reasonCode: 'AUTO_RESPONSE_DEADLINE_EXCEEDED', recordedAt: now });
    await tx.performanceOperationalIncidentEvidence.create({ data: { incidentId: incident.id, action: 'ESCALATE', actorUserId: null,
      reasonCode: 'AUTO_RESPONSE_DEADLINE_EXCEEDED', evidenceHash, recordedAt: now } });
    const auditId = randomUUID();
    await tx.performanceAuditEvent.create({ data: { id: auditId, aggregateType: 'PERFORMANCE_OPERATIONAL_INCIDENT', aggregateId: incident.id,
      eventType: 'PERFORMANCE_OPERATIONAL_INCIDENT_ESCALATE', actorUserId: null, reason: 'AUTO_RESPONSE_DEADLINE_EXCEEDED',
      authorityHash: canonicalPerformanceHash({ system: 'PERSONNEL_PERFORMANCE_MONITOR', routeKey: incident.routeKey }),
      eventHash: canonicalPerformanceHash({ auditId, incidentId: incident.id, evidenceHash, at: now }) } });
    if (route) await publishNotificationEvent(tx, { type: 'PERFORMANCE_OPERATIONAL_ALERT',
      deduplicationKey: `performance-operational-overdue:${incident.id}`, recipientIds: [route.recipientUserId],
      workspace: 'hr', feature: 'PERSONNEL_PERFORMANCE', resourceType: 'PERFORMANCE_OPERATIONAL_INCIDENT',
      resourceId: incident.id, actionUrl: '/dashboard/hr/performance/operations', payload: {} });
  }
  return { escalated: overdue.length };
});

export const runPerformanceOperationalMonitoring = async (client: PrismaClient, now = new Date()) => {
  const heartbeatDetection = await detectMissingPerformanceOperationalHeartbeats(client, now);
  const intervalMs = 5 * 60_000;
  const windowEnd = new Date(Math.floor(now.getTime() / intervalMs) * intervalMs);
  const windowStart = new Date(windowEnd.getTime() - intervalMs);
  const phase = await client.performanceFeaturePhaseVersion.findFirst({ where: { effectiveFrom: { lte: windowEnd },
    releaseEnabled: true }, orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
    select: { cohortVersionId: true } });
  const scope = phase?.cohortVersionId ? 'COHORT' as const : 'ALL' as const;
  const cohortVersionId = phase?.cohortVersionId ?? undefined;
  const observations = await client.performanceOperationalRequestObservation.findMany({ where: {
    observedAt: { gt: windowStart, lte: windowEnd },
  }, orderBy: { durationMs: 'asc' } });
  const percentile = (values: number[], percentileRank: number) => values[Math.max(0, Math.ceil(values.length * percentileRank) - 1)];
  for (const definition of PERFORMANCE_OPERATIONAL_METRICS.filter((metric) => metric.p95Ms !== undefined)) {
    const durations = observations.filter(({ metricKey }) => metricKey === definition.metricKey).map(({ durationMs }) => durationMs);
    if (!durations.length) continue;
    await recordPerformanceOperationalWindow(client, { metricKey: definition.metricKey, scope, cohortVersionId,
      windowStart, windowEnd, numerator: durations.length, denominator: durations.length,
      p95Ms: percentile(durations, 0.95), p99Ms: percentile(durations, 0.99) });
  }
  const nonInputRequests = observations.filter(({ responseStatus }) => responseStatus < 400 || responseStatus >= 500);
  if (nonInputRequests.length) await recordPerformanceOperationalWindow(client, { metricKey: 'HTTP_5XX_RATE', scope, cohortVersionId,
    windowStart, windowEnd, numerator: nonInputRequests.filter(({ responseStatus }) => responseStatus >= 500).length,
    denominator: nonInputRequests.length });
  if (observations.length) await recordPerformanceOperationalWindow(client, { metricKey: 'TIMEOUT_RATE', scope, cohortVersionId,
    windowStart, windowEnd, numerator: observations.filter(({ timedOut }) => timedOut).length, denominator: observations.length });
  const permissionIntervalMs = 15 * 60_000;
  const permissionWindowEnd = new Date(Math.floor(now.getTime() / permissionIntervalMs) * permissionIntervalMs);
  const permissionWindowStart = new Date(permissionWindowEnd.getTime() - permissionIntervalMs);
  const permissionObservations = await client.performanceOperationalRequestObservation.findMany({ where: {
    observedAt: { gt: permissionWindowStart, lte: permissionWindowEnd },
  }, select: { authorizationDecision: true } });
  if (permissionObservations.length) {
    const previous = await client.performanceOperationalWindow.findFirst({ where: { metricKey: 'PERMISSION_DENIAL_RATE',
      scope, cohortVersionId: cohortVersionId ?? null, windowEnd: { lt: permissionWindowEnd } }, orderBy: { windowEnd: 'desc' } });
    await recordPerformanceOperationalWindow(client, { metricKey: 'PERMISSION_DENIAL_RATE', scope, cohortVersionId,
      windowStart: permissionWindowStart, windowEnd: permissionWindowEnd,
      numerator: permissionObservations.filter(({ authorizationDecision }) => authorizationDecision === 'DENIED').length,
      denominator: permissionObservations.length, baselineBps: previous?.measuredBps ?? undefined });
  }
  const sections = await client.performanceEvaluationSection.findMany({ where: { OR: [
    { status: { in: ['DRAFT', 'REJECTED'] }, submissionDueAt: { not: null } },
    { status: 'SUBMITTED', reviewDueAt: { not: null } },
  ] }, select: { status: true, submissionDueAt: true, reviewDueAt: true } });
  const deadlines = sections.map((section) => section.status === 'SUBMITTED' ? section.reviewDueAt! : section.submissionDueAt!);
  const overdue = deadlines.filter((deadline) => deadline < windowEnd);
  const overOneWorkingDay = overdue.some((deadline) => addTehranWorkingDays(deadline, 1) < windowEnd);
  await recordPerformanceOperationalWindow(client, { metricKey: 'WORKFLOW_OVERDUE_RATE', scope, cohortVersionId,
    windowStart, windowEnd, numerator: overdue.length, denominator: Math.max(sections.length, 1) });
  await recordPerformanceOperationalWindow(client, { metricKey: 'WORKFLOW_MAX_OVERDUE', scope, cohortVersionId,
    windowStart, windowEnd, numerator: overdue.length ? 1 : 0, denominator: 1,
    maxAgeSeconds: overOneWorkingDay ? 8 * 60 * 60 + 1 : 0 });
  const exports = await client.performanceExportReceipt.findMany({ select: { status: true, requestedAt: true, attemptCount: true, failureCode: true } });
  const queued = exports.filter(({ status }) => status === 'QUEUED');
  const oldestQueueAge = queued.length ? Math.max(...queued.map(({ requestedAt }) => Math.floor((windowEnd.getTime() - requestedAt.getTime()) / 1_000))) : 0;
  await recordPerformanceOperationalWindow(client, { metricKey: 'EXPORT_QUEUE_AGE', scope, cohortVersionId,
    windowStart, windowEnd, numerator: queued.length, denominator: Math.max(queued.length, 1), maxAgeSeconds: Math.max(oldestQueueAge, 0) });
  const exhausted = exports.filter(({ status, attemptCount, failureCode }) => status === 'FAILED'
    && attemptCount >= 3 && failureCode === 'PERFORMANCE_EXPORT_RETRY_EXHAUSTED').length;
  await recordPerformanceOperationalWindow(client, { metricKey: 'EXPORT_JOB_FAILURE', scope, cohortVersionId,
    windowStart, windowEnd, numerator: exhausted, denominator: Math.max(exports.length, exhausted, 1), retryExhausted: exhausted > 0 });
  await recordPerformanceOperationalHeartbeat(client, { component: 'METRIC', observedAt: now });
  await getPerformanceOperationalDashboard(client, now);
  await recordPerformanceOperationalHeartbeat(client, { component: 'DASHBOARD', observedAt: now });
  await client.notificationOutbox.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } });
  await recordPerformanceOperationalHeartbeat(client, { component: 'ALERT', observedAt: now });
  const [incidentEscalation, retention] = await Promise.all([
    escalateOverduePerformanceOperationalIncidents(client, now),
    purgeExpiredPerformanceOperationalWindows(client, now),
  ]);
  return { heartbeatDetection, incidentEscalation, retention };
};
