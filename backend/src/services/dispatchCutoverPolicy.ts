export type LegacyDispositionInput = {
  disposition: 'LINKED' | 'HISTORICAL_ONLY' | 'DUPLICATE' | 'INVALID';
  driverSource: 'INTERNAL' | 'EXTERNAL' | null;
  driverId: string | null;
  vehicleSource: 'COMPANY' | 'EXTERNAL' | null;
  vehicleId: string | null;
};

export const validateLegacyDisposition = (input: LegacyDispositionInput): LegacyDispositionInput => {
  if (input.disposition === 'LINKED' && (!input.driverSource || !input.driverId || !input.vehicleSource || !input.vehicleId)) {
    throw new Error('LINKED disposition requires an explicit canonical driver and vehicle; automatic identity guesses are forbidden.');
  }
  if (input.disposition !== 'LINKED' && (input.driverSource || input.driverId || input.vehicleSource || input.vehicleId)) {
    throw new Error('Only LINKED disposition may carry canonical identity targets.');
  }
  return input;
};

export const validateRehearsalGate = (rehearsals: Array<{ status: string; sourceHash: string; targetHash: string }>) => {
  const latest = rehearsals.slice(-2);
  if (latest.length !== 2 || latest.some((item) => item.status !== 'PASSED')) {
    throw new Error('Cutover requires two successful consecutive rehearsals.');
  }
  if (latest.some((item) => item.sourceHash !== item.targetHash)) {
    throw new Error('Every rehearsal requires matching source and target hashes.');
  }
};

export const criticalFailureDisposition = (state: { phase: string; firstCanonicalAdmissionAt: Date | null }) =>
  state.phase === 'CANONICAL_LIVE' && !state.firstCanonicalAdmissionAt
    ? 'RESTORE_LEGACY_WRITES' as const
    : 'PILOT_SAFETY_PAUSE' as const;
