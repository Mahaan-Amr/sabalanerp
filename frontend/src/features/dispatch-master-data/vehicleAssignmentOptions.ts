export interface AssignmentPlate {
  plate: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export interface AssignmentVehicle {
  id: string;
  status: string;
  plates: AssignmentPlate[];
}

export const currentEffectivePlate = (vehicle: AssignmentVehicle, effectiveAt: string) => {
  const at = new Date(effectiveAt);
  if (Number.isNaN(at.getTime())) return null;
  return vehicle.plates.find((plate) => {
    const startsAt = new Date(plate.effectiveFrom);
    const endsAt = plate.effectiveTo ? new Date(plate.effectiveTo) : null;
    return startsAt <= at && (!endsAt || endsAt > at);
  }) || null;
};

export const assignableVehiclesAt = <T extends AssignmentVehicle>(vehicles: T[], effectiveAt: string) => (
  vehicles.filter((vehicle) => vehicle.status === 'ACTIVE' && currentEffectivePlate(vehicle, effectiveAt))
);
