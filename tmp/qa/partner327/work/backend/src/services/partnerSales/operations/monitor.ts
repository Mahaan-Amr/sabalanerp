import { ContractRuntime, OperationsError, Result } from './contracts';
import { OperationsStore } from './service';
import { Observation, PartnerTelemetry } from './telemetry';

/** Trusted detector/job consumer only. Never expose as an HTTP ingestion endpoint.
 * Detectors own exact reconciliation and evidence provenance; a handled conflict
 * or duplicate event delivery is not a confirmed integrity violation. */
export function createOperationsMonitor(contract: ContractRuntime, store: OperationsStore, telemetry: PartnerTelemetry) {
  async function record(input: Observation | { event: unknown }): Promise<Result<void>> {
    try {
      const event = 'event' in input;
      const projected = event ? telemetry.event(input.event) : telemetry.project(input);
      await store.transaction(async tx => {
        if (!event && input.outcome === 'CONFIRMED_VIOLATION') {
          const key = telemetry.incidentKey(input);
          const previous = await tx.findIncident(key);
          const now = contract.InstantSchema.parse(tx.now());
          const incident = { key, category: input.category!, evidenceReference: String(projected.evidenceReference),
            firstSeenAt: previous?.firstSeenAt ?? now, lastSeenAt: now, occurrences: (previous?.occurrences ?? 0) + 1 };
          await tx.saveIncident(incident);
          if (!previous || previous.resolution) {
            const state = await tx.readState();
            await tx.writeState({ ...state, revision: state.revision + 1, operationalPaused: true, lastOperationalPauseAt: now });
          }
          // Deduplicate the critical incident notification in the same transaction.
          if (!previous || previous.resolution) await tx.enqueueTelemetry({ ...projected, incidentReference: key, recordedAt: now });
        } else {
          await tx.enqueueTelemetry({ ...projected, recordedAt: contract.InstantSchema.parse(tx.now()) });
        }
      });
      return { ok: true, value: undefined };
    } catch (error) {
      return { ok: false, error: contract.partnerError(error instanceof OperationsError ? error.code : 'INTEGRITY_CONFLICT') };
    }
  }
  return { observe: (input: Observation) => record(input), event: (event: unknown) => record({ event }) };
}
