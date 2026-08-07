import express from 'express';
import { Prisma } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { FEATURE_PERMISSIONS, FEATURES, requireFeatureAccess, requireNarrowFeatureAccess } from '../middleware/feature';
import { appendDispatchMasterDataAudit } from '../services/dispatchMasterDataAudit';
import { assertLifecycleTransition, assertValidEffectivePeriod, canPermanentlyDeleteDraft, normalizeIranianPlate } from '../services/dispatchMasterDataPolicy';
import { activeAt, actor, fail, internalInclude, optionalDate, optionalText, parsedDate, prisma, projectDriver, requiredText } from './dispatch-master-data.shared';

const router = express.Router();
const view = requireFeatureAccess(FEATURES.HR_VEHICLE_OPERATIONS_VIEW, FEATURE_PERMISSIONS.VIEW);
const manageProfiles = requireNarrowFeatureAccess(FEATURES.HR_DRIVER_PROFILES_MANAGE, FEATURE_PERMISSIONS.EDIT);
const manageVehicles = requireNarrowFeatureAccess(FEATURES.HR_COMPANY_VEHICLES_MANAGE, FEATURE_PERMISSIONS.EDIT);
const managePlates = requireNarrowFeatureAccess(FEATURES.HR_VEHICLE_PLATES_MANAGE, FEATURE_PERMISSIONS.EDIT);
const manageAssignments = requireNarrowFeatureAccess(FEATURES.HR_DRIVER_VEHICLE_ASSIGNMENTS_MANAGE, FEATURE_PERMISSIONS.EDIT);

router.get('/vehicle-operations/internal-drivers', view, async (req, res) => {
  try {
    const at = req.query.at ? parsedDate(req.query.at, 'at') : new Date();
    const drivers = await prisma.internalDriverProfile.findMany({ include: internalInclude, orderBy: { createdAt: 'desc' } });
    return res.json({ success: true, data: drivers.map((driver) => projectDriver(driver, at)) });
  } catch (error) { return fail(res, error, 'List Vehicle Operations driving profiles'); }
});

router.put('/internal-drivers/:id/profile', manageProfiles, async (req: AuthRequest, res) => {
  try {
    const reason = requiredText(req.body.reason, 'reason');
    const result = await prisma.$transaction(async (tx) => {
      const previous = await tx.internalDriverProfile.findUnique({ where: { id: req.params.id } });
      if (!previous) throw new Error('Internal driving profile was not found.');
      if (previous.status === 'ARCHIVED') throw new Error('Restore the archived profile before editing it.');
      const updated = await tx.internalDriverProfile.update({ where: { id: previous.id }, data: {
        licenceNumber: requiredText(req.body.licenceNumber, 'licenceNumber'), licenceClass: optionalText(req.body.licenceClass),
        licenceExpiresAt: optionalDate(req.body.licenceExpiresAt, 'licenceExpiresAt'), notes: optionalText(req.body.notes),
      } });
      await appendDispatchMasterDataAudit(tx, { ownerScope: 'VEHICLE_OPERATIONS', subjectType: 'INTERNAL_DRIVER_PROFILE', subjectId: updated.id, eventType: 'DRIVING_PROFILE_UPDATED', payload: { reason }, actorId: actor(req) });
      return tx.internalDriverProfile.findUniqueOrThrow({ where: { id: updated.id }, include: internalInclude });
    });
    return res.json({ success: true, data: projectDriver(result) });
  } catch (error) { return fail(res, error, 'Update internal driving profile'); }
});

router.post('/internal-drivers/:id/profile-status', manageProfiles, async (req: AuthRequest, res) => {
  try {
    const next = requiredText(req.body.status, 'status') as 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
    const reason = requiredText(req.body.reason, 'reason');
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.internalDriverProfile.findUnique({ where: { id: req.params.id } });
      if (!current) throw new Error('Internal driving profile was not found.');
      assertLifecycleTransition('INTERNAL_DRIVER_PROFILE', current.status, next);
      if (next === 'ACTIVE' && (!current.licenceNumber || !current.licenceClass || !current.licenceExpiresAt || current.licenceExpiresAt <= new Date())) throw new Error('A licence number, licence class, and future licence expiry are required for activation.');
      const record = await tx.internalDriverProfile.update({ where: { id: current.id }, data: { status: next } });
      await appendDispatchMasterDataAudit(tx, { ownerScope: 'VEHICLE_OPERATIONS', subjectType: 'INTERNAL_DRIVER_PROFILE', subjectId: record.id, eventType: `DRIVING_PROFILE_${next}`, payload: { reason }, actorId: actor(req) });
      return record;
    });
    return res.json({ success: true, data: updated });
  } catch (error) { return fail(res, error, 'Transition internal driving profile'); }
});

router.get('/company-vehicles', view, async (_req, res) => {
  try {
    const vehicles = await prisma.companyVehicle.findMany({ include: { plates: { orderBy: { effectiveFrom: 'desc' } }, assignments: { include: { driver: { include: { personnel: true } } }, orderBy: { effectiveFrom: 'desc' } } }, orderBy: { createdAt: 'desc' } });
    return res.json({ success: true, data: vehicles.map((vehicle) => ({ ...vehicle, source: 'COMPANY_FLEET' })) });
  } catch (error) { return fail(res, error, 'List company vehicles'); }
});

router.post('/company-vehicles', manageVehicles, async (req: AuthRequest, res) => {
  try {
    const reason = requiredText(req.body.reason, 'reason');
    const vehicle = await prisma.$transaction(async (tx) => {
      const created = await tx.companyVehicle.create({ data: { fleetCode: requiredText(req.body.fleetCode, 'fleetCode'), vehicleType: requiredText(req.body.vehicleType, 'vehicleType'), make: optionalText(req.body.make), model: optionalText(req.body.model), vin: optionalText(req.body.vin), notes: optionalText(req.body.notes), statusReason: reason, statusRecordedBy: actor(req), createdBy: actor(req) } });
      if (req.body.plate) {
        const effectiveFrom = parsedDate(req.body.effectiveFrom, 'effectiveFrom');
        const plate = requiredText(req.body.plate, 'plate');
        await tx.companyVehiclePlate.create({ data: { vehicleId: created.id, plate, normalizedPlate: normalizeIranianPlate(plate), effectiveFrom, reason, recordedBy: actor(req) } });
      }
      await appendDispatchMasterDataAudit(tx, { ownerScope: 'VEHICLE_OPERATIONS', subjectType: 'COMPANY_VEHICLE', subjectId: created.id, eventType: 'COMPANY_VEHICLE_DRAFT_CREATED', payload: { fleetCode: created.fleetCode, reason }, actorId: actor(req) });
      return tx.companyVehicle.findUniqueOrThrow({ where: { id: created.id }, include: { plates: true, assignments: true } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return res.status(201).json({ success: true, data: { ...vehicle, source: 'COMPANY_FLEET' } });
  } catch (error) { return fail(res, error, 'Create company-vehicle draft'); }
});

router.post('/company-vehicles/:id/plates', managePlates, async (req: AuthRequest, res) => {
  try {
    const effectiveFrom = parsedDate(req.body.effectiveFrom, 'effectiveFrom'); const plate = requiredText(req.body.plate, 'plate'); const reason = requiredText(req.body.reason, 'reason');
    const result = await prisma.$transaction(async (tx) => {
      const vehicle = await tx.companyVehicle.findUnique({ where: { id: req.params.id } });
      if (!vehicle || vehicle.status === 'ARCHIVED') throw new Error('An unarchived company vehicle is required.');
      const current = await tx.companyVehiclePlate.findFirst({ where: { vehicleId: vehicle.id, ...activeAt(effectiveFrom) }, orderBy: { effectiveFrom: 'desc' } });
      if (current) await tx.companyVehiclePlate.update({ where: { id: current.id }, data: { effectiveTo: effectiveFrom } });
      const created = await tx.companyVehiclePlate.create({ data: { vehicleId: vehicle.id, plate, normalizedPlate: normalizeIranianPlate(plate), effectiveFrom, reason, recordedBy: actor(req) } });
      await appendDispatchMasterDataAudit(tx, { ownerScope: 'VEHICLE_OPERATIONS', subjectType: 'COMPANY_VEHICLE', subjectId: vehicle.id, eventType: 'VEHICLE_PLATE_CHANGED', payload: { plateId: created.id, plate, effectiveFrom, reason }, actorId: actor(req) });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return res.status(201).json({ success: true, data: result });
  } catch (error) { return fail(res, error, 'Change company vehicle plate'); }
});

router.post('/company-vehicles/:id/status', manageVehicles, async (req: AuthRequest, res) => {
  try {
    const next = requiredText(req.body.status, 'status') as 'DRAFT' | 'ACTIVE' | 'OUT_OF_SERVICE' | 'ARCHIVED';
    const reason = requiredText(req.body.reason, 'reason'); const effectiveFrom = parsedDate(req.body.effectiveFrom, 'effectiveFrom');
    if (effectiveFrom > new Date()) throw new Error('Lifecycle changes cannot take effect in the future.');
    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.companyVehicle.findUnique({ where: { id: req.params.id }, include: { plates: true } });
      if (!current) throw new Error('Company vehicle was not found.');
      assertLifecycleTransition('COMPANY_VEHICLE', current.status, next);
      if (next === 'ACTIVE' && !current.plates.some((plate) => plate.effectiveFrom <= effectiveFrom && (!plate.effectiveTo || plate.effectiveTo > effectiveFrom))) throw new Error('A current effective plate is required for activation.');
      const record = await tx.companyVehicle.update({ where: { id: current.id }, data: { status: next, statusEffectiveFrom: effectiveFrom, statusReason: reason, statusRecordedBy: actor(req) } });
      await appendDispatchMasterDataAudit(tx, { ownerScope: 'VEHICLE_OPERATIONS', subjectType: 'COMPANY_VEHICLE', subjectId: record.id, eventType: `COMPANY_VEHICLE_${next}`, payload: { effectiveFrom, reason }, actorId: actor(req) });
      return record;
    });
    return res.json({ success: true, data: updated });
  } catch (error) { return fail(res, error, 'Transition company vehicle'); }
});

router.delete('/company-vehicles/:id', manageVehicles, async (req: AuthRequest, res) => {
  try {
    const deleted = await prisma.$transaction(async (tx) => {
      const current = await tx.companyVehicle.findUnique({ where: { id: req.params.id }, include: { _count: { select: { assignments: true } } } });
      if (!current) throw new Error('Company vehicle was not found.');
      if (!canPermanentlyDeleteDraft({ status: current.status, dependencyCount: current._count.assignments })) throw new Error('Only an unused draft may be permanently deleted.');
      await appendDispatchMasterDataAudit(tx, { ownerScope: 'VEHICLE_OPERATIONS', subjectType: 'COMPANY_VEHICLE', subjectId: current.id, eventType: 'COMPANY_VEHICLE_DRAFT_DELETED', payload: { reason: requiredText(req.body.reason, 'reason') }, actorId: actor(req) });
      await tx.companyVehiclePlate.deleteMany({ where: { vehicleId: current.id } });
      await tx.companyVehicle.delete({ where: { id: current.id } });
      return current.id;
    });
    return res.json({ success: true, data: { id: deleted } });
  } catch (error) { return fail(res, error, 'Delete company-vehicle draft'); }
});

router.post('/driver-vehicle-assignments', manageAssignments, async (req: AuthRequest, res) => {
  try {
    const effectiveFrom = parsedDate(req.body.effectiveFrom, 'effectiveFrom'); const effectiveTo = optionalDate(req.body.effectiveTo, 'effectiveTo'); assertValidEffectivePeriod(effectiveFrom, effectiveTo);
    const driverId = requiredText(req.body.driverId, 'driverId'); const vehicleId = requiredText(req.body.vehicleId, 'vehicleId'); const reason = requiredText(req.body.reason, 'reason');
    const assignment = await prisma.$transaction(async (tx) => {
      const [driver, vehicle] = await Promise.all([tx.internalDriverProfile.findUnique({ where: { id: driverId } }), tx.companyVehicle.findUnique({ where: { id: vehicleId }, include: { plates: true } })]);
      if (!driver || driver.status !== 'ACTIVE') throw new Error('An active internal driving profile is required.');
      if (!vehicle || vehicle.status !== 'ACTIVE') throw new Error('An active company vehicle is required.');
      if (!vehicle.plates.some((plate) => plate.effectiveFrom <= effectiveFrom && (!plate.effectiveTo || plate.effectiveTo > effectiveFrom))) throw new Error('The company vehicle requires a current effective plate.');
      const [driverCurrent, vehicleCurrent] = await Promise.all([tx.driverVehicleAssignment.findFirst({ where: { driverId, ...activeAt(effectiveFrom) } }), tx.driverVehicleAssignment.findFirst({ where: { vehicleId, ...activeAt(effectiveFrom) } })]);
      const currentIds = new Set([driverCurrent?.id, vehicleCurrent?.id].filter(Boolean) as string[]);
      for (const id of currentIds) await tx.driverVehicleAssignment.update({ where: { id }, data: { effectiveTo: effectiveFrom } });
      const created = await tx.driverVehicleAssignment.create({ data: { driverId, vehicleId, effectiveFrom, effectiveTo, reason, recordedBy: actor(req) } });
      await appendDispatchMasterDataAudit(tx, { ownerScope: 'VEHICLE_OPERATIONS', subjectType: 'INTERNAL_DRIVER_PROFILE', subjectId: driverId, eventType: 'VEHICLE_ASSIGNED', payload: { assignmentId: created.id, vehicleId, effectiveFrom, effectiveTo, reason }, actorId: actor(req) });
      await appendDispatchMasterDataAudit(tx, { ownerScope: 'VEHICLE_OPERATIONS', subjectType: 'COMPANY_VEHICLE', subjectId: vehicleId, eventType: 'DRIVER_ASSIGNED', payload: { assignmentId: created.id, driverId, effectiveFrom, effectiveTo, reason }, actorId: actor(req) });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return res.status(201).json({ success: true, data: assignment });
  } catch (error) { return fail(res, error, 'Assign company vehicle'); }
});

export default router;
