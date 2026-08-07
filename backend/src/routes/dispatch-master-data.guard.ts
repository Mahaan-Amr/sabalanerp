import express from 'express';
import { Prisma } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { FEATURE_PERMISSIONS, FEATURES, requireFeatureAccess } from '../middleware/feature';
import { appendDispatchMasterDataAudit } from '../services/dispatchMasterDataAudit';
import { assertLifecycleTransition, canPermanentlyDeleteDraft, normalizeIranianPlate } from '../services/dispatchMasterDataPolicy';
import { activeAt, actor, fail, optionalText, parsedDate, prisma, requiredText } from './dispatch-master-data.shared';

const router = express.Router();
const view = requireFeatureAccess(FEATURES.SECURITY_EXTERNAL_DRIVERS_VIEW, FEATURE_PERMISSIONS.VIEW);
const manage = requireFeatureAccess(FEATURES.SECURITY_EXTERNAL_DRIVERS_MANAGE, FEATURE_PERMISSIONS.EDIT);

router.get('/external-registry', view, async (_req, res) => {
  try {
    const [drivers, vehicles, legacyPairs] = await Promise.all([
      prisma.externalDriver.findMany({ include: { externalLinks: true }, orderBy: { createdAt: 'desc' } }),
      prisma.externalVehicle.findMany({ include: { plates: { orderBy: { effectiveFrom: 'desc' } } }, orderBy: { createdAt: 'desc' } }),
      prisma.securityVehiclePair.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, firstName: true, lastName: true, nationalCode: true, phone: true, vehiclePlate: true, vehicleType: true, isActive: true, createdAt: true } }),
    ]);
    return res.json({ success: true, data: {
      drivers: drivers.map((item) => ({ ...item, source: 'GUARD_EXTERNAL' })), vehicles: vehicles.map((item) => ({ ...item, source: 'GUARD_EXTERNAL' })),
      legacyPairs: legacyPairs.map((item) => ({ ...item, source: 'LEGACY_COMBINED', historicalOnly: true, operationalUseAllowed: false, readiness: { status: 'NOT_READY', blockers: ['LEGACY_SOURCE_ONLY'] } })),
    } });
  } catch (error) { return fail(res, error, 'List Guard external registry'); }
});

router.post('/external-drivers', manage, async (req: AuthRequest, res) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const created = await tx.externalDriver.create({ data: { firstName: requiredText(req.body.firstName, 'firstName'), lastName: requiredText(req.body.lastName, 'lastName'), nationalCode: requiredText(req.body.nationalCode, 'nationalCode'), phone: requiredText(req.body.phone, 'phone'), notes: optionalText(req.body.notes), statusReason: requiredText(req.body.reason, 'reason'), statusRecordedBy: actor(req), createdBy: actor(req) } });
      await appendDispatchMasterDataAudit(tx, { ownerScope: 'GUARD', subjectType: 'EXTERNAL_DRIVER', subjectId: created.id, eventType: 'EXTERNAL_DRIVER_DRAFT_CREATED', payload: { nationalCode: created.nationalCode, reason: req.body.reason }, actorId: actor(req) });
      return created;
    });
    return res.status(201).json({ success: true, data: { ...result, source: 'GUARD_EXTERNAL' } });
  } catch (error) { return fail(res, error, 'Create external-driver draft'); }
});

router.post('/external-vehicles', manage, async (req: AuthRequest, res) => {
  try {
    const reason = requiredText(req.body.reason, 'reason');
    const result = await prisma.$transaction(async (tx) => {
      const vehicle = await tx.externalVehicle.create({ data: { vehicleType: requiredText(req.body.vehicleType, 'vehicleType'), notes: optionalText(req.body.notes), statusReason: reason, statusRecordedBy: actor(req), createdBy: actor(req) } });
      if (req.body.plate) {
        const effectiveFrom = parsedDate(req.body.effectiveFrom, 'effectiveFrom'); const plate = requiredText(req.body.plate, 'plate');
        await tx.externalVehiclePlate.create({ data: { vehicleId: vehicle.id, plate, normalizedPlate: normalizeIranianPlate(plate), effectiveFrom, reason, recordedBy: actor(req) } });
      }
      await appendDispatchMasterDataAudit(tx, { ownerScope: 'GUARD', subjectType: 'EXTERNAL_VEHICLE', subjectId: vehicle.id, eventType: 'EXTERNAL_VEHICLE_DRAFT_CREATED', payload: { reason }, actorId: actor(req) });
      return tx.externalVehicle.findUniqueOrThrow({ where: { id: vehicle.id }, include: { plates: true } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return res.status(201).json({ success: true, data: { ...result, source: 'GUARD_EXTERNAL' } });
  } catch (error) { return fail(res, error, 'Create external-vehicle draft'); }
});

router.post('/external-vehicles/:id/plates', manage, async (req: AuthRequest, res) => {
  try {
    const effectiveFrom = parsedDate(req.body.effectiveFrom, 'effectiveFrom'); const plate = requiredText(req.body.plate, 'plate'); const reason = requiredText(req.body.reason, 'reason');
    const result = await prisma.$transaction(async (tx) => {
      const vehicle = await tx.externalVehicle.findUnique({ where: { id: req.params.id } });
      if (!vehicle || vehicle.status === 'ARCHIVED') throw new Error('An unarchived external vehicle is required.');
      const current = await tx.externalVehiclePlate.findFirst({ where: { vehicleId: vehicle.id, ...activeAt(effectiveFrom) }, orderBy: { effectiveFrom: 'desc' } });
      if (current) await tx.externalVehiclePlate.update({ where: { id: current.id }, data: { effectiveTo: effectiveFrom } });
      const created = await tx.externalVehiclePlate.create({ data: { vehicleId: vehicle.id, plate, normalizedPlate: normalizeIranianPlate(plate), effectiveFrom, reason, recordedBy: actor(req) } });
      await appendDispatchMasterDataAudit(tx, { ownerScope: 'GUARD', subjectType: 'EXTERNAL_VEHICLE', subjectId: vehicle.id, eventType: 'EXTERNAL_VEHICLE_PLATE_CHANGED', payload: { plateId: created.id, plate, effectiveFrom, reason }, actorId: actor(req) });
      return created;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return res.status(201).json({ success: true, data: result });
  } catch (error) { return fail(res, error, 'Change external vehicle plate'); }
});

const transition = (subject: 'EXTERNAL_DRIVER' | 'EXTERNAL_VEHICLE') => async (req: AuthRequest, res: any) => {
  try {
    const next = requiredText(req.body.status, 'status') as 'DRAFT' | 'ACTIVE' | 'RESTRICTED' | 'ARCHIVED';
    const reason = requiredText(req.body.reason, 'reason'); const effectiveFrom = parsedDate(req.body.effectiveFrom, 'effectiveFrom');
    if (effectiveFrom > new Date()) throw new Error('Lifecycle changes cannot take effect in the future.');
    const updated = await prisma.$transaction(async (tx) => {
      const delegate = subject === 'EXTERNAL_DRIVER' ? tx.externalDriver : tx.externalVehicle;
      const current: any = await (delegate as any).findUnique({ where: { id: req.params.id }, ...(subject === 'EXTERNAL_VEHICLE' ? { include: { plates: true } } : {}) });
      if (!current) throw new Error(`${subject} was not found.`);
      assertLifecycleTransition(subject, current.status, next);
      if (next === 'ACTIVE' && subject === 'EXTERNAL_VEHICLE' && !current.plates.some((plate: any) => plate.effectiveFrom <= effectiveFrom && (!plate.effectiveTo || plate.effectiveTo > effectiveFrom))) throw new Error('A current effective plate is required for activation.');
      const record = await (delegate as any).update({ where: { id: current.id }, data: { status: next, statusEffectiveFrom: effectiveFrom, statusReason: reason, statusRecordedBy: actor(req) } });
      await appendDispatchMasterDataAudit(tx, { ownerScope: 'GUARD', subjectType: subject, subjectId: record.id, eventType: `${subject}_${next}`, payload: { effectiveFrom, reason }, actorId: actor(req) });
      return record;
    });
    return res.json({ success: true, data: updated });
  } catch (error) { return fail(res, error, `Transition ${subject}`); }
};
router.post('/external-drivers/:id/status', manage, transition('EXTERNAL_DRIVER'));
router.post('/external-vehicles/:id/status', manage, transition('EXTERNAL_VEHICLE'));

router.delete('/external-drivers/:id', manage, async (req: AuthRequest, res) => {
  try {
    const id = await prisma.$transaction(async (tx) => {
      const current = await tx.externalDriver.findUnique({ where: { id: req.params.id }, include: { _count: { select: { externalLinks: true } } } });
      if (!current || !canPermanentlyDeleteDraft({ status: current.status, dependencyCount: current._count.externalLinks })) throw new Error('Only an unused external-driver draft may be permanently deleted.');
      await appendDispatchMasterDataAudit(tx, { ownerScope: 'GUARD', subjectType: 'EXTERNAL_DRIVER', subjectId: current.id, eventType: 'EXTERNAL_DRIVER_DRAFT_DELETED', payload: { reason: requiredText(req.body.reason, 'reason') }, actorId: actor(req) });
      await tx.externalDriver.delete({ where: { id: current.id } }); return current.id;
    });
    return res.json({ success: true, data: { id } });
  } catch (error) { return fail(res, error, 'Delete external-driver draft'); }
});

router.delete('/external-vehicles/:id', manage, async (req: AuthRequest, res) => {
  try {
    const id = await prisma.$transaction(async (tx) => {
      const current = await tx.externalVehicle.findUnique({ where: { id: req.params.id } });
      if (!current || !canPermanentlyDeleteDraft({ status: current.status, dependencyCount: 0 })) throw new Error('Only an unused external-vehicle draft may be permanently deleted.');
      await appendDispatchMasterDataAudit(tx, { ownerScope: 'GUARD', subjectType: 'EXTERNAL_VEHICLE', subjectId: current.id, eventType: 'EXTERNAL_VEHICLE_DRAFT_DELETED', payload: { reason: requiredText(req.body.reason, 'reason') }, actorId: actor(req) });
      await tx.externalVehiclePlate.deleteMany({ where: { vehicleId: current.id } }); await tx.externalVehicle.delete({ where: { id: current.id } }); return current.id;
    });
    return res.json({ success: true, data: { id } });
  } catch (error) { return fail(res, error, 'Delete external-vehicle draft'); }
});

router.post('/external-drivers/:id/personnel-continuity', manage, async (req: AuthRequest, res) => {
  try {
    const reason = requiredText(req.body.reason, 'reason'); const personnelId = requiredText(req.body.personnelId, 'personnelId');
    const link = await prisma.$transaction(async (tx) => {
      if (!await tx.personnel.findUnique({ where: { id: personnelId } })) throw new Error('Personnel was not found.');
      const created = await tx.externalDriverPersonnelContinuityLink.create({ data: { externalDriverId: req.params.id, personnelId, reason, recordedBy: actor(req) } });
      await appendDispatchMasterDataAudit(tx, { ownerScope: 'GUARD', subjectType: 'EXTERNAL_DRIVER', subjectId: req.params.id, eventType: 'PERSONNEL_CONTINUITY_LINKED', payload: { personnelId, reason }, actorId: actor(req) });
      return created;
    });
    return res.status(201).json({ success: true, data: link });
  } catch (error) { return fail(res, error, 'Link external driver continuity'); }
});

export default router;
