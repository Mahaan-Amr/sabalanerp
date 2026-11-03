import { createHash, randomUUID } from 'node:crypto';
import { DispatchCutoverActionType, DispatchCutoverPhase, DispatchPilotApprovalRole, DispatchRehearsalStatus, DispatchRehearsalType,
  LegacyDispatchDisposition, Prisma, PrismaClient, SecurityDriverQueueTurnStatus } from '@prisma/client';
import { criticalFailureDisposition, validateLegacyDisposition, validateRehearsalGate } from './dispatchCutoverPolicy';
import { resolveNarrowFeatureAccess } from './narrowFeatureAccess';
import { listDispatchCases } from './dispatchCaseTimeline';

type Tx = Prisma.TransactionClient;
const CONTROL_ID = 'dispatch';
const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Prisma.Decimal) return value.toFixed(3);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
};
const json = (value: unknown) => stable(value) as Prisma.InputJsonValue;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const required = (value: unknown, name: string) => {
  const text = String(value || '').trim();
  if (!text) throw new DispatchCutoverValidationError(`${name} is required.`);
  return text;
};
const serializable = <T>(prisma: PrismaClient, work: (tx: Tx) => Promise<T>) =>
  prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
const lock = (tx: Tx) => tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', 'DISPATCH_CUTOVER');
const lockLegacyDispatchTables = (tx: Tx) => tx.$executeRawUnsafe(`LOCK TABLE
  "security_vehicle_pairs", "security_vehicle_pair_photos", "security_driver_queue_turns",
  "logistics_loading_driver_assignments", "logistics_loading_driver_allocations"
  IN SHARE ROW EXCLUSIVE MODE`);
const permissionMatrix = [
  ['hr', 'hr', 'hr_internal_drivers_view', 'hr'],
  ['vehicle-operations', 'hr', 'hr_vehicle_operations_view', 'vehicleOperations'],
  ['security', 'security', 'security_dispatch_evidence_view', 'guard'],
  ['logistics', 'logistics', 'logistics_loadings_view', 'logistics'],
  ['accounting', 'accounting', 'accounting_dispatch_candidates_view', 'accounting'],
] as const;
type RehearsalOperators = Record<typeof permissionMatrix[number][3], string>;
type RunbookEvidence = { owner: string; supportContact: string; rollbackOwner: string; plannedDowntimeMinutes: number; observedDurationSeconds: number };

export class DispatchCutoverValidationError extends Error {}
export class DispatchCutoverConflictError extends Error {}
export class PilotSafetyPauseError extends Error {}

const control = (tx: Tx) => tx.dispatchCutoverControl.upsert({ where: { id: CONTROL_ID }, create: { id: CONTROL_ID }, update: {} });

const appendAction = async (tx: Tx, input: { actionType: DispatchCutoverActionType; payload: unknown; actorId: string; at?: Date }) => {
  const at = input.at || new Date();
  const previous = await tx.dispatchCutoverAction.findFirst({ where: { controlId: CONTROL_ID }, orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }] });
  const payload = stable(input.payload);
  const eventHash = digest({ controlId: CONTROL_ID, actionType: input.actionType, payload, actorId: input.actorId,
    recordedAt: at, previousHash: previous?.eventHash || null });
  return tx.dispatchCutoverAction.create({ data: { id: randomUUID(), controlId: CONTROL_ID, actionType: input.actionType,
    payload: json(payload), actorId: input.actorId, recordedAt: at, previousHash: previous?.eventHash || null, eventHash } });
};

export const getDispatchCutoverStatus = async (prisma: PrismaClient) => {
  const [state, rehearsals, actions] = await Promise.all([
    prisma.dispatchCutoverControl.upsert({ where: { id: CONTROL_ID }, create: { id: CONTROL_ID }, update: {} }),
    prisma.dispatchCutoverRehearsal.findMany({ orderBy: [{ performedAt: 'desc' }, { id: 'desc' }], take: 10 }),
    prisma.dispatchCutoverAction.findMany({ where: { controlId: CONTROL_ID }, orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }], take: 50 }),
  ]);
  return { state, rehearsals, actions };
};

export const recordLegacyDriverVehicleDisposition = (prisma: PrismaClient, input: {
  legacyPairId: string; disposition: LegacyDispatchDisposition; driverSource?: 'INTERNAL' | 'EXTERNAL' | null; driverId?: string | null;
  vehicleSource?: 'COMPANY' | 'EXTERNAL' | null; vehicleId?: string | null; reason: string; evidence: Record<string, unknown>;
  supersedesId?: string | null; actorId: string;
}) => serializable(prisma, async (tx) => {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `LEGACY_PAIR_DISPOSITION:${input.legacyPairId}`);
  const pair = await tx.securityVehiclePair.findUnique({ where: { id: input.legacyPairId } });
  if (!pair) throw new DispatchCutoverValidationError('Legacy combined driver-vehicle record was not found.');
  const normalized = validateLegacyDisposition({ disposition: input.disposition, driverSource: input.driverSource || null,
    driverId: input.driverId || null, vehicleSource: input.vehicleSource || null, vehicleId: input.vehicleId || null });
  if (normalized.disposition === 'LINKED') {
    const targetLocks = [
      `DISPATCH_TARGET:${normalized.driverSource}:${normalized.driverId}`,
      `DISPATCH_TARGET:${normalized.vehicleSource}:${normalized.vehicleId}`,
    ].sort();
    for (const targetLock of targetLocks) {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', targetLock);
    }
    const [driverExists, vehicleExists] = await Promise.all([
      normalized.driverSource === 'INTERNAL'
        ? tx.internalDriverProfile.count({ where: { id: normalized.driverId!, status: 'ACTIVE' } })
        : tx.externalDriver.count({ where: { id: normalized.driverId!, status: 'ACTIVE' } }),
      normalized.vehicleSource === 'COMPANY'
        ? tx.companyVehicle.count({ where: { id: normalized.vehicleId!, status: 'ACTIVE' } })
        : tx.externalVehicle.count({ where: { id: normalized.vehicleId!, status: 'ACTIVE' } }),
    ]);
    if (!driverExists || !vehicleExists) throw new DispatchCutoverValidationError('Explicit canonical mapping targets were not found.');
  }
  const latest = await tx.legacyDriverVehicleDisposition.findFirst({ where: { legacyPairId: pair.id }, orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }] });
  if (latest && input.supersedesId !== latest.id) throw new DispatchCutoverConflictError('A correction must explicitly supersede the latest append-only disposition.');
  if (!latest && input.supersedesId) throw new DispatchCutoverConflictError('There is no prior disposition to supersede.');
  const reviewedAt = new Date();
  const reason = required(input.reason, 'reason');
  const payload = { legacyPairId: pair.id, ...normalized, reason, evidence: input.evidence || {}, reviewedAt,
    reviewedBy: input.actorId, supersedesId: latest?.id || null };
  return tx.legacyDriverVehicleDisposition.create({ data: { id: randomUUID(), legacyPairId: pair.id,
    disposition: normalized.disposition, driverSource: normalized.driverSource, driverId: normalized.driverId,
    vehicleSource: normalized.vehicleSource, vehicleId: normalized.vehicleId, reason, evidence: json(input.evidence || {}),
    reviewedAt, reviewedBy: input.actorId, supersedesId: latest?.id || null, integrityHash: digest(payload) } });
});

const currentDispositionManifest = async (tx: Tx) => {
  const [pairs, decisions] = await Promise.all([
    tx.securityVehiclePair.findMany({ select: { id: true, nationalCode: true, vehiclePlate: true }, orderBy: { id: 'asc' } }),
    tx.legacyDriverVehicleDisposition.findMany({ orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }] }),
  ]);
  const current = new Map<string, typeof decisions[number]>();
  for (const decision of decisions) if (!current.has(decision.legacyPairId)) current.set(decision.legacyPairId, decision);
  const sourceReconciled = pairs.map((pair) => {
    const disposition = current.get(pair.id);
    return { legacyPairId: pair.id, legacySourceHash: digest(pair), dispositionId: disposition?.id || null,
      integrityHash: disposition?.integrityHash || null, disposition: disposition?.disposition || null,
      driverSource: disposition?.driverSource || null, driverId: disposition?.driverId || null,
      vehicleSource: disposition?.vehicleSource || null, vehicleId: disposition?.vehicleId || null };
  });
  const targetReconciled = [] as typeof sourceReconciled;
  let targetsValid = true;
  const linkedTargetLocks = sourceReconciled
    .filter((source) => source.disposition === LegacyDispatchDisposition.LINKED)
    .flatMap((source) => [
      `DISPATCH_TARGET:${source.driverSource}:${source.driverId}`,
      `DISPATCH_TARGET:${source.vehicleSource}:${source.vehicleId}`,
    ])
    .sort();
  for (const targetLock of linkedTargetLocks) {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', targetLock);
  }
  for (const source of sourceReconciled) {
    if (source.disposition !== LegacyDispatchDisposition.LINKED) { targetReconciled.push({ ...source }); continue; }
    const [driver, vehicle] = await Promise.all([
      source.driverSource === 'INTERNAL'
        ? tx.internalDriverProfile.findUnique({ where: { id: source.driverId! }, select: { id: true, status: true } })
        : tx.externalDriver.findUnique({ where: { id: source.driverId! }, select: { id: true, status: true } }),
      source.vehicleSource === 'COMPANY'
        ? tx.companyVehicle.findUnique({ where: { id: source.vehicleId! }, select: { id: true, status: true } })
        : tx.externalVehicle.findUnique({ where: { id: source.vehicleId! }, select: { id: true, status: true } }),
    ]);
    const valid = Boolean(driver?.status === 'ACTIVE' && vehicle?.status === 'ACTIVE');
    targetsValid = targetsValid && valid;
    targetReconciled.push(valid ? { ...source } : { ...source, driverId: null, vehicleId: null });
  }
  return { pairs, current, reconciled: sourceReconciled, targetReconciled, targetsValid,
    complete: pairs.every((pair) => current.has(pair.id)) && targetsValid };
};

const auditChainIsValid = (actions: any[]) => actions.every((action, index) => {
  const previousHash = index ? actions[index - 1].eventHash : null;
  return action.previousHash === previousHash && action.eventHash === digest({ controlId: action.controlId,
    actionType: action.actionType, payload: action.payload, actorId: action.actorId, recordedAt: action.recordedAt, previousHash });
});

const permissionEvidence = async (tx: Tx, operators: RehearsalOperators) => Promise.all(permissionMatrix.map(async ([caseWorkspace, workspace, feature, key]) => {
  const user = await tx.user.findUnique({ where: { id: operators[key] }, select: { id: true, role: true, isActive: true } });
  const access = user?.isActive ? await resolveNarrowFeatureAccess(tx as any, { userId: user.id, role: user.role,
    workspace, feature, requiredPermission: 'view' }) : { allowed: false, permissionLevel: null };
  let apiReadPassed = false;
  if (access.allowed) {
    try { apiReadPassed = Array.isArray(await listDispatchCases(tx as any, { workspace: caseWorkspace,
      permission: access.permissionLevel || 'view' }, {})); } catch { apiReadPassed = false; }
  }
  return { caseWorkspace, workspace, feature, operatorId: operators[key], active: Boolean(user?.isActive),
    role: user?.role || null, allowed: access.allowed, permission: access.permissionLevel || null, apiReadPassed };
}));

const queueEvidence = async (tx: Tx) => {
  const turns = await tx.securityDriverQueueTurn.findMany({ where: { status: { in: ['WAITING', 'ENTERED_LOADING_AREA', 'RESERVED'] } },
    orderBy: { id: 'asc' } });
  const assignments = await tx.logisticsLoadingDriverAssignment.findMany({ where: { queueTurnId: { in: turns.map((turn) => turn.id) } },
    include: { allocations: { orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } });
  return { turns, assignments, hash: digest({ turns: turns.map(turnSnapshot), assignments }) };
};

const restoreAssignments = async (tx: Tx, assignments: any[]) => {
  for (const assignment of assignments) {
    const { allocations = [], ...record } = assignment;
    await tx.logisticsLoadingDriverAssignment.create({ data: record });
    if (allocations.length) await tx.logisticsLoadingDriverAllocation.createMany({ data: allocations });
  }
};

export const runDispatchCutoverRehearsal = (prisma: PrismaClient, input: { rehearsalType: DispatchRehearsalType; actorId: string;
  operators: RehearsalOperators; runbook?: RunbookEvidence }) => serializable(prisma, async (tx) => {
  await lock(tx);
  await lockLegacyDispatchTables(tx);
  const state = await control(tx);
  if (state.phase !== DispatchCutoverPhase.PRE_CUTOVER && state.phase !== DispatchCutoverPhase.ROLLED_BACK) {
    throw new DispatchCutoverConflictError('Cutover rehearsals are available only while legacy writes are active.');
  }
  if (!input.operators || permissionMatrix.some(([, , , key]) => !input.operators[key])) {
    throw new DispatchCutoverValidationError('Rehearsal requires named HR, Vehicle Operations, Guard, Logistics and Accounting operators.');
  }
  if (new Set(Object.values(input.operators)).size !== permissionMatrix.length) {
    throw new DispatchCutoverValidationError('Rehearsal operators must be five distinct accountable users.');
  }
  if (input.rehearsalType === DispatchRehearsalType.TIMED_DRESS) {
    const runbook = input.runbook;
    if (!runbook || !required(runbook.owner, 'runbook owner') || !required(runbook.supportContact, 'support contact')
      || !required(runbook.rollbackOwner, 'rollback owner') || !Number.isFinite(runbook.plannedDowntimeMinutes)
      || runbook.plannedDowntimeMinutes < 0 || !Number.isFinite(runbook.observedDurationSeconds) || runbook.observedDurationSeconds <= 0) {
      throw new DispatchCutoverValidationError('Timed dress rehearsal requires accountable runbook, support, rollback and duration evidence.');
    }
  }
  const manifest = await currentDispositionManifest(tx);
  const [unsafeProjectionCount, initialQueue, finalizedLegacyTurns, actions, permissions] = await Promise.all([
    tx.shipmentQuantityProjection.count({ where: { health: { not: 'CURRENT' } } }),
    queueEvidence(tx),
    tx.securityDriverQueueTurn.findMany({ where: { status: 'DISPATCHED' }, select: { id: true, loadingId: true, dispatchedAt: true }, orderBy: { id: 'asc' } }),
    tx.dispatchCutoverAction.findMany({ where: { controlId: CONTROL_ID }, orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] }),
    permissionEvidence(tx, input.operators),
  ]);
  const rehearsalAt = new Date();
  for (const turn of initialQueue.turns) {
    await tx.securityDriverQueueTurn.update({ where: { id: turn.id }, data: { status: SecurityDriverQueueTurnStatus.OUT_OF_QUEUE,
      loadingId: null, driverRequestId: null, reservedAt: null, reservedBy: null, reservedPosition: null,
      removedAt: rehearsalAt, removedBy: input.actorId, removalReason: 'Reversible dispatch cutover rehearsal' } });
  }
  if (initialQueue.assignments.length) await tx.logisticsLoadingDriverAssignment.deleteMany({ where: { id: { in: initialQueue.assignments.map((item) => item.id) } } });
  const cutoverTurnCount = await tx.securityDriverQueueTurn.count({ where: { id: { in: initialQueue.turns.map((turn) => turn.id) },
    status: { in: ['WAITING', 'ENTERED_LOADING_AREA', 'RESERVED'] } } });
  const cutoverAssignmentCount = await tx.logisticsLoadingDriverAssignment.count({ where: { id: { in: initialQueue.assignments.map((item) => item.id) } } });
  for (const turn of initialQueue.turns) {
    const { id: _id, ...before } = turnSnapshot(turn);
    await tx.securityDriverQueueTurn.update({ where: { id: turn.id }, data: before });
  }
  await restoreAssignments(tx, initialQueue.assignments);
  const [restoredQueue, finalizedAfter] = await Promise.all([queueEvidence(tx),
    tx.securityDriverQueueTurn.findMany({ where: { status: 'DISPATCHED' }, select: { id: true, loadingId: true, dispatchedAt: true }, orderBy: { id: 'asc' } })]);
  const checks = { dispositionsComplete: manifest.complete, mappingTargetsValid: manifest.targetsValid,
    countsMatch: manifest.pairs.length === manifest.current.size,
    projectionHealthy: unsafeProjectionCount === 0,
    permissionSmokePassed: permissions.length === 5 && permissions.every((result) => result.active && result.allowed),
    apiSmokePassed: permissions.length === 5 && permissions.every((result) => result.apiReadPassed),
    queueClearPlanComplete: cutoverTurnCount === 0,
    reservationsReleased: cutoverAssignmentCount === 0,
    finalizedHistoryPreserved: digest(finalizedLegacyTurns) === digest(finalizedAfter),
    rollbackRestoresExactly: restoredQueue.hash === initialQueue.hash,
    auditChainValid: auditChainIsValid(actions), activeLegacyTurnCount: initialQueue.turns.length, finalizedLegacyCount: finalizedLegacyTurns.length,
    queueEvidenceHash: initialQueue.hash, finalizedHistoryHash: digest(finalizedLegacyTurns),
    permissionEvidenceHash: digest(permissions), operatorIds: input.operators, permissions,
    runbook: input.rehearsalType === DispatchRehearsalType.TIMED_DRESS ? input.runbook : null };
  const nonBooleanChecks = new Set(['activeLegacyTurnCount', 'finalizedLegacyCount', 'queueEvidenceHash', 'finalizedHistoryHash',
    'permissionEvidenceHash', 'operatorIds', 'permissions', 'runbook']);
  const passed = Object.entries(checks).filter(([key]) => !nonBooleanChecks.has(key)).every(([, value]) => value === true);
  const sourceHash = digest(manifest.reconciled);
  const targetHash = digest(manifest.targetReconciled);
  const rehearsal = await tx.dispatchCutoverRehearsal.create({ data: { rehearsalType: input.rehearsalType,
    cutoverVersion: state.version,
    status: passed ? DispatchRehearsalStatus.PASSED : DispatchRehearsalStatus.FAILED,
    sourceCount: manifest.pairs.length, targetCount: manifest.current.size, sourceHash, targetHash, checks: json(checks), performedBy: input.actorId } });
  await appendAction(tx, { actionType: DispatchCutoverActionType.REHEARSAL_RECORDED,
    payload: { rehearsalId: rehearsal.id, rehearsalType: rehearsal.rehearsalType, status: rehearsal.status,
      sourceCount: rehearsal.sourceCount, targetCount: rehearsal.targetCount, sourceHash, targetHash, checks }, actorId: input.actorId,
    at: rehearsal.performedAt });
  return rehearsal;
});

const turnSnapshot = (turn: any) => ({ id: turn.id, status: turn.status, loadingId: turn.loadingId,
  driverRequestId: turn.driverRequestId, reservedAt: turn.reservedAt, reservedBy: turn.reservedBy,
  reservedPosition: turn.reservedPosition, loadingAreaEnteredAt: turn.loadingAreaEnteredAt,
  loadingAreaEnteredBy: turn.loadingAreaEnteredBy, removedAt: turn.removedAt, removedBy: turn.removedBy,
  removalReason: turn.removalReason, updatedAt: turn.updatedAt });

export const executeDispatchCutover = (prisma: PrismaClient, input: { actorId: string }) => serializable(prisma, async (tx) => {
  await lock(tx);
  await lockLegacyDispatchTables(tx);
  const state = await control(tx);
  if (state.phase !== DispatchCutoverPhase.PRE_CUTOVER && state.phase !== DispatchCutoverPhase.ROLLED_BACK) {
    throw new DispatchCutoverConflictError('Dispatch cutover is not available from the current phase.');
  }
  const rehearsals = await tx.dispatchCutoverRehearsal.findMany({ where: { cutoverVersion: state.version }, orderBy: [{ performedAt: 'asc' }, { id: 'asc' }] });
  validateRehearsalGate(rehearsals.map((item) => ({ status: item.status, sourceHash: item.sourceHash, targetHash: item.targetHash })));
  const latestTwo = rehearsals.slice(-2);
  if (latestTwo[0].rehearsalType !== DispatchRehearsalType.CORRECTNESS || latestTwo[1].rehearsalType !== DispatchRehearsalType.TIMED_DRESS) {
    throw new DispatchCutoverConflictError('The latest gates must be a correctness rehearsal followed by a timed dress rehearsal.');
  }
  const manifest = await currentDispositionManifest(tx);
  if (!manifest.complete) throw new DispatchCutoverConflictError('Every legacy combined record requires a reviewed disposition.');
  const currentManifestHash = digest(manifest.reconciled);
  const currentTargetHash = digest(manifest.targetReconciled);
  if (latestTwo.some((item) => item.sourceCount !== manifest.pairs.length || item.targetCount !== manifest.current.size
    || item.sourceHash !== currentManifestHash || item.targetHash !== currentTargetHash || item.sourceHash !== item.targetHash)) {
    throw new DispatchCutoverConflictError('Legacy evidence changed after rehearsal; run both cutover rehearsals again.');
  }
  if (await tx.shipmentQuantityProjection.count({ where: { health: { not: 'CURRENT' } } })) {
    throw new DispatchCutoverConflictError('Shipment projections changed after rehearsal and are not healthy.');
  }
  const rehearsalChecks = latestTwo.map((item) => item.checks as Record<string, any>);
  const operators = rehearsalChecks[1].operatorIds as RehearsalOperators;
  if (!operators || digest(rehearsalChecks[0].operatorIds) !== digest(operators)) {
    throw new DispatchCutoverConflictError('Rehearsal operators changed between gates; repeat both rehearsals.');
  }
  const [currentQueue, finalizedBeforeCutover, currentPermissions, currentActions] = await Promise.all([
    queueEvidence(tx),
    tx.securityDriverQueueTurn.findMany({ where: { status: 'DISPATCHED' }, select: { id: true, loadingId: true, dispatchedAt: true }, orderBy: { id: 'asc' } }),
    permissionEvidence(tx, operators),
    tx.dispatchCutoverAction.findMany({ where: { controlId: CONTROL_ID }, orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] }),
  ]);
  if (rehearsalChecks.some((checks) => checks.queueEvidenceHash !== currentQueue.hash
    || checks.finalizedHistoryHash !== digest(finalizedBeforeCutover)
    || checks.permissionEvidenceHash !== digest(currentPermissions))
    || currentPermissions.some((item) => !item.active || !item.allowed || !item.apiReadPassed)
    || !auditChainIsValid(currentActions)) {
    throw new DispatchCutoverConflictError('Queue, finalized history, permission, API or audit evidence changed after rehearsal; repeat both rehearsals.');
  }
  const turns = currentQueue.turns;
  const releasedAssignments = currentQueue.assignments;
  const nextVersion = state.version + 1;
  const at = new Date();
  for (const turn of turns) {
    const before = turnSnapshot(turn);
    const after = { ...before, status: SecurityDriverQueueTurnStatus.OUT_OF_QUEUE, loadingId: null, driverRequestId: null,
      reservedAt: null, reservedBy: null, reservedPosition: null, removedAt: at, removedBy: input.actorId,
      removalReason: 'Canonical dispatch cutover: active legacy turn cleared', updatedAt: at };
    await tx.legacyCutoverTurnSnapshot.create({ data: { controlId: CONTROL_ID, legacyTurnId: turn.id, cutoverVersion: nextVersion,
      before: json(before), after: json(after), integrityHash: digest({ controlId: CONTROL_ID, cutoverVersion: nextVersion, before, after }) } });
    const { id: _turnId, ...update } = after;
    await tx.securityDriverQueueTurn.update({ where: { id: turn.id }, data: update });
  }
  if (releasedAssignments.length) {
    await tx.logisticsLoadingDriverAssignment.deleteMany({ where: { id: { in: releasedAssignments.map((item) => item.id) } } });
  }
  const finalizedHistory = await tx.securityDriverQueueTurn.findMany({ where: { status: 'DISPATCHED' }, select: { id: true, loadingId: true,
    dispatchedAt: true }, orderBy: { id: 'asc' } });
  const snapshot = { cutoverVersion: nextVersion, recordedAt: at, dispositionCount: manifest.current.size,
    dispositionHash: digest(manifest.reconciled), canonicalTargetHash: digest(manifest.targetReconciled),
    clearedTurnCount: turns.length, clearedTurnHash: digest(turns.map(turnSnapshot)),
    queueEvidenceHash: currentQueue.hash,
    releasedAssignments: stable(releasedAssignments),
    finalizedHistoryCount: finalizedHistory.length, finalizedHistoryHash: digest(finalizedHistory), latestRehearsalIds: latestTwo.map((item) => item.id) };
  const updated = await tx.dispatchCutoverControl.update({ where: { id: CONTROL_ID }, data: { phase: DispatchCutoverPhase.CANONICAL_LIVE,
    legacyWritesEnabled: false, firstCanonicalAdmissionAt: null, cutoverAt: at, cutoverBy: input.actorId,
    rollbackAt: null, rollbackBy: null, pauseAt: null, pauseBy: null, pauseReason: null,
    snapshot: json(snapshot), integrityHash: digest(snapshot), version: nextVersion } });
  await appendAction(tx, { actionType: DispatchCutoverActionType.CUTOVER_EXECUTED, payload: snapshot, actorId: input.actorId, at });
  return updated;
});

const restoreLegacyWrites = async (tx: Tx, state: Awaited<ReturnType<typeof control>>, actorId: string, reason: string) => {
  if (state.firstCanonicalAdmissionAt) throw new DispatchCutoverConflictError('Legacy writes cannot be restored after first canonical admission.');
  const controlSnapshot = state.snapshot as Record<string, unknown> | null;
  if (!controlSnapshot || !state.integrityHash || digest(controlSnapshot) !== state.integrityHash) {
    throw new DispatchCutoverConflictError('Cutover control evidence failed its integrity check; legacy writes remain disabled.');
  }
  const at = new Date();
  const snapshots = await tx.legacyCutoverTurnSnapshot.findMany({ where: { controlId: CONTROL_ID, cutoverVersion: state.version }, orderBy: { legacyTurnId: 'asc' } });
  if (snapshots.some((snapshot) => snapshot.integrityHash !== digest({ controlId: CONTROL_ID, cutoverVersion: state.version,
    before: snapshot.before, after: snapshot.after }))
    || digest(snapshots.map((snapshot) => snapshot.before)) !== controlSnapshot.clearedTurnHash) {
    throw new DispatchCutoverConflictError('Legacy queue rollback evidence failed its integrity check; legacy writes remain disabled.');
  }
  await tx.dispatchCutoverControl.update({ where: { id: CONTROL_ID }, data: { legacyWritesEnabled: true } });
  for (const snapshot of snapshots) {
    const { id: _turnId, ...before } = snapshot.before as Record<string, unknown>;
    await tx.securityDriverQueueTurn.update({ where: { id: snapshot.legacyTurnId }, data: before as Prisma.SecurityDriverQueueTurnUncheckedUpdateInput });
  }
  const releasedAssignments = (controlSnapshot.releasedAssignments || []) as any[];
  await restoreAssignments(tx, releasedAssignments);
  const updated = await tx.dispatchCutoverControl.update({ where: { id: CONTROL_ID }, data: { phase: DispatchCutoverPhase.ROLLED_BACK,
    legacyWritesEnabled: true, rollbackAt: at, rollbackBy: actorId, pauseReason: reason } });
  await appendAction(tx, { actionType: DispatchCutoverActionType.LEGACY_WRITES_RESTORED,
    payload: { reason, cutoverVersion: state.version, restoredTurnCount: snapshots.length }, actorId, at });
  return updated;
};

export const rollbackDispatchCutover = (prisma: PrismaClient, input: { actorId: string; reason: string }) => serializable(prisma, async (tx) => {
  await lock(tx);
  const state = await control(tx);
  if (state.phase !== DispatchCutoverPhase.CANONICAL_LIVE) throw new DispatchCutoverConflictError('Only a live cutover can be rolled back.');
  return restoreLegacyWrites(tx, state, input.actorId, required(input.reason, 'reason'));
});

export const recordDispatchCriticalFailure = (prisma: PrismaClient, input: { actorId: string; reason: string; evidence: Record<string, unknown> }) =>
  serializable(prisma, async (tx) => {
    await lock(tx);
    const state = await control(tx);
    if (state.phase !== DispatchCutoverPhase.CANONICAL_LIVE && state.phase !== DispatchCutoverPhase.PILOT_SAFETY_PAUSE) {
      throw new DispatchCutoverConflictError('Critical dispatch failure handling requires a live or paused canonical pilot.');
    }
    const reason = required(input.reason, 'reason');
    if (criticalFailureDisposition(state) === 'RESTORE_LEGACY_WRITES') return restoreLegacyWrites(tx, state, input.actorId, reason);
    if (state.phase === DispatchCutoverPhase.PILOT_SAFETY_PAUSE) return state;
    const at = new Date();
    const updated = await tx.dispatchCutoverControl.update({ where: { id: CONTROL_ID }, data: {
      phase: DispatchCutoverPhase.PILOT_SAFETY_PAUSE, legacyWritesEnabled: false, pauseAt: at, pauseBy: input.actorId, pauseReason: reason,
    } });
    await appendAction(tx, { actionType: DispatchCutoverActionType.PILOT_SAFETY_PAUSED,
      payload: { reason, evidence: input.evidence || {}, firstCanonicalAdmissionAt: state.firstCanonicalAdmissionAt }, actorId: input.actorId, at });
    return updated;
  });

const approvalPolicy = {
  GUARD: { workspace: 'security', feature: 'security_dispatch_confirmation_approve' },
  LOGISTICS: { workspace: 'logistics', feature: 'logistics_loadings_finalize' },
  ACCOUNTING: { workspace: 'accounting', feature: 'accounting_dispatch_candidates_manage' },
} as const;
type ResumeEvidence = { rootCause: string; deployedCorrection: string; reconciliationResult: string;
  acceptanceTests: Array<{ name: string; status: 'PASSED'; evidenceHash: string }> };

const assertApprovalAuthority = async (tx: Tx, role: DispatchPilotApprovalRole, actorId: string) => {
  const user = await tx.user.findUnique({ where: { id: actorId }, select: { id: true, role: true, isActive: true } });
  if (!user?.isActive) throw new DispatchCutoverValidationError(`Approval actor for ${role} is not active.`);
  if (role === DispatchPilotApprovalRole.INCIDENT_LEAD) {
    if (!['ADMIN', 'MANAGER'].includes(user.role)) throw new DispatchCutoverValidationError('Incident lead approval requires an active manager or administrator.');
  } else {
    const policy = approvalPolicy[role];
    const access = await resolveNarrowFeatureAccess(tx as any, { userId: user.id, role: user.role,
      workspace: policy.workspace, feature: policy.feature, requiredPermission: 'edit' });
    if (!access.allowed) throw new DispatchCutoverValidationError(`${role} approval actor lacks current narrow authority.`);
  }
};

const validateResumeEvidence = (evidence: ResumeEvidence) => {
  required(evidence?.rootCause, 'root cause'); required(evidence?.deployedCorrection, 'deployed correction');
  required(evidence?.reconciliationResult, 'reconciliation result');
  if (!Array.isArray(evidence?.acceptanceTests) || evidence.acceptanceTests.length === 0
    || evidence.acceptanceTests.some((test) => !test || test.status !== 'PASSED' || !String(test.name || '').trim()
      || !/^[a-f0-9]{64}$/i.test(String(test.evidenceHash || '')))) {
    throw new DispatchCutoverValidationError('Approval requires named passed acceptance tests with SHA-256 result evidence.');
  }
  return evidence;
};

export const recordDispatchPilotResumeApproval = (prisma: PrismaClient, input: { actorId: string; role: DispatchPilotApprovalRole;
  evidence: ResumeEvidence }) => serializable(prisma, async (tx) => {
  await lock(tx);
  const state = await control(tx);
  if (state.phase !== DispatchCutoverPhase.PILOT_SAFETY_PAUSE || !state.pauseAt) throw new DispatchCutoverConflictError('Pilot is not safety-paused.');
  if (!Object.values(DispatchPilotApprovalRole).includes(input.role)) throw new DispatchCutoverValidationError('A valid pilot approval role is required.');
  await assertApprovalAuthority(tx, input.role, input.actorId);
  const evidence = validateResumeEvidence(input.evidence);
  const approvedAt = new Date();
  const payload = { controlId: CONTROL_ID, cutoverVersion: state.version, pauseAt: state.pauseAt,
    approvalRole: input.role, evidence, approvedBy: input.actorId, approvedAt };
  const approval = await tx.dispatchPilotResumeApproval.create({ data: { id: randomUUID(), controlId: CONTROL_ID,
    cutoverVersion: state.version, pauseAt: state.pauseAt, approvalRole: input.role, evidence: json(evidence),
    approvedBy: input.actorId, approvedAt, integrityHash: digest(payload) } });
  await appendAction(tx, { actionType: DispatchCutoverActionType.PILOT_RESUME_APPROVAL_RECORDED,
    payload: { approvalId: approval.id, role: approval.approvalRole, integrityHash: approval.integrityHash }, actorId: input.actorId, at: approvedAt });
  return approval;
});

export const resumeDispatchPilot = (prisma: PrismaClient, input: { actorId: string; reason: string }) =>
  serializable(prisma, async (tx) => {
    await lock(tx);
    const state = await control(tx);
    if (state.phase !== DispatchCutoverPhase.PILOT_SAFETY_PAUSE || !state.pauseAt) throw new DispatchCutoverConflictError('Pilot is not safety-paused.');
    const recorded = await tx.dispatchPilotResumeApproval.findMany({ where: { controlId: CONTROL_ID, cutoverVersion: state.version,
      pauseAt: state.pauseAt }, orderBy: [{ approvedAt: 'desc' }, { id: 'desc' }] });
    const current = new Map<DispatchPilotApprovalRole, typeof recorded[number]>();
    for (const approval of recorded) if (!current.has(approval.approvalRole)) current.set(approval.approvalRole, approval);
    const approvals = Object.values(DispatchPilotApprovalRole).map((role) => current.get(role)).filter(Boolean) as typeof recorded;
    if (approvals.length !== 4) {
      throw new DispatchCutoverValidationError('Resumption requires incident lead, Guard, Logistics and Accounting approval.');
    }
    if (new Set(approvals.map((item) => item.approvedBy)).size !== 4) {
      throw new DispatchCutoverValidationError('Resumption requires four distinct self-authenticated accountable actors.');
    }
    for (const approval of approvals) {
      await assertApprovalAuthority(tx, approval.approvalRole, approval.approvedBy);
      const evidence = approval.evidence as ResumeEvidence;
      validateResumeEvidence(evidence);
      if (approval.integrityHash !== digest({ controlId: CONTROL_ID, cutoverVersion: approval.cutoverVersion, pauseAt: approval.pauseAt,
        approvalRole: approval.approvalRole, evidence, approvedBy: approval.approvedBy, approvedAt: approval.approvedAt })) {
        throw new DispatchCutoverConflictError('A pilot resume approval failed its integrity check.');
      }
    }
    const [unsafeProjectionCount, actions] = await Promise.all([
      tx.shipmentQuantityProjection.count({ where: { health: { not: 'CURRENT' } } }),
      tx.dispatchCutoverAction.findMany({ where: { controlId: CONTROL_ID }, orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] }),
    ]);
    const acceptanceNames = new Set(approvals.flatMap((approval) => (approval.evidence as ResumeEvidence).acceptanceTests.map((test) => test.name)));
    if (unsafeProjectionCount || !auditChainIsValid(actions) || state.legacyWritesEnabled || acceptanceNames.size < 3) {
      throw new DispatchCutoverConflictError('Fix-forward system reconciliation and repeated acceptance gates are not healthy.');
    }
    const at = new Date();
    const updated = await tx.dispatchCutoverControl.update({ where: { id: CONTROL_ID }, data: { phase: DispatchCutoverPhase.CANONICAL_LIVE,
      pauseAt: null, pauseBy: null, pauseReason: null, legacyWritesEnabled: false } });
    await appendAction(tx, { actionType: DispatchCutoverActionType.PILOT_SAFETY_RESUMED,
      payload: { reason: required(input.reason, 'reason'), approvalIds: approvals.map((approval) => approval.id),
        acceptanceTests: Array.from(acceptanceNames), systemChecks: { projectionHealthy: true, auditChainValid: true, legacyWritesDisabled: true } }, actorId: input.actorId, at });
    return updated;
  });

export const assertCanonicalDispatchCommandAllowed = async (tx: Tx) => {
  await lock(tx);
  const state = await tx.dispatchCutoverControl.findUnique({ where: { id: CONTROL_ID } });
  if (state?.phase === DispatchCutoverPhase.PILOT_SAFETY_PAUSE) throw new PilotSafetyPauseError('Pilot Safety Pause blocks new canonical dispatch work.');
  if (state?.phase === DispatchCutoverPhase.ROLLED_BACK) throw new PilotSafetyPauseError('Canonical dispatch writes are disabled while legacy writes are restored.');
  return state;
};

export const recordFirstCanonicalAdmission = async (tx: Tx, actorId: string, turnId: string, admittedAt: Date) => {
  const state = await tx.dispatchCutoverControl.findUnique({ where: { id: CONTROL_ID } });
  if (state?.phase !== DispatchCutoverPhase.CANONICAL_LIVE || state.firstCanonicalAdmissionAt) return;
  const changed = await tx.dispatchCutoverControl.updateMany({ where: { id: CONTROL_ID, phase: DispatchCutoverPhase.CANONICAL_LIVE,
    firstCanonicalAdmissionAt: null }, data: { firstCanonicalAdmissionAt: admittedAt } });
  if (changed.count) await appendAction(tx, { actionType: DispatchCutoverActionType.FIRST_CANONICAL_ADMISSION,
    payload: { turnId, admittedAt }, actorId, at: admittedAt });
};
