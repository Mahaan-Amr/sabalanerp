import { ContractRuntime, OperationsError, Result } from './contracts';
import { checkOperationsGate, GateInput, requiresReadiness } from './policy';
import { OperationsStore, OperationsTransaction } from './service';

/** Consumer composition seam for #334. resolve must call CENTRAL authorization
 * for the actual operation and load current resource lifecycle/integrity, never
 * copy HTTP permission/cohort/readiness claims. write must use this same DB
 * transaction (including Case/pair/evidence/audit); it must not send external IO.
 * The control lock is held through commit, so pause and write have one winner. */
export async function runGuardedOperation<T>(contract: ContractRuntime, store: OperationsStore,
  resolve: (tx: OperationsTransaction) => Promise<GateInput>, write: (tx: OperationsTransaction) => Promise<T>): Promise<Result<T>> {
  try {
    const value = await store.transaction(async tx => {
      const input = await resolve(tx);
      input.permission = { ...input.permission, evaluatedAt: contract.InstantSchema.parse(tx.now()) };
      if (requiresReadiness(input.operation)) {
        input.readiness = await tx.readiness();
        input.readiness.current.now = tx.now();
      } else input.readiness = undefined;
      const denial = checkOperationsGate(contract, await tx.readState(), input);
      if (denial) throw new OperationsError(denial.code);
      return write(tx);
    });
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: contract.partnerError(error instanceof OperationsError ? error.code : 'INTEGRITY_CONFLICT') };
  }
}
