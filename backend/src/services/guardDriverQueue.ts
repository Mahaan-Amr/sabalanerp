import { createHash } from 'node:crypto';
import { GuardDriverQueueTurnStatus, GuardDriverSource, Prisma, PrismaClient } from '@prisma/client';
import { projectExternalDriverReadiness, projectExternalVehicleReadiness, projectInternalDriverReadiness } from './dispatchMasterDataPolicy';
import { assertCanonicalDispatchCommandAllowed, recordFirstCanonicalAdmission } from './dispatchCutover';

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value instanceof Date ? value.toISOString() : value;
};

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
const activeAt = (at: Date) => ({ effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] });
type GuardQueueEventType = 'ADMITTED' | 'MADE_AVAILABLE_FOR_LOADING' | 'RESERVED_FOR_LOADING' | 'RESERVATION_RELEASED'
  | 'LOADING_FINALIZED' | 'PHYSICAL_EXIT_RECORDED' | 'MANUAL_OUTAGE_EXIT_REGISTERED'
  | 'RETURNED_TO_GATE_WAITING' | 'RESERVATION_RELEASED_FOR_DEPARTURE' | 'CLOSED_WITHOUT_LOADING'
  | 'RESERVATION_RELEASED_FOR_VOID' | 'VOIDED';

export class GuardQueueConflictError extends Error {}
export class GuardQueueValidationError extends Error {}

type QueueTurnIdentity = {
  driverSource: GuardDriverSource;
  internalDriverId: string | null;
  externalDriverId: string | null;
  companyVehicleId: string | null;
  externalVehicleId: string | null;
  assignmentId: string | null;
};

export const isGuardQueueTurnCurrentlyReady = async (
  db: Prisma.TransactionClient | PrismaClient,
  turn: QueueTurnIdentity,
  at = new Date(),
) => {
  if (turn.driverSource === GuardDriverSource.INTERNAL) {
    if (!turn.internalDriverId || !turn.companyVehicleId || !turn.assignmentId) return false;
    const driver = await db.internalDriverProfile.findUnique({ where: { id: turn.internalDriverId }, include: {
      personnel: { include: { hrEmploymentRelationships: { where: { status: 'ACTIVE', ...activeAt(at) }, take: 1 } } },
      eligibilityPeriods: { where: activeAt(at), orderBy: { effectiveFrom: 'desc' }, take: 1 },
      vehicleAssignments: { where: { id: turn.assignmentId, vehicleId: turn.companyVehicleId, ...activeAt(at) }, take: 1, include: { vehicle: { include: { plates: { where: activeAt(at), take: 1 } } } } },
    } });
    const assignment = driver?.vehicleAssignments[0];
    const readiness = driver && projectInternalDriverReadiness({
      personnelActive: driver.personnel.isActive && !driver.personnel.archivedAt,
      activeEmployment: Boolean(driver.personnel.hrEmploymentRelationships[0]), eligible: driver.eligibilityPeriods[0]?.status === 'ELIGIBLE',
      drivingProfileActive: driver.status === 'ACTIVE', licenceNumber: driver.licenceNumber, licenceClass: driver.licenceClass,
      licenceExpiresAt: driver.licenceExpiresAt, assignmentActive: Boolean(assignment),
      assignedVehicleActive: assignment ? assignment.vehicle.status === 'ACTIVE' : null,
      assignedVehicleHasCurrentPlate: assignment ? Boolean(assignment.vehicle.plates[0]) : null,
    }, at);
    return readiness?.status === 'READY';
  }
  if (!turn.externalDriverId || !turn.externalVehicleId) return false;
  const [driver, vehicle] = await Promise.all([
    db.externalDriver.findUnique({ where: { id: turn.externalDriverId }, include: {
      documents: true,
      externalLinks: { include: { personnel: { include: { hrEmploymentRelationships: true, internalDriverProfile: { include: { eligibilityPeriods: true } } } } } },
    } }),
    db.externalVehicle.findUnique({ where: { id: turn.externalVehicleId }, include: { documents: true, plates: { where: activeAt(at), take: 1 } } }),
  ]);
  if (!driver || !vehicle) return false;
  const continuity = driver.externalLinks.some(({ personnel }) => personnel.isActive && !personnel.archivedAt && (
    personnel.hrEmploymentRelationships.some((item) => item.status === 'ACTIVE' && item.effectiveFrom <= at && (!item.effectiveTo || item.effectiveTo > at))
    || Boolean(personnel.internalDriverProfile?.eligibilityPeriods.some((item) => item.status === 'ELIGIBLE' && item.effectiveFrom <= at && (!item.effectiveTo || item.effectiveTo > at)))
  ));
  return projectExternalDriverReadiness({ lifecycleStatus: driver.status, documents: driver.documents, continuityLinkedToActiveInternalIdentity: continuity }, at).status === 'READY'
    && projectExternalVehicleReadiness({ lifecycleStatus: vehicle.status, documents: vehicle.documents, hasCurrentPlate: Boolean(vehicle.plates[0]) }, at).status === 'READY';
};

export const appendQueueEvent = async (tx: Prisma.TransactionClient, input: {
  turnId: string;
  eventType: GuardQueueEventType;
  fromStatus: GuardDriverQueueTurnStatus | null;
  toStatus: GuardDriverQueueTurnStatus;
  actorId: string;
  reason?: string | null;
  payload?: unknown;
}) => {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `GUARD_QUEUE:${input.turnId}`);
  const previous = await tx.guardDriverQueueEvent.findFirst({
    where: { turnId: input.turnId }, orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }], select: { eventHash: true },
  });
  const recordedAt = new Date();
  const payload = stableValue(input.payload || {});
  const reason = input.reason?.trim() || null;
  const previousHash = previous?.eventHash || null;
  const eventHash = digest({
    turnId: input.turnId, eventType: input.eventType, fromStatus: input.fromStatus, toStatus: input.toStatus,
    reason, payload, actorId: input.actorId, recordedAt, previousHash,
  });
  return tx.guardDriverQueueEvent.create({ data: {
    ...input, reason, payload: payload as Prisma.InputJsonValue, recordedAt, previousHash, eventHash,
  } });
};

const buildInternalAdmission = async (tx: Prisma.TransactionClient, driverId: string, actorId: string, admittedAt: Date) => {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `GUARD_QUEUE:INTERNAL:${driverId}`);
  const driver = await tx.internalDriverProfile.findUnique({ where: { id: driverId }, include: {
    personnel: { include: { hrEmploymentRelationships: { where: { status: 'ACTIVE', ...activeAt(admittedAt) }, orderBy: { effectiveFrom: 'desc' }, take: 1 } } },
    eligibilityPeriods: { where: activeAt(admittedAt), orderBy: { effectiveFrom: 'desc' }, take: 1 },
    vehicleAssignments: { where: activeAt(admittedAt), orderBy: { effectiveFrom: 'desc' }, take: 1, include: { vehicle: { include: { plates: { where: activeAt(admittedAt), orderBy: { effectiveFrom: 'desc' }, take: 1 } } } } },
  } });
  if (!driver) throw new GuardQueueValidationError('Internal driver was not found.');
  const eligibility = driver.eligibilityPeriods[0];
  const employment = driver.personnel.hrEmploymentRelationships[0];
  const assignment = driver.vehicleAssignments[0];
  const plate = assignment?.vehicle.plates[0];
  const readiness = projectInternalDriverReadiness({
    personnelActive: driver.personnel.isActive && !driver.personnel.archivedAt,
    activeEmployment: Boolean(employment), eligible: eligibility?.status === 'ELIGIBLE', drivingProfileActive: driver.status === 'ACTIVE',
    licenceNumber: driver.licenceNumber, licenceClass: driver.licenceClass, licenceExpiresAt: driver.licenceExpiresAt,
    assignmentActive: Boolean(assignment), assignedVehicleActive: assignment ? assignment.vehicle.status === 'ACTIVE' : null,
    assignedVehicleHasCurrentPlate: assignment ? Boolean(plate) : null,
  }, admittedAt);
  if (readiness.status !== 'READY' || !eligibility || !employment || !assignment || !plate) {
    throw new GuardQueueValidationError(`Internal driver is not currently ready for admission: ${readiness.blockers.join(', ')}`);
  }
  const snapshot = stableValue({
    schemaVersion: 1, admittedAt, actorId,
    driver: {
      source: 'HR_PERSONNEL', id: driver.id, personnelId: driver.personnelId, firstName: driver.personnel.firstName,
      lastName: driver.personnel.lastName, employeeNumber: driver.personnel.employeeNumber,
    },
    vehicle: {
      source: 'COMPANY_FLEET', id: assignment.vehicle.id, fleetCode: assignment.vehicle.fleetCode,
      vehicleType: assignment.vehicle.vehicleType, make: assignment.vehicle.make, model: assignment.vehicle.model, vin: assignment.vehicle.vin,
    },
    plate,
    assignment: { id: assignment.id, effectiveFrom: assignment.effectiveFrom, effectiveTo: assignment.effectiveTo },
    readiness: { status: 'READY', checkedAt: admittedAt, eligibilityPeriodId: eligibility.id, employmentRelationshipId: employment.id },
    documents: [{ type: 'DRIVING_LICENCE', reference: driver.licenceNumber, licenceClass: driver.licenceClass, expiresAt: driver.licenceExpiresAt }],
  });
  return { driver, assignment, snapshot };
};

const buildExternalAdmission = async (tx: Prisma.TransactionClient, driverId: string, vehicleId: string, actorId: string, admittedAt: Date) => {
  const lockKeys = [`GUARD_QUEUE:EXTERNAL_DRIVER:${driverId}`, `GUARD_QUEUE:EXTERNAL_VEHICLE:${vehicleId}`].sort();
  for (const key of lockKeys) await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', key);
  const [driver, vehicle] = await Promise.all([
    tx.externalDriver.findUnique({ where: { id: driverId }, include: {
      documents: { orderBy: { recordedAt: 'desc' } },
      externalLinks: { include: { personnel: { include: { hrEmploymentRelationships: true, internalDriverProfile: { include: { eligibilityPeriods: true } } } } } },
    } }),
    tx.externalVehicle.findUnique({ where: { id: vehicleId }, include: {
      plates: { where: activeAt(admittedAt), orderBy: { effectiveFrom: 'desc' }, take: 1 }, documents: { orderBy: { recordedAt: 'desc' } },
    } }),
  ]);
  if (!driver) throw new GuardQueueValidationError('External driver was not found.');
  if (!vehicle) throw new GuardQueueValidationError('External vehicle was not found.');
  const continuityLinkedToActiveInternalIdentity = driver.externalLinks.some((link) => {
    const personnel = link.personnel;
    const employment = personnel.hrEmploymentRelationships.some((item) => item.status === 'ACTIVE' && item.effectiveFrom <= admittedAt && (!item.effectiveTo || item.effectiveTo > admittedAt));
    const eligibility = personnel.internalDriverProfile?.eligibilityPeriods.some((item) => item.status === 'ELIGIBLE' && item.effectiveFrom <= admittedAt && (!item.effectiveTo || item.effectiveTo > admittedAt));
    return personnel.isActive && !personnel.archivedAt && (employment || eligibility);
  });
  const driverReadiness = projectExternalDriverReadiness({ lifecycleStatus: driver.status, documents: driver.documents, continuityLinkedToActiveInternalIdentity }, admittedAt);
  const vehicleReadiness = projectExternalVehicleReadiness({ lifecycleStatus: vehicle.status, hasCurrentPlate: Boolean(vehicle.plates[0]), documents: vehicle.documents }, admittedAt);
  const plate = vehicle.plates[0];
  if (driverReadiness.status !== 'READY' || vehicleReadiness.status !== 'READY' || !plate) {
    throw new GuardQueueValidationError(`External driver-vehicle combination is not currently ready for admission: ${[...driverReadiness.blockers, ...vehicleReadiness.blockers].join(', ')}`);
  }
  const driverDocument = driver.documents.find((document) => document.documentType === 'DRIVING_LICENCE' && (!document.expiresAt || document.expiresAt > admittedAt))!;
  const vehicleDocument = vehicle.documents.find((document) => document.documentType === 'VEHICLE_REGISTRATION' && (!document.expiresAt || document.expiresAt > admittedAt))!;
  const documents = [
    { id: driverDocument.id, type: driverDocument.documentType, reference: driverDocument.reference, expiresAt: driverDocument.expiresAt, recordedAt: driverDocument.recordedAt },
    { id: vehicleDocument.id, type: vehicleDocument.documentType, reference: vehicleDocument.reference, expiresAt: vehicleDocument.expiresAt, recordedAt: vehicleDocument.recordedAt },
  ];
  const snapshot = stableValue({
    schemaVersion: 1, admittedAt, actorId,
    driver: { source: 'GUARD_EXTERNAL', id: driver.id, firstName: driver.firstName, lastName: driver.lastName, nationalCode: driver.nationalCode, phone: driver.phone },
    vehicle: { source: 'GUARD_EXTERNAL', id: vehicle.id, vehicleType: vehicle.vehicleType },
    plate,
    readiness: { status: 'READY', checkedAt: admittedAt, driver: driverReadiness, vehicle: vehicleReadiness },
    documents,
  });
  return { driver, vehicle, snapshot };
};

export const admitGuardDriverQueueTurn = async (prisma: PrismaClient, input: {
  source: GuardDriverSource;
  driverId: string;
  vehicleId?: string;
  actorId: string;
}) => prisma.$transaction(async (tx) => {
  await assertCanonicalDispatchCommandAllowed(tx);
  const admittedAt = new Date();
  const resolved = input.source === GuardDriverSource.INTERNAL
    ? await buildInternalAdmission(tx, input.driverId, input.actorId, admittedAt)
    : await buildExternalAdmission(tx, input.driverId, String(input.vehicleId || ''), input.actorId, admittedAt);
  const integrityHash = digest(resolved.snapshot);
  try {
    const turn = await tx.guardDriverQueueTurn.create({ data: {
      driverSource: input.source,
      ...(input.source === GuardDriverSource.INTERNAL
        ? { internalDriverId: (resolved as Awaited<ReturnType<typeof buildInternalAdmission>>).driver.id, companyVehicleId: (resolved as Awaited<ReturnType<typeof buildInternalAdmission>>).assignment.vehicleId, assignmentId: (resolved as Awaited<ReturnType<typeof buildInternalAdmission>>).assignment.id }
        : { externalDriverId: (resolved as Awaited<ReturnType<typeof buildExternalAdmission>>).driver.id, externalVehicleId: (resolved as Awaited<ReturnType<typeof buildExternalAdmission>>).vehicle.id }),
      admittedAt, admittedBy: input.actorId, admissionSnapshot: resolved.snapshot as Prisma.InputJsonValue, integrityHash,
    } });
    await appendQueueEvent(tx, {
      turnId: turn.id, eventType: 'ADMITTED', fromStatus: null, toStatus: turn.status, actorId: input.actorId,
      payload: { integrityHash, snapshotSchemaVersion: turn.snapshotSchemaVersion },
    });
    await recordFirstCanonicalAdmission(tx, input.actorId, turn.id, admittedAt);
    return turn;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new GuardQueueConflictError('This driver or vehicle already has an open canonical queue turn.');
    }
    throw error;
  }
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const makeGuardQueueTurnAvailable = async (prisma: PrismaClient, turnId: string, actorId: string) => prisma.$transaction(async (tx) => {
  await assertCanonicalDispatchCommandAllowed(tx);
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `GUARD_QUEUE:${turnId}`);
  const current = await tx.guardDriverQueueTurn.findUnique({ where: { id: turnId } });
  if (!current) throw new GuardQueueValidationError('Canonical queue turn was not found.');
  if (current.status !== GuardDriverQueueTurnStatus.WAITING_AT_GATE) throw new GuardQueueConflictError('Only a turn waiting at the gate can become available for loading.');
  const changed = await tx.guardDriverQueueTurn.updateMany({
    where: { id: turnId, status: GuardDriverQueueTurnStatus.WAITING_AT_GATE },
    data: { status: GuardDriverQueueTurnStatus.AVAILABLE_FOR_LOADING, availableAt: new Date(), availableBy: actorId },
  });
  if (changed.count !== 1) throw new GuardQueueConflictError('The queue turn changed before availability was recorded.');
  const updated = await tx.guardDriverQueueTurn.findUniqueOrThrow({ where: { id: turnId } });
  await appendQueueEvent(tx, {
    turnId, eventType: 'MADE_AVAILABLE_FOR_LOADING', fromStatus: current.status, toStatus: updated.status, actorId,
    payload: { availableAt: updated.availableAt },
  });
  return updated;
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const reserveGuardQueueTurn = async (prisma: PrismaClient, input: { turnId: string; loadingId: string; actorId: string }) => prisma.$transaction(async (tx) => {
  await assertCanonicalDispatchCommandAllowed(tx);
  for (const key of [`GUARD_QUEUE:${input.turnId}`, `LOGISTICS_LOADING:${input.loadingId}`].sort()) {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', key);
  }
  const [turn, loading] = await Promise.all([
    tx.guardDriverQueueTurn.findUnique({ where: { id: input.turnId } }),
    tx.logisticsLoading.findUnique({ where: { id: input.loadingId } }),
  ]);
  if (!turn) throw new GuardQueueValidationError('Canonical queue turn was not found.');
  if (!loading) throw new GuardQueueValidationError('Loading was not found.');
  if (loading.status !== 'DRAFT') throw new GuardQueueConflictError('Only a draft loading can reserve a queue turn.');
  if (turn.status !== GuardDriverQueueTurnStatus.AVAILABLE_FOR_LOADING) throw new GuardQueueConflictError('Only an available queue turn can be reserved.');
  if (!await isGuardQueueTurnCurrentlyReady(tx, turn)) throw new GuardQueueConflictError('The admitted driver or vehicle is no longer currently ready for loading.');
  const changed = await tx.guardDriverQueueTurn.updateMany({
    where: { id: turn.id, status: GuardDriverQueueTurnStatus.AVAILABLE_FOR_LOADING, loadingId: null },
    data: { status: GuardDriverQueueTurnStatus.RESERVED_FOR_LOADING, loadingId: loading.id, reservedAt: new Date(), reservedBy: input.actorId },
  });
  if (changed.count !== 1) throw new GuardQueueConflictError('The queue turn was reserved by another command.');
  const updated = await tx.guardDriverQueueTurn.findUniqueOrThrow({ where: { id: turn.id } });
  await appendQueueEvent(tx, {
    turnId: turn.id, eventType: 'RESERVED_FOR_LOADING', fromStatus: turn.status, toStatus: updated.status, actorId: input.actorId,
    payload: { loadingId: loading.id, reservedAt: updated.reservedAt },
  });
  return updated;
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const releaseGuardQueueReservation = async (prisma: PrismaClient, input: { turnId: string; loadingId: string; actorId: string; reason: string }) => prisma.$transaction(async (tx) => {
  for (const key of [`GUARD_QUEUE:${input.turnId}`, `LOGISTICS_LOADING:${input.loadingId}`].sort()) {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', key);
  }
  const turn = await tx.guardDriverQueueTurn.findUnique({ where: { id: input.turnId } });
  if (!turn) throw new GuardQueueValidationError('Canonical queue turn was not found.');
  if (turn.status !== GuardDriverQueueTurnStatus.RESERVED_FOR_LOADING || turn.loadingId !== input.loadingId) {
    throw new GuardQueueConflictError('Only the loading that holds this reservation can release it.');
  }
  const reason = input.reason.trim();
  if (!reason) throw new GuardQueueValidationError('A reservation release reason is required.');
  const changed = await tx.guardDriverQueueTurn.updateMany({
    where: { id: turn.id, status: GuardDriverQueueTurnStatus.RESERVED_FOR_LOADING, loadingId: input.loadingId },
    data: { status: GuardDriverQueueTurnStatus.AVAILABLE_FOR_LOADING, loadingId: null, reservedAt: null, reservedBy: null },
  });
  if (changed.count !== 1) throw new GuardQueueConflictError('The reservation changed before it could be released.');
  const updated = await tx.guardDriverQueueTurn.findUniqueOrThrow({ where: { id: turn.id } });
  await appendQueueEvent(tx, {
    turnId: turn.id, eventType: 'RESERVATION_RELEASED', fromStatus: turn.status, toStatus: updated.status,
    actorId: input.actorId, reason, payload: { loadingId: input.loadingId },
  });
  return updated;
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const returnGuardQueueTurnToWaiting = async (prisma: PrismaClient, input: { turnId: string; actorId: string; reason: string }) => prisma.$transaction(async (tx) => {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `GUARD_QUEUE:${input.turnId}`);
  const turn = await tx.guardDriverQueueTurn.findUnique({ where: { id: input.turnId } });
  if (!turn) throw new GuardQueueValidationError('Canonical queue turn was not found.');
  if (turn.status !== GuardDriverQueueTurnStatus.AVAILABLE_FOR_LOADING) throw new GuardQueueConflictError('Only an available queue turn can return to gate waiting.');
  const reason = input.reason.trim();
  if (!reason) throw new GuardQueueValidationError('A return-to-waiting reason is required.');
  const changed = await tx.guardDriverQueueTurn.updateMany({
    where: { id: turn.id, status: GuardDriverQueueTurnStatus.AVAILABLE_FOR_LOADING },
    data: { status: GuardDriverQueueTurnStatus.WAITING_AT_GATE, availableAt: null, availableBy: null },
  });
  if (changed.count !== 1) throw new GuardQueueConflictError('The queue turn changed before it could return to waiting.');
  const updated = await tx.guardDriverQueueTurn.findUniqueOrThrow({ where: { id: turn.id } });
  await appendQueueEvent(tx, {
    turnId: turn.id, eventType: 'RETURNED_TO_GATE_WAITING', fromStatus: turn.status, toStatus: updated.status,
    actorId: input.actorId, reason, payload: {},
  });
  return updated;
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const closeGuardQueueTurnWithoutLoading = async (prisma: PrismaClient, input: { turnId: string; actorId: string; reason: string }) => prisma.$transaction(async (tx) => {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `GUARD_QUEUE:${input.turnId}`);
  let turn = await tx.guardDriverQueueTurn.findUnique({ where: { id: input.turnId } });
  if (!turn) throw new GuardQueueValidationError('Canonical queue turn was not found.');
  const reason = input.reason.trim();
  if (!reason) throw new GuardQueueValidationError('A close-without-loading reason is required.');
  const closableStatuses = new Set<GuardDriverQueueTurnStatus>([
    GuardDriverQueueTurnStatus.WAITING_AT_GATE, GuardDriverQueueTurnStatus.AVAILABLE_FOR_LOADING, GuardDriverQueueTurnStatus.RESERVED_FOR_LOADING,
  ]);
  if (!closableStatuses.has(turn.status)) {
    throw new GuardQueueConflictError('Only a non-finalized physical visit can close without loading.');
  }
  if (turn.status === GuardDriverQueueTurnStatus.RESERVED_FOR_LOADING) {
    const loadingId = turn.loadingId;
    turn = await tx.guardDriverQueueTurn.update({ where: { id: turn.id }, data: {
      status: GuardDriverQueueTurnStatus.AVAILABLE_FOR_LOADING, loadingId: null, reservedAt: null, reservedBy: null,
    } });
    await appendQueueEvent(tx, {
      turnId: turn.id, eventType: 'RESERVATION_RELEASED_FOR_DEPARTURE', fromStatus: GuardDriverQueueTurnStatus.RESERVED_FOR_LOADING,
      toStatus: GuardDriverQueueTurnStatus.AVAILABLE_FOR_LOADING, actorId: input.actorId, reason, payload: { loadingId },
    });
  }
  const fromStatus = turn.status;
  const changed = await tx.guardDriverQueueTurn.updateMany({
    where: { id: turn.id, status: fromStatus },
    data: {
      status: GuardDriverQueueTurnStatus.CLOSED_WITHOUT_LOADING, loadingId: null, availableAt: null, availableBy: null,
      reservedAt: null, reservedBy: null, closedAt: new Date(), closedBy: input.actorId, closureReason: reason,
    },
  });
  if (changed.count !== 1) throw new GuardQueueConflictError('The queue turn changed before departure could be recorded.');
  const updated = await tx.guardDriverQueueTurn.findUniqueOrThrow({ where: { id: turn.id } });
  await appendQueueEvent(tx, {
    turnId: turn.id, eventType: 'CLOSED_WITHOUT_LOADING', fromStatus, toStatus: updated.status,
    actorId: input.actorId, reason, payload: { closedAt: updated.closedAt },
  });
  return updated;
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const voidGuardQueueTurn = async (prisma: PrismaClient, input: { turnId: string; actorId: string; reason: string; replacementTurnId?: string }) => prisma.$transaction(async (tx) => {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `GUARD_QUEUE:${input.turnId}`);
  let turn = await tx.guardDriverQueueTurn.findUnique({ where: { id: input.turnId } });
  if (!turn) throw new GuardQueueValidationError('Canonical queue turn was not found.');
  const reason = input.reason.trim();
  if (!reason) throw new GuardQueueValidationError('A void reason is required.');
  const voidableStatuses = new Set<GuardDriverQueueTurnStatus>([
    GuardDriverQueueTurnStatus.WAITING_AT_GATE, GuardDriverQueueTurnStatus.AVAILABLE_FOR_LOADING, GuardDriverQueueTurnStatus.RESERVED_FOR_LOADING,
  ]);
  if (!voidableStatuses.has(turn.status)) throw new GuardQueueConflictError('A finalized, exited, closed, or already voided queue turn cannot be voided.');
  if (input.replacementTurnId) {
    if (input.replacementTurnId === turn.id || !await tx.guardDriverQueueTurn.findUnique({ where: { id: input.replacementTurnId }, select: { id: true } })) {
      throw new GuardQueueValidationError('A valid different replacement queue turn is required.');
    }
  }
  if (turn.status === GuardDriverQueueTurnStatus.RESERVED_FOR_LOADING) {
    const loadingId = turn.loadingId;
    turn = await tx.guardDriverQueueTurn.update({ where: { id: turn.id }, data: {
      status: GuardDriverQueueTurnStatus.AVAILABLE_FOR_LOADING, loadingId: null, reservedAt: null, reservedBy: null,
    } });
    await appendQueueEvent(tx, {
      turnId: turn.id, eventType: 'RESERVATION_RELEASED_FOR_VOID', fromStatus: GuardDriverQueueTurnStatus.RESERVED_FOR_LOADING,
      toStatus: GuardDriverQueueTurnStatus.AVAILABLE_FOR_LOADING, actorId: input.actorId, reason, payload: { loadingId },
    });
  }
  const fromStatus = turn.status;
  const updated = await tx.guardDriverQueueTurn.update({ where: { id: turn.id }, data: {
    status: GuardDriverQueueTurnStatus.VOIDED, loadingId: null, availableAt: null, availableBy: null, reservedAt: null, reservedBy: null,
    voidedAt: new Date(), voidedBy: input.actorId, voidReason: reason, replacementTurnId: input.replacementTurnId || null,
  } });
  await appendQueueEvent(tx, {
    turnId: turn.id, eventType: 'VOIDED', fromStatus, toStatus: updated.status, actorId: input.actorId, reason,
    payload: { voidedAt: updated.voidedAt, replacementTurnId: updated.replacementTurnId },
  });
  return updated;
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const listGuardQueueAdmissionOptions = async (prisma: PrismaClient, at = new Date()) => {
  const openStatuses: GuardDriverQueueTurnStatus[] = [
    GuardDriverQueueTurnStatus.WAITING_AT_GATE, GuardDriverQueueTurnStatus.AVAILABLE_FOR_LOADING,
    GuardDriverQueueTurnStatus.RESERVED_FOR_LOADING, GuardDriverQueueTurnStatus.LOADING_FINALIZED,
  ];
  const openTurns = await prisma.guardDriverQueueTurn.findMany({ where: { status: { in: openStatuses } }, select: {
    internalDriverId: true, externalDriverId: true, companyVehicleId: true, externalVehicleId: true,
  } });
  const usedInternalDrivers = openTurns.flatMap((turn) => turn.internalDriverId ? [turn.internalDriverId] : []);
  const usedExternalDrivers = openTurns.flatMap((turn) => turn.externalDriverId ? [turn.externalDriverId] : []);
  const usedCompanyVehicles = openTurns.flatMap((turn) => turn.companyVehicleId ? [turn.companyVehicleId] : []);
  const usedExternalVehicles = openTurns.flatMap((turn) => turn.externalVehicleId ? [turn.externalVehicleId] : []);
  const [internalDrivers, externalDrivers, externalVehicles] = await Promise.all([
    prisma.internalDriverProfile.findMany({ where: { id: { notIn: usedInternalDrivers } }, include: {
      personnel: { include: { hrEmploymentRelationships: { orderBy: { effectiveFrom: 'desc' } } } },
      eligibilityPeriods: { orderBy: { effectiveFrom: 'desc' } },
      vehicleAssignments: { orderBy: { effectiveFrom: 'desc' }, include: { vehicle: { include: { plates: { orderBy: { effectiveFrom: 'desc' } } } } } },
    }, orderBy: { createdAt: 'asc' } }),
    prisma.externalDriver.findMany({ where: { id: { notIn: usedExternalDrivers } }, include: {
      documents: { orderBy: { recordedAt: 'desc' } },
      externalLinks: { include: { personnel: { include: { hrEmploymentRelationships: true, internalDriverProfile: { include: { eligibilityPeriods: true } } } } } },
    }, orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }] }),
    prisma.externalVehicle.findMany({ where: { id: { notIn: usedExternalVehicles } }, include: {
      documents: { orderBy: { recordedAt: 'desc' } }, plates: { orderBy: { effectiveFrom: 'desc' } },
    }, orderBy: { createdAt: 'asc' } }),
  ]);
  const internalAssignments = internalDrivers.flatMap((driver) => {
    const eligibility = driver.eligibilityPeriods.find((period) => period.effectiveFrom <= at && (!period.effectiveTo || period.effectiveTo > at));
    const employment = driver.personnel.hrEmploymentRelationships.find((item) => item.status === 'ACTIVE' && item.effectiveFrom <= at && (!item.effectiveTo || item.effectiveTo > at));
    const assignment = driver.vehicleAssignments.find((item) => item.effectiveFrom <= at && (!item.effectiveTo || item.effectiveTo > at));
    const plate = assignment?.vehicle.plates.find((item) => item.effectiveFrom <= at && (!item.effectiveTo || item.effectiveTo > at));
    const readiness = projectInternalDriverReadiness({
      personnelActive: driver.personnel.isActive && !driver.personnel.archivedAt, activeEmployment: Boolean(employment),
      eligible: eligibility?.status === 'ELIGIBLE', drivingProfileActive: driver.status === 'ACTIVE', licenceNumber: driver.licenceNumber,
      licenceClass: driver.licenceClass, licenceExpiresAt: driver.licenceExpiresAt, assignmentActive: Boolean(assignment),
      assignedVehicleActive: assignment ? assignment.vehicle.status === 'ACTIVE' : null, assignedVehicleHasCurrentPlate: assignment ? Boolean(plate) : null,
    }, at);
    if (readiness.status !== 'READY' || !assignment || !plate || usedCompanyVehicles.includes(assignment.vehicleId)) return [];
    return [{
      driverId: driver.id, vehicleId: assignment.vehicleId, assignmentId: assignment.id,
      driverName: `${driver.personnel.firstName} ${driver.personnel.lastName}`.trim(), vehicleType: assignment.vehicle.vehicleType,
      fleetCode: assignment.vehicle.fleetCode, plate: plate.plate,
    }];
  });
  const readyExternalDrivers = externalDrivers.filter((driver) => {
    const continuity = driver.externalLinks.some((link) => {
      const personnel = link.personnel;
      return personnel.isActive && !personnel.archivedAt && (
        personnel.hrEmploymentRelationships.some((item) => item.status === 'ACTIVE' && item.effectiveFrom <= at && (!item.effectiveTo || item.effectiveTo > at))
        || Boolean(personnel.internalDriverProfile?.eligibilityPeriods.some((item) => item.status === 'ELIGIBLE' && item.effectiveFrom <= at && (!item.effectiveTo || item.effectiveTo > at)))
      );
    });
    return projectExternalDriverReadiness({ lifecycleStatus: driver.status, documents: driver.documents, continuityLinkedToActiveInternalIdentity: continuity }, at).status === 'READY';
  }).map((driver) => ({ id: driver.id, firstName: driver.firstName, lastName: driver.lastName, nationalCode: driver.nationalCode, phone: driver.phone }));
  const readyExternalVehicles = externalVehicles.flatMap((vehicle) => {
    const plate = vehicle.plates.find((item) => item.effectiveFrom <= at && (!item.effectiveTo || item.effectiveTo > at));
    const readiness = projectExternalVehicleReadiness({ lifecycleStatus: vehicle.status, hasCurrentPlate: Boolean(plate), documents: vehicle.documents }, at);
    return readiness.status === 'READY' && plate ? [{ id: vehicle.id, vehicleType: vehicle.vehicleType, plate: plate.plate }] : [];
  });
  return { internalAssignments, externalDrivers: readyExternalDrivers, externalVehicles: readyExternalVehicles };
};
