import { randomUUID } from 'node:crypto';

/** Test-only lifecycle. Runner must prove the local target and bind the exact
 * cluster and database OID. This module does not connect to PostgreSQL.
 * A coordinated window excludes other actors creating/dropping this name. */
export type Result<T> = { state: 'SUCCESS'; value: T } | { state: 'FAILURE' } | { state: 'UNKNOWN' };
export type ChildRunner = {
  create(name: string): Promise<Result<void>>;
  identity(name: string): Promise<Result<string>>;
  setup(name: string): Promise<Result<'SUCCESS' | 'FAILURE'>>;
  census(name: string): Promise<Result<{ sessions: number; prepared: number }>>;
  drop(name: string): Promise<Result<void>>;
};
export type Outcome = { name: string; state: 'CLEANED' | 'UNKNOWN'; setup?: 'SUCCESS' | 'FAILURE' };

export async function runProtectedTemporaryDatabase(
  runner: ChildRunner,
  exercise?: (name: string, identity: string) => Promise<Result<void>>,
  requestedName?: string,
): Promise<Outcome> {
  const name = requestedName ?? `sabalanerp_protected_${randomUUID().replace(/-/g, '')}`;
  const unknown = (setup?: 'SUCCESS' | 'FAILURE'): Outcome => ({ name, state: 'UNKNOWN', setup });
  if(!/^sabalanerp_protected_[a-f0-9]{32}$/.test(name))return unknown();
  let setupOutcome: 'SUCCESS' | 'FAILURE' | undefined;
  try {
    const created = await runner.create(name);
    if (created.state !== 'SUCCESS') return unknown();
    const initial = await runner.identity(name);
    if (initial.state !== 'SUCCESS' || !/^\d+:\d+$/.test(initial.value)) return unknown();
    const setup = await runner.setup(name);
    if (setup.state === 'UNKNOWN') return unknown();
    setupOutcome = setup.state === 'FAILURE' ? 'FAILURE' : setup.value;
    // Exercise runs within the same lifecycle, before the final identity and
    // session checks. An uncertain or failed exercise retains the database.
    if (exercise && setupOutcome === 'SUCCESS') {
      const exercised = await exercise(name, initial.value);
      if (exercised.state !== 'SUCCESS') return unknown(setupOutcome);
    }
    const current = await runner.identity(name);
    if (current.state !== 'SUCCESS' || current.value !== initial.value) return unknown(setupOutcome);
    const census = await runner.census(name);
    if (census.state !== 'SUCCESS' || census.value.sessions !== 0 || census.value.prepared !== 0) return unknown(setupOutcome);
    const beforeDrop = await runner.identity(name);
    if (beforeDrop.state !== 'SUCCESS' || beforeDrop.value !== initial.value) return unknown(setupOutcome);
    // Exactly one DROP; an uncertain response must never be retried.
    const dropped = await runner.drop(name);
    return dropped.state === 'SUCCESS' ? { name, state: 'CLEANED', setup: setupOutcome } : unknown(setupOutcome);
  } catch { return unknown(setupOutcome); }
}
