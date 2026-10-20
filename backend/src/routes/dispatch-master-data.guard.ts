import express from 'express';
import { Prisma } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { FEATURES } from '../middleware/feature';
import { requireHrFeature } from '../middleware/hrAuthorization';
import { authorizeHrUser } from '../services/hrAuthorizationService';
import { assertLifecycleTransition, normalizeIranianPlate } from '../services/dispatchMasterDataPolicy';
import { activeAt, actor, fail, optionalText, optionalDate, prisma, requiredText } from './dispatch-master-data.shared';
import { HrVehicleError, lockHrVehicleOperations, externalAssignmentScope, auditHrVehicle,
  assertNoOpenHrOperations, endHrSubjectAssignments, ordinaryChangeInstant, afterPeriodStart } from '../services/hrVehicleOperations';
import { externalDriverInclude, externalVehicleInclude, externalDriverBlockers, externalVehicleBlockers,
  externalBlockerText } from '../services/externalVehicleOperations';
import { requireCompanyPlate, requireManufactureYear } from '../services/companyVehicleEntry';
import { createVehicleAssignmentRoutes } from './vehicle-assignment-routes';

const router = express.Router();
const view = requireHrFeature(FEATURES.HR_VEHICLE_OPERATIONS_VIEW, 'VIEW');
const profiles = requireHrFeature(FEATURES.HR_DRIVER_PROFILES_MANAGE, 'EDIT');
const vehicles = requireHrFeature(FEATURES.HR_COMPANY_VEHICLES_MANAGE, 'EDIT');
const plates = requireHrFeature(FEATURES.HR_VEHICLE_PLATES_MANAGE, 'EDIT');
const eligibility = requireHrFeature(FEATURES.HR_INTERNAL_DRIVER_ELIGIBILITY_MANAGE, 'EDIT');
const assignments = requireHrFeature(FEATURES.HR_DRIVER_VEHICLE_ASSIGNMENTS_MANAGE, 'EDIT');
const reason = 'ثبت خودکار اقدام راننده و خودروی بیرونی';
const capabilitiesFor = async (req: AuthRequest) => {
  const codes = { canManageProfiles: FEATURES.HR_DRIVER_PROFILES_MANAGE, canManageCompanyVehicles: FEATURES.HR_COMPANY_VEHICLES_MANAGE,
    canManagePlates: FEATURES.HR_VEHICLE_PLATES_MANAGE, canManageAssignments: FEATURES.HR_DRIVER_VEHICLE_ASSIGNMENTS_MANAGE,
    canManageEligibility: FEATURES.HR_INTERNAL_DRIVER_ELIGIBILITY_MANAGE, canManageBiometricEnrollment: FEATURES.HR_DRIVER_BIOMETRIC_ENROLLMENT_MANAGE };
  return Object.fromEntries(await Promise.all(Object.entries(codes).map(async ([key, code]) => [key,
    (await authorizeHrUser(prisma, actor(req), { workspaceLevel: 'EDIT', feature: { code, level: 'EDIT' } })).allowed])));
};
const transaction = <T>(run: (tx: ReturnType<typeof externalAssignmentScope>) => Promise<T>) => prisma.$transaction(async raw => {
  const tx = externalAssignmentScope(raw); await lockHrVehicleOperations(tx); return run(tx);
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
const licenceData = (body: any) => ({ licenceNumber: optionalText(body.licenceNumber), licenceClass: optionalText(body.licenceClass), licenceExpiresAt: optionalDate(body.licenceExpiresAt, 'licenceExpiresAt') });
const nameData = (body: any) => ({ firstName: requiredText(body.firstName, 'firstName'), lastName: requiredText(body.lastName, 'lastName'),
  nationalCode: requiredText(body.nationalCode, 'nationalCode'), phone: requiredText(body.phone, 'phone') });
const vehicleData = (body: any) => ({ vehicleType: requiredText(body.vehicleType, 'vehicleType'), fleetCode: optionalText(body.fleetCode),
  make: optionalText(body.make), model: optionalText(body.model), manufactureYear: requireManufactureYear(body.manufactureYear), vin: optionalText(body.vin), notes: optionalText(body.notes) });
const recordLicence = async (tx: Prisma.TransactionClient, id: string, body: any, actorId: string) => {
  if (body.licenceNumber && body.licenceExpiresAt) await tx.externalDriverDocument.create({ data: { driverId: id, documentType: 'DRIVING_LICENCE',
    reference: String(body.licenceNumber).trim(), expiresAt: optionalDate(body.licenceExpiresAt, 'licenceExpiresAt'), recordedBy: actorId } });
};
const recordRegistration = async (tx: Prisma.TransactionClient, id: string, body: any, actorId: string) => {
  if (optionalText(body.registrationReference)) await tx.externalVehicleDocument.create({ data: { vehicleId: id, documentType: 'VEHICLE_REGISTRATION',
    reference: String(body.registrationReference).trim(), expiresAt: optionalDate(body.registrationExpiresAt, 'registrationExpiresAt'), recordedBy: actorId } });
};
router.get('/external-registry', view, async (req: AuthRequest, res) => {
  try {
    const at = new Date(); const where = req.query.archived === 'only' ? { status: 'ARCHIVED' as const } : req.query.archived === 'include' ? {} : { status: { not: 'ARCHIVED' as const } };
    const [driverRows, vehicleRows, legacyPairs, capabilities] = await Promise.all([
      prisma.externalDriver.findMany({ where, include: { ...externalDriverInclude, assignments: { where: activeAt(at), include: { vehicle: { include: { plates: true } } } },
        biometricEnrollments: { where: { status: 'ACTIVE' }, select: { id: true } } }, orderBy: { createdAt: 'desc' } }),
      prisma.externalVehicle.findMany({ where, include: externalVehicleInclude, orderBy: { createdAt: 'desc' } }),
      prisma.securityVehiclePair.findMany({ select: { id: true, firstName: true, lastName: true, vehiclePlate: true } }), capabilitiesFor(req),
    ]);
    return res.json({ success: true, data: { drivers: driverRows.map(d => {
      const blockers = externalDriverBlockers(d, at); if (!d.assignments[0]) blockers.push('VEHICLE_NOT_ASSIGNED');
      if (!d.biometricEnrollments.length) blockers.push('ثبت بیومتریک فعال ندارد');
      if (d.assignments[0]) {
        const vehicle = vehicleRows.find(v => v.id === d.assignments[0].vehicleId);
        if (!vehicle) blockers.push('خودروی تخصیص‌یافته در دسترس نیست'); else blockers.push(...externalVehicleBlockers(vehicle, at));
      }
      const { externalLinks: _links, biometricEnrollments: _enrollments, ...identity } = d;
      return { ...identity, source: 'GUARD_EXTERNAL', currentEligibility: { status: d.status === 'ACTIVE' ? 'ELIGIBLE' : d.status === 'RESTRICTED' ? 'SUSPENDED' : 'ENDED' },
        currentAssignment: d.assignments[0] || null, readiness: { status: blockers.length ? 'NOT_READY' : 'READY', blockers: blockers.map(b => externalBlockerText([b])) } };
    }), vehicles: vehicleRows.map(v => ({ ...v, source: 'GUARD_EXTERNAL', readiness: { status: externalVehicleBlockers(v, at).length ? 'NOT_READY' : 'READY', blockers: externalVehicleBlockers(v, at) } })),
      legacyPairs, capabilities }, capabilities });
  } catch (e) { return fail(res, e, 'External registry'); }
});
router.get('/external-drivers/:id/eligibility', view, async (req: AuthRequest, res) => {
  try {
    const driver = await prisma.externalDriver.findUnique({ where: { id: req.params.id }, include: externalDriverInclude });
    if (!driver) throw new HrVehicleError('راننده بیرونی پیدا نشد.', 404);
    const enrollment = await prisma.driverBiometricEnrollment.findFirst({ where: { externalDriverId: driver.id, status: 'ACTIVE' }, select: {
      id: true, enrolledAt: true, confirmationPhone: true, templates: { select: { finger: true, format: true, imageMimeType: true, imageWidth: true, imageHeight: true, imageByteLength: true } } } });
    const { externalLinks: _links, ...identity } = driver;
    return res.json({ success: true, data: { identity, driver: { ...identity, currentEligibility: { status: driver.status === 'ACTIVE' ? 'ELIGIBLE' : driver.status === 'RESTRICTED' ? 'SUSPENDED' : 'ENDED', effectiveFrom: driver.statusEffectiveFrom, reason: driver.statusReason } }, activeBiometricEnrollment: enrollment }, capabilities: await capabilitiesFor(req) });
  } catch (e) { return fail(res, e, 'External driver dossier'); }
});
router.post('/external-drivers', profiles, async (req: AuthRequest, res) => {
  try { const data = await transaction(async tx => {
    const driver = await tx.externalDriver.create({ data: { ...nameData(req.body), ...licenceData(req.body), notes: optionalText(req.body.notes), createdBy: actor(req), statusReason: reason, statusRecordedBy: actor(req) } });
    await recordLicence(tx, driver.id, req.body, actor(req));
    await auditHrVehicle(tx, 'EXTERNAL_DRIVER', driver.id, 'EXTERNAL_DRIVER_CREATED', actor(req), { after: driver }); return driver;
  }); return res.status(201).json({ success: true, data }); } catch (e) { return fail(res, e, 'Create external driver'); }
});
router.put('/external-drivers/:id', profiles, async (req: AuthRequest, res) => {
  try { const data = await transaction(async tx => {
    const before = await tx.externalDriver.findUnique({ where: { id: req.params.id } });
    if (!before) throw new HrVehicleError('راننده بیرونی پیدا نشد.', 404);
    if (before.status === 'ARCHIVED') throw new HrVehicleError('ابتدا راننده را به پیش‌نویس بازگردانید.');
    const after = await tx.externalDriver.update({ where: { id: before.id }, data: { ...nameData({ ...before, ...req.body }), ...licenceData({ ...before, ...req.body }), notes: req.body.notes === undefined ? before.notes : optionalText(req.body.notes) } });
    await recordLicence(tx, after.id, { ...before, ...req.body }, actor(req));
    await auditHrVehicle(tx, 'EXTERNAL_DRIVER', after.id, 'EXTERNAL_DRIVER_UPDATED', actor(req), { before, after }); return after;
  }); return res.json({ success: true, data }); } catch (e) { return fail(res, e, 'Edit external driver'); }
});
router.post('/external-vehicles', vehicles, async (req: AuthRequest, res) => {
  try { const data = await transaction(async tx => {
    const vehicle = await tx.externalVehicle.create({ data: { ...vehicleData(req.body), createdBy: actor(req), statusReason: reason, statusRecordedBy: actor(req) } });
    if (req.body.plate) { const plate = requireCompanyPlate(req.body.plate); await tx.externalVehiclePlate.create({ data: { vehicleId: vehicle.id, plate, normalizedPlate: normalizeIranianPlate(plate), effectiveFrom: ordinaryChangeInstant(req.body.effectiveFrom), reason, recordedBy: actor(req) } }); }
    await recordRegistration(tx, vehicle.id, req.body, actor(req));
    await auditHrVehicle(tx, 'EXTERNAL_VEHICLE', vehicle.id, 'EXTERNAL_VEHICLE_CREATED', actor(req), { after: vehicle }); return vehicle;
  }); return res.status(201).json({ success: true, data }); } catch (e) { return fail(res, e, 'Create external vehicle'); }
});
router.put('/external-vehicles/:id', vehicles, async (req: AuthRequest, res) => {
  try { const data = await transaction(async tx => {
    const before = await tx.externalVehicle.findUnique({ where: { id: req.params.id } });
    if (!before) throw new HrVehicleError('خودروی بیرونی پیدا نشد.', 404);
    if (before.status === 'ARCHIVED') throw new HrVehicleError('ابتدا خودرو را به پیش‌نویس بازگردانید.');
    const after = await tx.externalVehicle.update({ where: { id: before.id }, data: vehicleData(req.body) });
    await recordRegistration(tx, after.id, req.body, actor(req));
    await auditHrVehicle(tx, 'EXTERNAL_VEHICLE', after.id, 'EXTERNAL_VEHICLE_UPDATED', actor(req), { before, after }); return after;
  }); return res.json({ success: true, data }); } catch (e) { return fail(res, e, 'Edit external vehicle'); }
});
router.post('/external-vehicles/:id/plates', plates, async (req: AuthRequest, res) => {
  try { const data = await transaction(async tx => {
    const at = ordinaryChangeInstant(req.body.effectiveFrom); const plate = requireCompanyPlate(req.body.plate);
    const vehicle = await tx.externalVehicle.findUnique({ where: { id: req.params.id } });
    if (!vehicle || vehicle.status === 'ARCHIVED') throw new HrVehicleError('خودروی قابل ویرایش پیدا نشد.', 400);
    await assertNoOpenHrOperations(tx, [], [vehicle.id]);
    const current = await tx.externalVehiclePlate.findFirst({ where: { vehicleId: vehicle.id, ...activeAt(at) } });
    if (current?.normalizedPlate === normalizeIranianPlate(plate)) return current;
    const from = afterPeriodStart(at, current ? [current] : []);
    if (current) await tx.externalVehiclePlate.update({ where: { id: current.id }, data: { effectiveTo: from } });
    const after = await tx.externalVehiclePlate.create({ data: { vehicleId: vehicle.id, plate, normalizedPlate: normalizeIranianPlate(plate), effectiveFrom: from, reason, recordedBy: actor(req) } });
    await auditHrVehicle(tx, 'EXTERNAL_VEHICLE', vehicle.id, 'EXTERNAL_VEHICLE_PLATE_CHANGED', actor(req), { before: current, after }); return after;
  }); return res.json({ success: true, data }); } catch (e) { return fail(res, e, 'External plate'); }
});
const transition = (driver: boolean) => async (req: AuthRequest, res: express.Response) => {
  try { const data = await transaction(async tx => {
    const now = ordinaryChangeInstant(req.body.effectiveFrom); const id = req.params.id;
    const current = driver ? await tx.externalDriver.findUnique({ where: { id }, include: externalDriverInclude }) : await tx.externalVehicle.findUnique({ where: { id }, include: externalVehicleInclude });
    if (!current) throw new HrVehicleError('رکورد پیدا نشد.', 404);
    const status = String(req.body.status) as 'DRAFT' | 'ACTIVE' | 'RESTRICTED' | 'ARCHIVED';
    if (status === current.status) return current;
    assertLifecycleTransition(driver ? 'EXTERNAL_DRIVER' : 'EXTERNAL_VEHICLE', current.status, status);
    if (status === 'ACTIVE') {
      const blockers = driver ? externalDriverBlockers({ ...current, status: 'ACTIVE' } as any, now) : externalVehicleBlockers({ ...current, status: 'ACTIVE' } as any, now);
      if (blockers.length) throw new HrVehicleError(`فعال‌سازی ممکن نیست: ${externalBlockerText(blockers)}.`, 400);
    }
    if (status === 'ARCHIVED') {
      if (req.body.confirmed !== true) throw new HrVehicleError('بایگانی و پایان تخصیص را تأیید کنید.');
      await endHrSubjectAssignments(tx, driver ? { driverId: id } : { vehicleId: id }, actor(req), req.body.cancelPlanIds || [], now);
    }
    if (driver) await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `DRIVER_BIOMETRIC:EXTERNAL:${id}`);
    const changes = { status, statusEffectiveFrom: now, statusReason: reason, statusRecordedBy: actor(req) };
    const after = driver ? await tx.externalDriver.update({ where: { id }, data: changes }) : await tx.externalVehicle.update({ where: { id }, data: changes });
    await auditHrVehicle(tx, driver ? 'EXTERNAL_DRIVER' : 'EXTERNAL_VEHICLE', id, 'EXTERNAL_STATUS_CHANGED', actor(req), { before: current, after }); return after;
  }); return res.json({ success: true, data }); } catch (e) { return fail(res, e, 'External status'); }
};
// Activation/suspension uses the same eligibility authority as internal drivers.
router.post('/external-drivers/:id/status', eligibility, (req: AuthRequest, res, next) => ['ARCHIVED', 'DRAFT'].includes(req.body.status) ? profiles(req, res, next) : next(), (req: AuthRequest, res, next) => req.body.status === 'ARCHIVED' ? assignments(req, res, next) : next(), transition(true));
router.post('/external-vehicles/:id/status', vehicles, (req: AuthRequest, res, next) => req.body.status === 'ARCHIVED' ? assignments(req, res, next) : next(), transition(false));
for (const driver of [true, false]) router.delete(driver ? '/external-drivers/:id' : '/external-vehicles/:id', driver ? profiles : vehicles, async (req: AuthRequest, res) => {
  try { await transaction(async tx => {
    const id = req.params.id;
    const current = driver ? await tx.externalDriver.findUnique({ where: { id }, include: { _count: { select: { assignments: true, assignmentPlans: true, guardQueueTurns: true, biometricEnrollments: true, documents: true, externalLinks: true } } } }) :
      await tx.externalVehicle.findUnique({ where: { id }, include: { _count: { select: { assignments: true, assignmentPlans: true, guardQueueTurns: true, documents: true } } } });
    if (!current || current.status !== 'DRAFT' || Object.values(current._count).some(n => n > 0)) throw new HrVehicleError('فقط پیش‌نویس بدون سابقه وابسته قابل حذف است؛ برای این رکورد از بایگانی استفاده کنید.', 400);
    await auditHrVehicle(tx, driver ? 'EXTERNAL_DRIVER' : 'EXTERNAL_VEHICLE', id, 'EXTERNAL_DRAFT_DELETED', actor(req), { before: current });
    if (driver) await tx.externalDriver.delete({ where: { id } }); else { await tx.externalVehiclePlate.deleteMany({ where: { vehicleId: id } }); await tx.externalVehicle.delete({ where: { id } }); }
  }); return res.json({ success: true }); } catch (e) { return fail(res, e, 'Delete external draft'); }
});
for (const driver of [true, false]) router.post(driver ? '/external-drivers/:id/documents' : '/external-vehicles/:id/documents', driver ? profiles : vehicles, async (req: AuthRequest, res) => {
  try { const data = await transaction(async tx => {
    const reference = requiredText(req.body.reference, 'reference'); const expiresAt = optionalDate(req.body.expiresAt, 'expiresAt');
    const record = driver ? await tx.externalDriverDocument.create({ data: { driverId: req.params.id, documentType: 'DRIVING_LICENCE', reference, expiresAt, recordedBy: actor(req) } }) :
      await tx.externalVehicleDocument.create({ data: { vehicleId: req.params.id, documentType: 'VEHICLE_REGISTRATION', reference, expiresAt, recordedBy: actor(req) } });
    await auditHrVehicle(tx, driver ? 'EXTERNAL_DRIVER' : 'EXTERNAL_VEHICLE', req.params.id, 'EXTERNAL_DOCUMENT_RECORDED', actor(req), { documentId: record.id }); return record;
  }); return res.status(201).json({ success: true, data }); } catch (e) { return fail(res, e, 'External document'); }
});
router.post('/external-drivers/:id/personnel-continuity', profiles, async (req: AuthRequest, res) => {
  try { const data = await transaction(async tx => {
    const link = await tx.externalDriverPersonnelContinuityLink.create({ data: { externalDriverId: req.params.id, personnelId: requiredText(req.body.personnelId, 'personnelId'), reason, recordedBy: actor(req) } });
    await auditHrVehicle(tx, 'EXTERNAL_DRIVER', req.params.id, 'PERSONNEL_CONTINUITY_LINKED', actor(req), { after: link }); return link;
  }); return res.status(201).json({ success: true, data }); } catch (e) { return fail(res, e, 'External continuity'); }
});
router.use(createVehicleAssignmentRoutes(true));
export default router;
