import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { nativePostgresCliConnection } from './nativePostgresCli';
import { canonicalRecoverySchema, recoveryDatabaseSemanticsSql, type RecoveryDatabaseSemantics } from './recoverySchemaIdentity';
import { APPLICATION_RECOVERY_CONTROL_TABLES, APPLICATION_RECOVERY_CONTROL_SEQUENCES } from './recoveryControlData';
import { captureProtectedDatabaseRoles, applyProtectedDatabaseRoles,
  type ProtectedDatabaseRoleRecovery } from './protectedDatabaseRoleRecovery';

const run = promisify(execFile);
const quote = (value: string) => '"' + value.replace(/"/g, '""') + '"';
const literal = (value: string) => "'" + value.replace(/'/g, "''") + "'";
const { Client } = require('pg');

export function applicationRecoveryStageRole(stage: string) {
  if (!/^sabalan_restore_[a-f0-9]{12}$/.test(stage)) throw new Error('Invalid application recovery stage.');
  return `${stage}_login`;
}

async function command(url: string, sql: string) {
  const target = nativePostgresCliConnection(url);
  const connection = new URL(target.url);
  connection.password = encodeURIComponent(target.environment.PGPASSWORD);
  const client = new Client({ connectionString: connection.toString(), connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query('SET search_path = pg_catalog');
    return await client.query(sql);
  } finally { await client.end(); }
}

async function schema(url: string, snapshot?: string) {
  const target = nativePostgresCliConnection(url);
  const result = await run('pg_dump', ['--dbname', target.url, '--schema-only', '--no-owner', '--no-privileges',
    '--no-comments', ...(snapshot ? ['--snapshot', snapshot] : [])], {
    env: { ...process.env, ...target.environment }, windowsHide: true, maxBuffer: 32 * 1024 * 1024,
  });
  return canonicalRecoverySchema(result.stdout);
}

/** Retire only the exact stage login persisted in the owner restore journal. */
export async function retireApplicationRecoveryStageRole(ownerUrl: string, stage: string, role: string) {
  if (role !== applicationRecoveryStageRole(stage)) throw new Error('Application stage role journal identity differs.');
  const result = await command(ownerUrl, `SELECT r.rolname,
    NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolreplication OR r.rolbypassrls)
      AND r.rolconfig IS NULL AND r.rolconnlimit = 1
      AND NOT EXISTS (SELECT FROM pg_catalog.pg_auth_members WHERE member = r.oid OR roleid = r.oid)
      AND NOT EXISTS (SELECT FROM pg_catalog.pg_db_role_setting WHERE setrole = r.oid)
      AND NOT EXISTS (SELECT FROM pg_catalog.pg_shdepend dep WHERE dep.refclassid = 'pg_catalog.pg_authid'::regclass
        AND dep.refobjid = r.oid AND NOT COALESCE((
          dep.dbid = d.oid OR (dep.dbid = 0 AND dep.classid = 'pg_catalog.pg_database'::regclass AND dep.objid = d.oid)), false))
      AS stage_role_admitted,
    d.datname AS stage_database,
    current_user = session_user AND (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = session_user)
      AND (d.oid IS NULL OR d.datdba = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = session_user)) AS stage_owner_admitted
    FROM pg_catalog.pg_roles r LEFT JOIN pg_catalog.pg_database d ON d.datname = ${literal(stage)}
    WHERE r.rolname = ${literal(role)}`);
  if (!result.rows.length) return;
  const identity = result.rows[0];
  if (!identity.stage_role_admitted || !identity.stage_owner_admitted) {
    throw new Error('Application stage role has unexpected authority or ownership; cleanup refused.');
  }
  await command(ownerUrl, `ALTER ROLE ${quote(role)} NOLOGIN; SELECT pg_catalog.pg_terminate_backend(pid)
    FROM pg_catalog.pg_stat_activity WHERE usename = ${literal(role)} AND pid <> pg_backend_pid()`);
  if (identity.stage_database) {
    const stageUrl = new URL(ownerUrl);
    stageUrl.pathname = `/${stage}`;
    await command(stageUrl.toString(), `DROP OWNED BY ${quote(role)}`);
  }
  await command(ownerUrl, `DROP ROLE ${quote(role)}`);
}

/** Untrusted archive SQL authenticates as this disposable, non-privileged stage owner. */
export async function prepareApplicationRecoveryStage(ownerUrl: string, stage: string,
  scope: ProtectedDatabaseRoleRecovery & { assertBoundary(): Promise<void> }, authorityDataPath?: string) {
  const role = applicationRecoveryStageRole(stage);
  await scope.assertBoundary();
  let trustedSchema = '';
  const trustedRoles = await captureProtectedDatabaseRoles(ownerUrl, scope.roles, async snapshot => {
    trustedSchema = await schema(ownerUrl, snapshot);
    if (authorityDataPath) {
      const target = nativePostgresCliConnection(ownerUrl);
      await run('pg_dump', ['--dbname', target.url, '--format=custom', '--data-only', '--no-owner', '--no-privileges',
        '--snapshot', snapshot, '--file', authorityDataPath,
        ...[...APPLICATION_RECOVERY_CONTROL_TABLES, ...APPLICATION_RECOVERY_CONTROL_SEQUENCES].map(table => `--table=${table}`)], {
        env: { ...process.env, ...target.environment }, windowsHide: true, maxBuffer: 32 * 1024 * 1024,
      });
    }
  });
  if (trustedRoles.sourceDatabase !== scope.source) throw new Error('Application recovery target changed.');
  const databaseSemantics = (await command(ownerUrl, recoveryDatabaseSemanticsSql)).rows[0] as RecoveryDatabaseSemantics;
  if (!databaseSemantics || !['c', 'i'].includes(databaseSemantics.provider)) throw new Error('Unsupported target database locale provider.');
  const password = crypto.randomBytes(32).toString('hex');
  const control = trustedRoles.control;
  const stageUrl = new URL(ownerUrl);
  stageUrl.pathname = `/${stage}`;
  const loginUrl = new URL(stageUrl);
  loginUrl.username = role;
  loginUrl.password = password;
  // Credentials in query parameters must not override the disposable identity.
  loginUrl.searchParams.delete('user');
  loginUrl.searchParams.delete('password');
  let created = false;
  let removed = false;
  const verifySchema = async () => {
    await scope.assertBoundary();
    if (await schema(stageUrl.toString()) !== trustedSchema) {
      throw Object.assign(new Error('The migrated application schema differs from the trusted current target.'),
        { code: 'APPLICATION_RECOVERY_SCHEMA_MISMATCH' });
    }
  };
  const verifyMigratedSchema = async (schemaSql: string) => {
    await scope.assertBoundary();
    if (canonicalRecoverySchema(schemaSql) !== trustedSchema) {
      throw Object.assign(new Error('The privately migrated schema differs from the trusted current target.'),
        { code: 'APPLICATION_RECOVERY_SCHEMA_MISMATCH' });
    }
  };
  const removeRole = async () => {
    if (!created || removed) return;
    await retireApplicationRecoveryStageRole(ownerUrl, stage, role);
    removed = true;
  };
  try {
    await command(ownerUrl, `CREATE ROLE ${quote(role)} LOGIN PASSWORD ${literal(password)}
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1`);
    created = true;
    await command(stageUrl.toString(), `REVOKE ALL ON DATABASE ${quote(stage)} FROM PUBLIC;
      ALTER DATABASE ${quote(stage)} CONNECTION LIMIT 1;
      GRANT CONNECT, CREATE, TEMPORARY ON DATABASE ${quote(stage)} TO ${quote(role)};
      REVOKE ALL ON SCHEMA public FROM PUBLIC;
      ALTER SCHEMA public OWNER TO ${quote(role)}`);
    return {
      loginUrl: loginUrl.toString(),
      trustedRoles,
      databaseSemantics,
      authorityDataPath,
      verifyMigratedSchema,
      verifySchema,
      async finalize() {
        await verifySchema();
        // Disable and drain the login before elevating any verified definition.
        await command(ownerUrl, `ALTER ROLE ${quote(role)} NOLOGIN; SELECT pg_catalog.pg_terminate_backend(pid)
          FROM pg_catalog.pg_stat_activity WHERE usename = ${literal(role)} AND pid <> pg_backend_pid()`);
        await command(stageUrl.toString(), `REASSIGN OWNED BY ${quote(role)} TO ${quote(control)};
          ALTER SCHEMA public OWNER TO ${quote(trustedRoles.objects.find(object => object.kind === 'SCHEMA' && object.name === 'public')!.owner)};
          ALTER DATABASE ${quote(stage)} CONNECTION LIMIT 0`);
        await removeRole();
        await applyProtectedDatabaseRoles(stageUrl.toString(), scope.roles, trustedRoles, scope.source);
      },
      cleanup: removeRole,
    };
  } catch (error) {
    await removeRole();
    throw error;
  }
}
