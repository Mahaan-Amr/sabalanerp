import { Prisma, type PrismaClient } from '@prisma/client';
import { runtimeBoundaryProvisionBytes, type RuntimeBoundaryScope } from './runtimeBoundaryJournal';

const failure = (code: string) => Object.assign(new Error(code), { code });
export type RuntimeDatabaseIdentity = { databaseName: string; databaseOid: string; systemIdentifier: string };

/** Bind every pooled connection before construction. A per-query SET cannot
 * identify another connection in the same pool. This helper creates no client
 * and grants no serving/control authority. Never log the returned URL. */
export function runtimeDatabaseUrl(source: string, scope: RuntimeBoundaryScope): string {
  runtimeBoundaryProvisionBytes(scope);
  let url: URL;
  try { url = new URL(source); } catch { throw failure('RUNTIME_DATABASE_URL_INVALID'); }
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2
    || url.hash || url.searchParams.has('options')) throw failure('RUNTIME_DATABASE_URL_INVALID');
  for (const [key, maximum] of [['connection_limit', 128], ['pool_timeout', 120]] as const) {
    const values = url.searchParams.getAll(key);
    if (values.length !== 1 || !/^[1-9][0-9]*$/.test(values[0]) || Number(values[0]) > maximum) {
      throw failure('RUNTIME_DATABASE_POOL_BOUNDS_REQUIRED');
    }
  }
  const names = url.searchParams.getAll('application_name');
  if (names.length > 1 || names.some(name => name !== scope.postgresApplicationName)) {
    throw failure('RUNTIME_DATABASE_NAMESPACE_CONFLICT');
  }
  url.searchParams.set('application_name', scope.postgresApplicationName);
  return url.toString();
}

/** A bounded read-only observation, NEVER a retirement/promotion certificate.
 * Even zero sessions is only useful while the owned controller continuously
 * excludes new admissions and has proven native incarnation/descendant death.
 * No PID is terminated, no prepared transaction resolved, no namespace reset.
 * The observer needs full statistics visibility and pg_control_system access;
 * denied or unavailable evidence rejects rather than inferring absence. */
export async function observeRuntimeDatabaseWork(input: {
  database: Pick<PrismaClient, '$transaction'>;
  identity: RuntimeDatabaseIdentity;
  scopes: RuntimeBoundaryScope[];
  assertBoundaryOwned(): void;
}) {
  const { database, scopes, assertBoundaryOwned } = input;
  const identity = { ...input.identity };
  if (!identity.databaseName || !/^[1-9][0-9]*$/.test(identity.databaseOid)
    || !/^[1-9][0-9]*$/.test(identity.systemIdentifier) || scopes.length < 1 || scopes.length > 128) {
    throw failure('RUNTIME_DATABASE_OBSERVATION_SCOPE_INVALID');
  }
  scopes.forEach(runtimeBoundaryProvisionBytes);
  const names = scopes.map(scope => scope.postgresApplicationName);
  if (new Set(names).size !== names.length) throw failure('RUNTIME_DATABASE_NAMESPACE_COLLISION');
  assertBoundaryOwned();
  const result = await database.$transaction(async transaction => {
    await transaction.$executeRaw`SET TRANSACTION READ ONLY`;
    await transaction.$queryRaw`SELECT set_config('statement_timeout', '5000', true)`;
    const [actual] = await transaction.$queryRaw<Array<RuntimeDatabaseIdentity & { visible: boolean; applicationName: string }>>`
      SELECT current_database() AS "databaseName", d.oid::text AS "databaseOid",
        c.system_identifier::text AS "systemIdentifier", current_setting('application_name') AS "applicationName",
        (r.rolsuper OR pg_has_role(current_user, 'pg_read_all_stats', 'MEMBER')) AS visible
      FROM pg_database d CROSS JOIN pg_control_system() c CROSS JOIN pg_roles r
      WHERE d.datname = current_database() AND r.rolname = current_user`;
    if (!actual || !actual.visible || actual.databaseName !== identity.databaseName
      || actual.databaseOid !== identity.databaseOid || actual.systemIdentifier !== identity.systemIdentifier
      || names.includes(actual.applicationName)) throw failure('RUNTIME_DATABASE_OBSERVER_IDENTITY_UNPROVEN');
    // Do not reuse a prior statistics snapshot from this transaction.
    await transaction.$queryRaw`SELECT pg_stat_clear_snapshot()::text AS cleared`;
    const sessions = await transaction.$queryRaw<Array<{ pid: number; applicationName: string;
      backendStart: string; state: string | null; transactionStart: string | null }>>(Prisma.sql`
      SELECT pid, application_name AS "applicationName", backend_start::text AS "backendStart",
        state, xact_start::text AS "transactionStart"
      FROM pg_stat_activity WHERE datid = ${identity.databaseOid}::oid
        AND application_name IN (${Prisma.join(names)}) ORDER BY pid LIMIT 1025`);
    if (sessions.length > 1024) throw failure('RUNTIME_DATABASE_OBSERVATION_BOUND_EXCEEDED');
    // Two-phase work outlives connections and has no trustworthy application_name.
    // Reject all prepared work in this database instead of guessing its owner.
    const [prepared] = await transaction.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) AS count FROM pg_prepared_xacts WHERE database = current_database()`;
    if (!prepared || prepared.count < 0n) throw failure('RUNTIME_DATABASE_PREPARED_WORK_UNPROVEN');
    assertBoundaryOwned();
    return { identity: { ...identity }, sessions, preparedTransactionCount: prepared.count.toString() };
  }, { maxWait: 5000, timeout: 10000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  assertBoundaryOwned();
  return result;
}
