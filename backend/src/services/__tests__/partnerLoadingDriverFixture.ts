import type { PrismaClient } from '@prisma/client';
import { assignHrVehicle, externalAssignmentScope, lockHrVehicleOperations } from '../hrVehicleOperations';

export async function createReadyPartnerLoadingDriver(database: PrismaClient, actorId: string, input: {
  firstName: string; lastName: string; nationalCode: string; phone: string;
  plate: string; normalizedPlate: string; vehicleType: string;
}) {
  const { plate, normalizedPlate, vehicleType, ...identity } = input;
  const assignmentAt = new Date();
  const licenceExpiresAt = new Date(assignmentAt.getTime() + 365 * 86_400_000);
  const reference = `isolated-${plate}`;
  return database.$transaction(async raw => {
    const tx = externalAssignmentScope(raw);
    await lockHrVehicleOperations(tx);
    const driver = await tx.externalDriver.create({ data: { ...identity, status: 'ACTIVE', statusRecordedBy: actorId, createdBy: actorId,
      licenceNumber: reference, licenceClass: 'B', licenceExpiresAt,
      documents: { create: { documentType: 'DRIVING_LICENCE', reference, expiresAt: licenceExpiresAt, recordedBy: actorId } } } });
    const vehicle = await tx.externalVehicle.create({ data: { vehicleType, status: 'ACTIVE', statusRecordedBy: actorId, createdBy: actorId,
      plates: { create: { plate, normalizedPlate, effectiveFrom: assignmentAt, reason: 'isolated fixture', recordedBy: actorId } },
      documents: { create: { documentType: 'VEHICLE_REGISTRATION', reference, recordedBy: actorId } } } });
    await assignHrVehicle(tx, { driverId: driver.id, vehicleId: vehicle.id, confirmed: true, expectedAssignmentIds: [] }, actorId, assignmentAt);
    await tx.driverBiometricEnrollment.create({ data: { externalDriverId: driver.id, status: 'ACTIVE',
      confirmationPhone: driver.phone, enrolledBy: actorId } });
    return { driver, vehicle };
  }, { isolationLevel: 'Serializable' });
}
