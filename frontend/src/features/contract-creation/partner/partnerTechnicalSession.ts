import {
  PartnerTechnicalDraftSchema, PartnerTechnicalRecoveryAccessSchema,
  PartnerTechnicalRecoveryViewSchema, PartnerTechnicalCheckpointReceiptSchema,
  PartnerTechnicalSaveReceiptSchema,
  PartnerTechnicalSavedViewSchema,
  PartnerErrorSchema, type PartnerError,
  type PartnerTechnicalDraft, type PartnerTechnicalRecoveryAccess,
  type PartnerTechnicalRecoveryView, type PartnerTechnicalRecoveryPort,
  type PartnerTechnicalCheckpoint,
  type PartnerTechnicalSave, type PartnerTechnicalSavePort, type PartnerTechnicalSavedView,
} from '@sabalanerp/partner-sales-contracts';

interface TechnicalSessionState {
  readonly phase: 'editing' | 'saving' | 'uncertain' | 'blocked' | 'closed';
  readonly error?: PartnerError;
  readonly draft: PartnerTechnicalDraft;
  readonly recoveryRevision: number;
  readonly checkpointedInputRevision: number | null;
  readonly validated?: PartnerTechnicalSavedView;
  readonly isCurrentValidated: boolean;
}

/** In-memory editing/acknowledgement coordinator over the existing leased
 * recovery port. It owns no journal, lease acquisition or authorization. */
export function createPartnerTechnicalSession(input: {
  access: PartnerTechnicalRecoveryAccess;
  recovered: PartnerTechnicalRecoveryView;
  recovery: PartnerTechnicalRecoveryPort;
  saved?: PartnerTechnicalSavePort;
  validated?: PartnerTechnicalSavedView;
}) {
  const access = PartnerTechnicalRecoveryAccessSchema.parse(input.access);
  const recovered = PartnerTechnicalRecoveryViewSchema.parse(input.recovered);
  if (recovered.recoveryId !== access.recoveryId) throw new Error('Recovery scope mismatch');
  const validated = input.validated && PartnerTechnicalSavedViewSchema.parse(input.validated);
  if (validated && (validated.recoveryId !== recovered.recoveryId ||
    validated.recoveryRevision !== recovered.recoveryRevision ||
    validated.inputRevision !== recovered.draft?.inputRevision)) throw new Error('Validated recovery mismatch');
  let state: TechnicalSessionState = {
    phase: 'editing', recoveryRevision: recovered.recoveryRevision,
    draft: recovered.draft ?? { schemaVersion: 1, inputRevision: 0, rows: [] },
    checkpointedInputRevision: recovered.draft?.inputRevision ?? null,
    ...(validated ? { validated } : {}),
    isCurrentValidated: validated !== undefined,
  };
  let flight: Promise<void> | null = null;
  let pending: PartnerTechnicalCheckpoint | null = null;
  let pendingSave: PartnerTechnicalSave | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();
  const publish = (next: TechnicalSessionState) => {
    state = next;
    listeners.forEach(listener => listener());
  };
  const execute = async (command: PartnerTechnicalCheckpoint) => {
    if (disposed) return;
    publish({ ...state, phase: 'saving', error: undefined });
    try {
      const result = await input.recovery.checkpoint(command);
      if (disposed) return;
      if (!result.ok) {
        const error = PartnerErrorSchema.parse(result.error);
        pending = null;
        // Only a validation rejection is locally repairable. Ownership, stale
        // revision and operational gates require an explicit host refresh.
        publish({ ...state, error, phase: error.code === 'INVALID_PAYLOAD' ? 'editing' : 'blocked' });
        return;
      }
      const receipt = PartnerTechnicalCheckpointReceiptSchema.parse(result.value);
      if (receipt.recoveryId !== access.recoveryId || receipt.inputRevision !== command.draft.inputRevision ||
        receipt.recoveryRevision !== command.expectedRecoveryRevision + 1) throw new Error('Checkpoint response mismatch');
      pending = null;
      publish({ ...state, phase: 'editing', recoveryRevision: receipt.recoveryRevision,
        checkpointedInputRevision: receipt.inputRevision });
    } catch {
      if (disposed) return;
      // Retain the exact request until its committed outcome can be discovered.
      publish({ ...state, phase: 'uncertain' });
    }
  };
  const executeSave = async (command: PartnerTechnicalSave) => {
    if (disposed || !input.saved) return;
    publish({ ...state, phase: 'saving', error: undefined });
    try {
      const result = await input.saved.save(command);
      if (disposed) return;
      if (!result.ok) {
        const error = PartnerErrorSchema.parse(result.error);
        pendingSave = null;
        publish({ ...state, error, phase: error.code === 'INVALID_PAYLOAD' ? 'editing' : 'blocked' });
        return;
      }
      const receipt = PartnerTechnicalSaveReceiptSchema.parse(result.value);
      if (receipt.recoveryId !== access.recoveryId || receipt.inputRevision !== command.draft.inputRevision ||
        receipt.recoveryRevision !== command.expectedRecoveryRevision + 1) throw new Error('Save response mismatch');
      pendingSave = null;
      publish({ ...state, phase: 'editing', recoveryRevision: receipt.recoveryRevision,
        checkpointedInputRevision: receipt.inputRevision, validated: receipt,
        isCurrentValidated: state.draft.inputRevision === receipt.inputRevision });
    } catch {
      if (!disposed) publish({ ...state, phase: 'uncertain' });
    }
  };
  const run = (operation: () => Promise<void>) => {
    if (flight) return flight;
    flight = Promise.resolve().then(operation).finally(() => { flight = null; });
    return flight;
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    edit(value: PartnerTechnicalDraft) {
      if (disposed) throw new Error('Editing session is closed');
      const draft = PartnerTechnicalDraftSchema.parse(value);
      if (draft.inputRevision <= state.draft.inputRevision) throw new Error('Editing revision must advance');
      publish({ ...state, draft,
        isCurrentValidated: state.validated?.inputRevision === draft.inputRevision });
    },
    checkpoint(): Promise<void> {
      if (flight) return flight;
      if (disposed || pending || pendingSave || state.phase === 'blocked') return Promise.resolve();
      const command = { ...access, expectedRecoveryRevision: state.recoveryRevision,
        idempotencyKey: crypto.randomUUID(), draft: PartnerTechnicalDraftSchema.parse(state.draft) };
      pending = command;
      return run(() => execute(command));
    },
    retry(): Promise<void> {
      if (pendingSave) return run(() => executeSave(pendingSave!));
      const command = pending;
      return command ? run(() => execute(command)) : Promise.resolve();
    },
    save(): Promise<void> {
      if (flight) return flight;
      if (disposed || pending || pendingSave || state.phase === 'blocked' || !input.saved) return Promise.resolve();
      const command = { ...access, expectedRecoveryRevision: state.recoveryRevision,
        idempotencyKey: crypto.randomUUID(), draft: PartnerTechnicalDraftSchema.parse(state.draft) };
      pendingSave = command;
      return run(() => executeSave(command));
    },
    dispose() {
      disposed = true;
      pending = null;
      pendingSave = null;
      publish({ ...state, phase: 'closed' });
      listeners.clear();
    },
  };
}
