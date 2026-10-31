/** Display frozen admission identities from the latest revision for each physical queue turn. */
export function loadingDriverSnapshots(loading: any): any[] {
  const turns = new Map<string, any>();
  for (const revision of loading?.canonicalAllocationRevisions || []) {
    const previous = turns.get(revision.queueTurnId);
    if (!previous || revision.revisionNumber > previous.revisionNumber) turns.set(revision.queueTurnId, revision);
  }
  const queueTurns = turns.size
    ? Array.from(turns.values()).map(revision => revision.queueTurn)
    : loading?.guardQueueTurns || [];
  if (queueTurns.length) return queueTurns.map((turn: any) => {
    const frozen = turn?.admissionSnapshot || {};
    return { ...frozen.driver, vehiclePlate: frozen.plate?.plate, vehicleType: frozen.vehicle?.vehicleType };
  });
  const legacy = loading?.drivers || loading?.driverAssignments || [];
  return legacy.length ? legacy.map((driver: any) => driver.snapshot || driver.driverSnapshot || driver.vehiclePair || driver)
    : loading?.driverSnapshot ? [loading.driverSnapshot] : [];
}
