import express, { Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { protect, AuthRequest } from '../middleware/auth';
import { FEATURE_PERMISSIONS, FEATURES, requireFeatureAccess } from '../middleware/feature';
import { appendDispatchMasterDataAudit } from '../services/dispatchMasterDataAudit';
import { assertValidEffectivePeriod, normalizeIranianPlate, projectInternalDriverReadiness } from '../services/dispatchMasterDataPolicy';

const router = express.Router();
const prisma = new PrismaClient();
router.use(protect);

const internalView = requireFeatureAccess(FEATURES.HR_INTERNAL_DRIVERS_VIEW, FEATURE_PERMISSIONS.VIEW);
const internalManage = requireFeatureAccess(FEATURES.HR_INTERNAL_DRIVERS_MANAGE, FEATURE_PERMISSIONS.EDIT);
const fleetView = requireFeatureAccess(FEATURES.HR_VEHICLE_OPERATIONS_VIEW, FEATURE_PERMISSIONS.VIEW);
const fleetManage = requireFeatureAccess(FEATURES.HR_VEHICLE_OPERATIONS_MANAGE, FEATURE_PERMISSIONS.EDIT);
const externalView = requireFeatureAccess(FEATURES.SECURITY_EXTERNAL_DRIVERS_VIEW, FEATURE_PERMISSIONS.VIEW);
const externalManage = requireFeatureAccess(FEATURES.SECURITY_EXTERNAL_DRIVERS_MANAGE, FEATURE_PERMISSIONS.EDIT);

const actor = (req: AuthRequest) => req.user!.id;
const text = (value: unknown, label: string) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
};
const optionalText = (value: unknown) => String(value ?? '').trim() || null;
const date = (value: unknown, label: string) => {
  const parsed = new Date(String(value ?? ''));
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} must be a valid date.`);
  return parsed;
};
const optionalDate = (value: unknown, label: string) => value ? date(value, label) : null;
const activeAt = (at: Date) => ({ effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] });
const periodConflict = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2003', 'P2010'].includes(error.code);
const fail = (res: Response, error: unknown, context: string) => {
  console.error(context, error);
  if (periodConflict(error) || (error instanceof Error && /overlap|already effective/i.test(error.message))) {
    return res.status(409).json({ success: false, error: 'The requested effective period conflicts with existing canonical master data.' });
  }
  return res.status(400).json({ success: false, error: error instanceof Error ? error.message : 'Invalid master-data request.' });
};

const internalInclude = {
  personnel: { include: { hrEmploymentRelationships: { orderBy: { effectiveFrom: 'desc' as const } } } },
  eligibilityPeriods: { orderBy: { effectiveFrom: 'desc' as const } },
  vehicleAssignments: {
    orderBy: { effectiveFrom: 'desc' as const },
    include: { vehicle: { include: { plates: { orderBy: { effectiveFrom: 'desc' as const } } } } },
  },
} as const;

const projectDriver = (driver: any, at = new Date()) => {
  const eligibility = driver.eligibilityPeriods.find((period: any) => period.effectiveFrom <= at && (!period.effectiveTo || period.effectiveTo > at));
  const assignment = driver.vehicleAssignments.find((item: any) => item.effectiveFrom <= at && (!item.effectiveTo || item.effectiveTo > at));
  const employment = driver.personnel.hrEmploymentRelationships.some((item: any) => item.status === 'ACTIVE' && item.effectiveFrom <= at && (!item.effectiveTo || item.effectiveTo > at));
  return {
    ...driver,
    source: 'HR_PERSONNEL',
    currentEligibility: eligibility || null,
    currentAssignment: assignment || null,
    readiness: projectInternalDriverReadiness({
      personnelActive: driver.personnel.isActive && !driver.personnel.archivedAt,
      activeEmployment: employment,
      eligible: eligibility?.status === 'ELIGIBLE',
      drivingProfileActive: driver.status === 'ACTIVE',
      licenceExpiresAt: driver.licenceExpiresAt,
      assignedVehicleInService: assignment ? assignment.vehicle.status === 'IN_SERVICE' : null,
    }, at),
  };
};

router.get('/internal-drivers', internalView, async (req, res) => {
  try {
    const at = req.query.at ? date(req.query.at, 'at') : new Date();
    const drivers = await prisma.internalDriverProfile.findMany({ include: internalInclude, orderBy: { createdAt: 'desc' } });
    return res.json({ success: true, data: drivers.map((driver) => projectDriver(driver, at)) });
  } catch (error) { return fail(res, error, 'List internal drivers'); }
});

router.post('/internal-drivers', internalManage, async (req: AuthRequest, res) => {
  try {
    const effectiveFrom = date(req.body.effectiveFrom, 'effectiveFrom');
    const reason = text(req.body.reason, 'reason');
    const created = await prisma.$transaction(async (tx) => {
      const personnel = await tx.personnel.findUnique({ where: { id: text(req.body.personnelId, 'personnelId') } });
      if (!personnel || !personnel.isActive || personnel.archivedAt) throw new Error('An active Personnel record is required.');
      const driver = await tx.internalDriverProfile.create({ data: {
        personnelId: personnel.id,
        licenceNumber: text(req.body.licenceNumber, 'licenceNumber'),
        licenceClass: optionalText(req.body.licenceClass),
        licenceExpiresAt: optionalDate(req.body.licenceExpiresAt, 'licenceExpiresAt'),
        notes: optionalText(req.body.notes),
        createdBy: actor(req),
      } });
      await tx.internalDriverEligibilityPeriod.create({ data: { driverId: driver.id, status: 'ELIGIBLE', effectiveFrom, reason, recordedBy: actor(req) } });
      await appendDispatchMasterDataAudit(tx, { subjectType: 'INTERNAL_DRIVER', subjectId: driver.id, eventType: 'INTERNAL_DRIVER_DESIGNATED', payload: { personnelId: personnel.id, effectiveFrom, reason }, actorId: actor(req) });
      return tx.internalDriverProfile.findUniqueOrThrow({ where: { id: driver.id }, include: internalInclude });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return res.status(201).json({ success: true, data: projectDriver(created) });
  } catch (error) { return fail(res, error, 'Create internal driver'); }
});

router.post('/internal-drivers/:id/eligibility', internalManage, async (req: AuthRequest, res) => {
  try {
    const status = text(req.body.status, 'status') as 'ELIGIBLE' | 'SUSPENDED' | 'ENDED';
    if (!['ELIGIBLE', 'SUSPENDED', 'ENDED'].includes(status)) throw new Error('Unsupported eligibility status.');
    const effectiveFrom = date(req.body.effectiveFrom, 'effectiveFrom');
    const reason = text(req.body.reason, 'reason');
    const result = await prisma.$transaction(async (tx) => {
      const driver = await tx.internalDriverProfile.findUnique({ where: { id: req.params.id } });
      if (!driver) throw new Error('Internal driver was not found.');
      const current = await tx.internalDriverEligibilityPeriod.findFirst({ where: { driverId: driver.id, ...activeAt(effectiveFrom) }, orderBy: { effectiveFrom: 'desc' } });
      if (current?.effectiveFrom.getTime() === effectiveFrom.getTime()) throw new Error('A recorded eligibility transition already exists at this time.');
      if (current) await tx.internalDriverEligibilityPeriod.update({ where: { id: current.id }, data: { effectiveTo: effectiveFrom } });
      const period = await tx.internalDriverEligibilityPeriod.create({ data: { driverId: driver.id, status, effectiveFrom, reason, recordedBy: actor(req) } });
      await appendDispatchMasterDataAudit(tx, { subjectType: 'INTERNAL_DRIVER', subjectId: driver.id, eventType: `ELIGIBILITY_${status}`, payload: { periodId: period.id, effectiveFrom, reason }, actorId: actor(req) });
      return tx.internalDriverProfile.findUniqueOrThrow({ where: { id: driver.id }, include: internalInclude });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return res.json({ success: true, data: projectDriver(result) });
  } catch (error) { return fail(res, error, 'Transition internal driver eligibility'); }
});

router.put('/internal-drivers/:id/profile', fleetManage, async (req: AuthRequest, res) => {
  try {
    const reason = text(req.body.reason, 'reason');
    const result = await prisma.$transaction(async (tx) => {
      const previous = await tx.internalDriverProfile.findUnique({ where: { id: req.params.id } });
      if (!previous) throw new Error('Internal driving profile was not found.');
      const updated = await tx.internalDriverProfile.update({ where: { id: previous.id }, data: {
        licenceNumber: text(req.body.licenceNumber, 'licenceNumber'),
        licenceClass: optionalText(req.body.licenceClass),
        licenceExpiresAt: optionalDate(req.body.licenceExpiresAt, 'licenceExpiresAt'),
        notes: optionalText(req.body.notes),
      } });
      await appendDispatchMasterDataAudit(tx, { subjectType: 'INTERNAL_DRIVER', subjectId: updated.id, eventType: 'DRIVING_PROFILE_UPDATED', payload: { before: { licenceNumber: previous.licenceNumber, licenceClass: previous.licenceClass, licenceExpiresAt: previous.licenceExpiresAt, notes: previous.notes }, after: { licenceNumber: updated.licenceNumber, licenceClass: updated.licenceClass, licenceExpiresAt: updated.licenceExpiresAt, notes: updated.notes }, reason }, actorId: actor(req) });
      return tx.internalDriverProfile.findUniqueOrThrow({ where: { id: updated.id }, include: internalInclude });
    });
    return res.json({ success: true, data: projectDriver(result) });
  } catch (error) { return fail(res, error, 'Update internal driving profile'); }
});

router.get('/company-vehicles', fleetView, async (_req, res) => {
  try {
    const vehicles = await prisma.companyVehicle.findMany({ include: { plates: { orderBy: { effectiveFrom: 'desc' } }, assignments: { include: { driver: { include: { personnel: true } } }, orderBy: { effectiveFrom: 'desc' } } }, orderBy: { createdAt: 'desc' } });
    return res.json({ success: true, data: vehicles.map((vehicle) => ({ ...vehicle, source: 'COMPANY_FLEET' })) });
  } catch (error) { return fail(res, error, 'List company vehicles'); }
});

router.post('/company-vehicles', fleetManage, async (req: AuthRequest, res) => {
  try {
    const effectiveFrom = date(req.body.effectiveFrom, 'effectiveFrom');
    const plate = text(req.body.plate, 'plate');
    const reason = text(req.body.reason, 'reason');
    const vehicle = await prisma.$transaction(async (tx) => {
      const created = await tx.companyVehicle.create({ data: { fleetCode: text(req.body.fleetCode, 'fleetCode'), vehicleType: text(req.body.vehicleType, 'vehicleType'), make: optionalText(req.body.make), model: optionalText(req.body.model), vin: optionalText(req.body.vin), notes: optionalText(req.body.notes), createdBy: actor(req) } });
      await tx.companyVehiclePlate.create({ data: { vehicleId: created.id, plate, normalizedPlate: normalizeIranianPlate(plate), effectiveFrom, reason, recordedBy: actor(req) } });
      await appendDispatchMasterDataAudit(tx, { subjectType: 'COMPANY_VEHICLE', subjectId: created.id, eventType: 'COMPANY_VEHICLE_CREATED', payload: { fleetCode: created.fleetCode, plate, effectiveFrom, reason }, actorId: actor(req) });
      return tx.companyVehicle.findUniqueOrThrow({ where: { id: created.id }, include: { plates: true, assignments: true } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return res.status(201).json({ success: true, data: { ...vehicle, source: 'COMPANY_FLEET' } });
  } catch (error) { return fail(res, error, 'Create company vehicle'); }
});

router.post('/company-vehicles/:id/plates', fleetManage, async (req: AuthRequest, res) => {
  try {
    const effectiveFrom = date(req.body.effectiveFrom, 'effectiveFrom');
    const plate = text(req.body.plate, 'plate');
    const reason = text(req.body.reason, 'reason');
    const result = await prisma.$transaction(async (tx) => {
      const vehicle = await tx.companyVehicle.findUnique({ where: { id: req.params.id } });
      if (!vehicle) throw new Error('Company vehicle was not found.');
      const current = await tx.companyVehiclePlate.findFirst({ where: { vehicleId: vehicle.id, ...activeAt(effectiveFrom) }, orderBy: { effectiveFrom: 'desc' } });
      if (current) await tx.companyVehiclePlate.update({ where: { id: current.id }, data: { effectiveTo: effectiveFrom } });
      const created = await tx.companyVehiclePlate.create({ data: { vehicleId: vehicle.id, plate, normalizedPlate: normalizeIranianPlate(plate), effectiveFrom, reason, recordedBy: actor(req) } });
      await appendDispatchMasterDataAudit(tx, { subjectType: 'COMPANY_VEHICLE', subjectId: vehicle.id, eventType: 'VEHICLE_PLATE_CHANGED', payload: { plateId: created.id, plate, effectiveFrom, reason }, actorId: actor(req) });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return res.status(201).json({ success: true, data: result });
  } catch (error) { return fail(res, error, 'Change company vehicle plate'); }
});

router.post('/company-vehicles/:id/status', fleetManage, async (req: AuthRequest, res) => {
  try {
    const status = text(req.body.status, 'status') as 'IN_SERVICE' | 'OUT_OF_SERVICE' | 'RETIRED';
    if (!['IN_SERVICE', 'OUT_OF_SERVICE', 'RETIRED'].includes(status)) throw new Error('Unsupported vehicle status.');
    const reason = text(req.body.reason, 'reason');
    const updated = await prisma.$transaction(async (tx) => {
      const vehicle = await tx.companyVehicle.update({ where: { id: req.params.id }, data: { status } });
      await appendDispatchMasterDataAudit(tx, { subjectType: 'COMPANY_VEHICLE', subjectId: vehicle.id, eventType: `VEHICLE_${status}`, payload: { reason }, actorId: actor(req) });
      return vehicle;
    });
    return res.json({ success: true, data: updated });
  } catch (error) { return fail(res, error, 'Transition company vehicle status'); }
});

router.post('/driver-vehicle-assignments', fleetManage, async (req: AuthRequest, res) => {
  try {
    const effectiveFrom = date(req.body.effectiveFrom, 'effectiveFrom');
    const effectiveTo = optionalDate(req.body.effectiveTo, 'effectiveTo');
    assertValidEffectivePeriod(effectiveFrom, effectiveTo);
    const driverId = text(req.body.driverId, 'driverId');
    const vehicleId = text(req.body.vehicleId, 'vehicleId');
    const reason = text(req.body.reason, 'reason');
    const assignment = await prisma.$transaction(async (tx) => {
      const [driver, vehicle] = await Promise.all([tx.internalDriverProfile.findUnique({ where: { id: driverId } }), tx.companyVehicle.findUnique({ where: { id: vehicleId } })]);
      if (!driver || driver.status !== 'ACTIVE') throw new Error('An active internal driving profile is required.');
      if (!vehicle || vehicle.status !== 'IN_SERVICE') throw new Error('An in-service company vehicle is required.');
      const [driverCurrent, vehicleCurrent] = await Promise.all([
        tx.driverVehicleAssignment.findFirst({ where: { driverId, ...activeAt(effectiveFrom) }, orderBy: { effectiveFrom: 'desc' } }),
        tx.driverVehicleAssignment.findFirst({ where: { vehicleId, ...activeAt(effectiveFrom) }, orderBy: { effectiveFrom: 'desc' } }),
      ]);
      for (const current of [driverCurrent, vehicleCurrent]) {
        if (current && current.id !== driverCurrent?.id) await tx.driverVehicleAssignment.update({ where: { id: current.id }, data: { effectiveTo: effectiveFrom } });
      }
      if (driverCurrent) await tx.driverVehicleAssignment.update({ where: { id: driverCurrent.id }, data: { effectiveTo: effectiveFrom } });
      const created = await tx.driverVehicleAssignment.create({ data: { driverId, vehicleId, effectiveFrom, effectiveTo, reason, recordedBy: actor(req) } });
      await appendDispatchMasterDataAudit(tx, { subjectType: 'INTERNAL_DRIVER', subjectId: driverId, eventType: 'VEHICLE_ASSIGNED', payload: { assignmentId: created.id, vehicleId, effectiveFrom, effectiveTo, reason }, actorId: actor(req) });
      await appendDispatchMasterDataAudit(tx, { subjectType: 'COMPANY_VEHICLE', subjectId: vehicleId, eventType: 'DRIVER_ASSIGNED', payload: { assignmentId: created.id, driverId, effectiveFrom, effectiveTo, reason }, actorId: actor(req) });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return res.status(201).json({ success: true, data: assignment });
  } catch (error) { return fail(res, error, 'Assign company vehicle'); }
});

router.get('/external-registry', externalView, async (_req, res) => {
  try {
    const [drivers, vehicles, legacyPairs] = await Promise.all([
      prisma.externalDriver.findMany({ include: { externalLinks: true }, orderBy: { createdAt: 'desc' } }),
      prisma.externalVehicle.findMany({ include: { plates: { orderBy: { effectiveFrom: 'desc' } } }, orderBy: { createdAt: 'desc' } }),
      prisma.securityVehiclePair.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, firstName: true, lastName: true, nationalCode: true, phone: true, vehiclePlate: true, vehicleType: true, isActive: true, createdAt: true } }),
    ]);
    return res.json({ success: true, data: {
      drivers: drivers.map((item) => ({ ...item, source: 'GUARD_EXTERNAL' })),
      vehicles: vehicles.map((item) => ({ ...item, source: 'GUARD_EXTERNAL' })),
      legacyPairs: legacyPairs.map((item) => ({ ...item, source: 'LEGACY_COMBINED', historicalOnly: true, readiness: { status: 'NOT_READY', blockers: ['LEGACY_SOURCE_ONLY'] } })),
    } });
  } catch (error) { return fail(res, error, 'List external registry'); }
});

router.post('/external-drivers', externalManage, async (req: AuthRequest, res) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.externalDriver.create({ data: { firstName: text(req.body.firstName, 'firstName'), lastName: text(req.body.lastName, 'lastName'), nationalCode: text(req.body.nationalCode, 'nationalCode'), phone: text(req.body.phone, 'phone'), notes: optionalText(req.body.notes), createdBy: actor(req) } });
      await appendDispatchMasterDataAudit(tx, { subjectType: 'EXTERNAL_DRIVER', subjectId: created.id, eventType: 'EXTERNAL_DRIVER_CREATED', payload: { nationalCode: created.nationalCode }, actorId: actor(req) });
      return created;
    });
    return res.status(201).json({ success: true, data: { ...result, source: 'GUARD_EXTERNAL' } });
  } catch (error) { return fail(res, error, 'Create external driver'); }
});

router.post('/external-vehicles', externalManage, async (req: AuthRequest, res) => {
  try {
    const effectiveFrom = date(req.body.effectiveFrom, 'effectiveFrom');
    const plate = text(req.body.plate, 'plate');
    const reason = text(req.body.reason, 'reason');
    const result = await prisma.$transaction(async (tx) => {
      const vehicle = await tx.externalVehicle.create({ data: { vehicleType: text(req.body.vehicleType, 'vehicleType'), notes: optionalText(req.body.notes), createdBy: actor(req) } });
      await tx.externalVehiclePlate.create({ data: { vehicleId: vehicle.id, plate, normalizedPlate: normalizeIranianPlate(plate), effectiveFrom, reason, recordedBy: actor(req) } });
      await appendDispatchMasterDataAudit(tx, { subjectType: 'EXTERNAL_VEHICLE', subjectId: vehicle.id, eventType: 'EXTERNAL_VEHICLE_CREATED', payload: { plate, effectiveFrom, reason }, actorId: actor(req) });
      return tx.externalVehicle.findUniqueOrThrow({ where: { id: vehicle.id }, include: { plates: true } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return res.status(201).json({ success: true, data: { ...result, source: 'GUARD_EXTERNAL' } });
  } catch (error) { return fail(res, error, 'Create external vehicle'); }
});

router.post('/external-vehicles/:id/plates', externalManage, async (req: AuthRequest, res) => {
  try {
    const effectiveFrom = date(req.body.effectiveFrom, 'effectiveFrom');
    const plate = text(req.body.plate, 'plate');
    const reason = text(req.body.reason, 'reason');
    const result = await prisma.$transaction(async (tx) => {
      const vehicle = await tx.externalVehicle.findUnique({ where: { id: req.params.id } });
      if (!vehicle) throw new Error('External vehicle was not found.');
      const current = await tx.externalVehiclePlate.findFirst({ where: { vehicleId: vehicle.id, ...activeAt(effectiveFrom) }, orderBy: { effectiveFrom: 'desc' } });
      if (current) await tx.externalVehiclePlate.update({ where: { id: current.id }, data: { effectiveTo: effectiveFrom } });
      const created = await tx.externalVehiclePlate.create({ data: { vehicleId: vehicle.id, plate, normalizedPlate: normalizeIranianPlate(plate), effectiveFrom, reason, recordedBy: actor(req) } });
      await appendDispatchMasterDataAudit(tx, { subjectType: 'EXTERNAL_VEHICLE', subjectId: vehicle.id, eventType: 'VEHICLE_PLATE_CHANGED', payload: { plateId: created.id, plate, effectiveFrom, reason }, actorId: actor(req) });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return res.status(201).json({ success: true, data: result });
  } catch (error) { return fail(res, error, 'Change external vehicle plate'); }
});

router.post('/external-drivers/:id/status', externalManage, async (req: AuthRequest, res) => {
  try {
    const status = text(req.body.status, 'status') as 'ACTIVE' | 'SUSPENDED' | 'RETIRED';
    if (!['ACTIVE', 'SUSPENDED', 'RETIRED'].includes(status)) throw new Error('Unsupported driver status.');
    const reason = text(req.body.reason, 'reason');
    const updated = await prisma.$transaction(async (tx) => {
      const record = await tx.externalDriver.update({ where: { id: req.params.id }, data: { status } });
      await appendDispatchMasterDataAudit(tx, { subjectType: 'EXTERNAL_DRIVER', subjectId: record.id, eventType: `EXTERNAL_DRIVER_${status}`, payload: { reason }, actorId: actor(req) });
      return record;
    });
    return res.json({ success: true, data: updated });
  } catch (error) { return fail(res, error, 'Transition external driver status'); }
});

router.post('/external-vehicles/:id/status', externalManage, async (req: AuthRequest, res) => {
  try {
    const status = text(req.body.status, 'status') as 'IN_SERVICE' | 'OUT_OF_SERVICE' | 'RETIRED';
    if (!['IN_SERVICE', 'OUT_OF_SERVICE', 'RETIRED'].includes(status)) throw new Error('Unsupported vehicle status.');
    const reason = text(req.body.reason, 'reason');
    const updated = await prisma.$transaction(async (tx) => {
      const record = await tx.externalVehicle.update({ where: { id: req.params.id }, data: { status } });
      await appendDispatchMasterDataAudit(tx, { subjectType: 'EXTERNAL_VEHICLE', subjectId: record.id, eventType: `EXTERNAL_VEHICLE_${status}`, payload: { reason }, actorId: actor(req) });
      return record;
    });
    return res.json({ success: true, data: updated });
  } catch (error) { return fail(res, error, 'Transition external vehicle status'); }
});

router.post('/external-drivers/:id/personnel-continuity', externalManage, async (req: AuthRequest, res) => {
  try {
    const reason = text(req.body.reason, 'reason');
    const personnelId = text(req.body.personnelId, 'personnelId');
    const link = await prisma.$transaction(async (tx) => {
      const personnel = await tx.personnel.findUnique({ where: { id: personnelId } });
      if (!personnel) throw new Error('Personnel was not found.');
      const created = await tx.externalDriverPersonnelContinuityLink.create({ data: { externalDriverId: req.params.id, personnelId, reason, recordedBy: actor(req) } });
      await appendDispatchMasterDataAudit(tx, { subjectType: 'EXTERNAL_DRIVER', subjectId: req.params.id, eventType: 'PERSONNEL_CONTINUITY_LINKED', payload: { personnelId, reason }, actorId: actor(req) });
      return created;
    });
    return res.status(201).json({ success: true, data: link });
  } catch (error) { return fail(res, error, 'Link external driver continuity'); }
});

router.get('/audit/:subjectType/:subjectId', internalView, async (req, res) => {
  try {
    const data = await prisma.dispatchMasterDataAudit.findMany({ where: { subjectType: req.params.subjectType, subjectId: req.params.subjectId }, orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] });
    return res.json({ success: true, data });
  } catch (error) { return fail(res, error, 'Read dispatch master-data audit'); }
});

export default router;
