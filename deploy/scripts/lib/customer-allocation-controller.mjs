import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { assertProductionDatabaseRoleConfiguration } from '../../../scripts/production-database-role-boundary.mjs';
import { verifyCustomerAllocationGoManifest } from './customer-allocation-go-manifest.mjs';

const reject = () => { throw new Error('CUSTOMER_ALLOCATION_CONTROLLER_REJECTED'); };

/** Use the controller client and a connection from the configured backend runtime. */
export function customerAllocationControllerDatabase(client, runtimeClient, roleConfiguration) {
  assertProductionDatabaseRoleConfiguration(roleConfiguration ?? {});
  return { transaction: async work => {
    if (!runtimeClient || runtimeClient === client) reject();
    const runtime = await runtimeClient.query(`
      SELECT pg_catalog.pg_backend_pid() AS pid
      WHERE session_user = 'sabalan_application_runtime' AND current_user = session_user
    `);
    const runtimePid = runtime.rows.length === 1 ? runtime.rows[0].pid : null;
    if (!Number.isInteger(runtimePid) || runtimePid < 1) reject();
    await client.query('BEGIN');
    try {
      const role = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_catalog.pg_roles AS r
          WHERE r.rolname = 'sabalan_allocation_controller'
            AND r.rolname = session_user AND r.rolname = current_user
            AND r.rolcanlogin AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
              OR r.rolinherit OR r.rolreplication OR r.rolbypassrls)
            AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_auth_members AS m
              WHERE m.roleid = r.oid OR m.member = r.oid
            )
        ) AS admitted_controller_session,
        EXISTS (
          SELECT 1 FROM pg_catalog.pg_roles AS r
          JOIN pg_catalog.pg_stat_activity AS a ON a.usesysid = r.oid
          WHERE r.rolname = 'sabalan_application_runtime'
            AND a.pid = $1 AND a.datname = current_database()
            AND r.rolcanlogin AND NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
              OR r.rolinherit OR r.rolreplication OR r.rolbypassrls)
            AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_auth_members AS m
              WHERE m.roleid = r.oid OR m.member = r.oid
            )
            AND NOT pg_catalog.has_schema_privilege(r.oid, 'public', 'CREATE')
            AND NOT pg_catalog.has_database_privilege(r.oid, current_database(), 'CREATE')
            AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_database AS d
              WHERE d.datname = current_database() AND d.datdba = r.oid
            )
            AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_namespace AS n
              WHERE n.nspname = 'public' AND n.nspowner = r.oid
            )
            AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_class AS c
              WHERE c.relnamespace = 'public'::pg_catalog.regnamespace
                AND c.relname IN ('_prisma_migrations', 'deployment_operations',
                  'customer_allocation_release_control', 'customer_allocation_release_audit',
                  'sepidar_customer_opening_manifests', 'sepidar_customer_opening_admissions', 'sepidar_cheque_batch_admissions')
                AND (c.relowner = r.oid
                  OR pg_catalog.has_table_privilege(r.oid, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
                  OR pg_catalog.has_any_column_privilege(r.oid, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))
            )
            AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_proc AS p
              WHERE p.pronamespace = 'public'::pg_catalog.regnamespace
                AND p.prosecdef AND (p.proowner = r.oid OR (
                  pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE')
                  AND p.oid IS DISTINCT FROM pg_catalog.to_regprocedure('public.customer_allocation_runtime_admitted(text,text)')
                  AND p.oid IS DISTINCT FROM pg_catalog.to_regprocedure(
                    'public.sepidar_customer_opening_runtime_admitted(text,text,text,text,text,timestamptz,text,text,text,text,text,text)')
                ))
            )
        ) AS admitted_runtime_session
      `, [runtimePid]);
      if (role.rows.length !== 1 || role.rows[0].admitted_controller_session !== true
        || role.rows[0].admitted_runtime_session !== true) reject();
      const result = await work({
        close: async ({ deploymentId, leaseToken, releaseId, manifestSha256 }) => {
          const { rows } = await client.query(
            'SELECT * FROM public.customer_allocation_controller_close($1, $2, $3, $4)',
            [deploymentId, leaseToken, releaseId, manifestSha256]);
          if (rows.length !== 1) reject();
          return rows[0];
        },
        lock: async (deploymentId, leaseToken) => {
          const { rows } = await client.query(
            'SELECT * FROM public.customer_allocation_controller_lock($1, $2)', [deploymentId, leaseToken]);
          const row = rows[0];
          if (!row) reject();
          return Object.fromEntries(Object.entries(row).map(([key, value]) =>
            [key === 'deployment_id' ? 'deploymentId' : key, value instanceof Date ? value.toISOString() : value]));
        },
        activate: async ({ deploymentId, leaseToken, releaseId, manifestSha256, expiresAt }) => {
          const { rows } = await client.query(
            'SELECT * FROM public.customer_allocation_controller_activate($1, $2, $3, $4, $5)',
            [deploymentId, leaseToken, releaseId, manifestSha256, expiresAt]);
          if (rows.length !== 1) reject();
          return rows[0];
        },
      });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } };
}

export async function closeCustomerAllocation({ db, deploymentId, leaseToken, releaseId, manifestSha256 }) {
  if (!db || typeof db.transaction !== 'function'
    || ![deploymentId, leaseToken, releaseId].every(value => typeof value === 'string' && value.length > 0)
    || typeof manifestSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(manifestSha256)) reject();
  return db.transaction(async tx => {
    const receipt = await tx.close({ deploymentId, leaseToken, releaseId, manifestSha256 });
    if (receipt?.state !== 'CLOSED' || receipt.manifest_sha256 !== manifestSha256) reject();
    return receipt;
  });
}

export function privateDirectoryReader(evidenceDirectory) {
  const uid = process.getuid?.();
  if (uid === undefined || !path.isAbsolute(evidenceDirectory ?? '') || realpathSync(evidenceDirectory) !== evidenceDirectory) reject();
  const directory = lstatSync(evidenceDirectory);
  if (!directory.isDirectory() || directory.uid !== uid || (directory.mode & 0o077) !== 0) reject();
  return (name, maxBytes) => {
    const file = path.join(evidenceDirectory, name);
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = fstatSync(fd, { bigint: true });
      if (!before.isFile() || before.uid !== BigInt(uid) || before.nlink !== 1n
        || (before.mode & 0o077n) !== 0n || before.size < 1n || before.size > BigInt(maxBytes)) reject();
      const bytes = readFileSync(fd);
      const after = fstatSync(fd, { bigint: true });
      const named = lstatSync(file, { bigint: true });
      for (const key of ['dev', 'ino', 'mode', 'uid', 'nlink', 'size', 'mtimeNs', 'ctimeNs']) {
        if (before[key] !== after[key] || before[key] !== named[key]) reject();
      }
      if (BigInt(bytes.length) !== before.size) reject();
      return bytes;
    } finally { closeSync(fd); }
  };
}

/** The caller supplies observed source/image identities and the separately pinned approver. */
export async function activateCustomerAllocation({ db, evidenceDirectory, expected, deploymentId, leaseToken, approver, validateReader }) {
  if (!db || typeof db.transaction !== 'function' || !expected || !approver ||
    typeof deploymentId !== 'string' || !deploymentId || typeof leaseToken !== 'string' || !leaseToken) reject();
  const read = privateDirectoryReader(evidenceDirectory);
  const reader = read('reader.json', 4 * 1024 * 1024);
  if (validateReader) validateReader(JSON.parse(reader.toString('utf8')));
  const digest = name => createHash('sha256').update(read(name, 4 * 1024 * 1024)).digest('hex');
  const envelope = JSON.parse(read('decision.json', 64 * 1024).toString('utf8'));
  const observed = {
    ...expected,
    cohortSha256: digest('cohort.json'),
    evidence: {
      reader: createHash('sha256').update(reader).digest('hex'), populatedQa: digest('populated-qa.json'), rollback: digest('rollback.json'),
    },
  };
  return db.transaction(async tx => {
    const locked = await tx.lock(deploymentId, leaseToken);
    if (!locked || locked.deploymentId !== deploymentId || locked.leaseToken !== leaseToken) reject();
    const { activeKey, phase, leaseExpiresAt, targetCommit, releaseId, dbClock, controlState } = locked;
    const verified = verifyCustomerAllocationGoManifest(envelope, {
      ...observed, deploymentId, leaseToken, activeKey, phase, leaseExpiresAt, targetCommit, releaseId, dbClock, controlState,
    }, approver);
    const receipt = await tx.activate({ deploymentId, leaseToken, releaseId: verified.releaseId,
      manifestSha256: verified.manifestSha256, expiresAt: verified.expiresAt });
    if (receipt?.state !== 'ACTIVE' || receipt.manifest_sha256 !== verified.manifestSha256) reject();
    return receipt;
  });
}
