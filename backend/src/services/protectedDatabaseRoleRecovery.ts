import fs from 'node:fs/promises';
import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { PrismaClient } from '@prisma/client';
import { readDeploymentMaintenance } from './deploymentMaintenance';
import { readCanonicalCheckpointMetadata, checkpointMetadataTransport } from './deploymentCheckpointMetadataIdentity';
import { assertRemoteCheckpointFingerprint } from './deploymentCheckpointStorage';
import { validateDeploymentHostJournal } from './deploymentHostJournal';
import { nativePostgresCliConnection } from './nativePostgresCli';
import { sha256File } from './recoveryCrypto';

type RoleSplit = { runtime: string; controller: string };
const sepidarController = 'sabalan_sepidar_opening_controller';
const sepidarRoutines = new Map([
  ['sepidar_customer_opening_lock', 'text, text, text'],
  ['sepidar_customer_opening_register_manifest', 'text, text, text, text, text'],
  ['sepidar_customer_opening_runtime_admitted', 'text, text, text, text, text, timestamp with time zone, text, text, text, text, text, text'],
]);
const chequeRoutines = new Map([
  ['sepidar_cheque_batch_register', 'text, text, text, text, text'],
  ['sepidar_opening_cheques_runtime_admitted', 'text, text, text, text'],
]);
const sepidarRuntimeRoutines = new Set(['sepidar_customer_opening_runtime_admitted', 'sepidar_opening_cheques_runtime_admitted']);
const sepidarRoutineArguments = (name: string) => sepidarRoutines.get(name) ?? chequeRoutines.get(name);
const sepidarRolePrivileges = (kind: string, name: string, args: string, securityDefiner: boolean) => {
  if (kind === 'DATABASE' && name === '') return ['CONNECT'];
  if (kind === 'SCHEMA' && name === 'public') return ['USAGE'];
  if (kind === 'FUNCTION' && !sepidarRuntimeRoutines.has(name) && sepidarRoutineArguments(name) === args && securityDefiner) return ['EXECUTE'];
  return [];
};
type Client = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(sql: string, values?: unknown[]): Promise<{ rows: any[] }>;
};

const { Client } = require('pg') as { Client: new (config: {
  connectionString: string; connectionTimeoutMillis: number;
}) => Client };

export { PROTECTED_DATABASE_ROLE_COMPONENT } from './deploymentCheckpointPolicy';

const privileges = {
  DATABASE: ['CONNECT', 'CREATE', 'TEMPORARY'],
  SCHEMA: ['CREATE', 'USAGE'],
  TABLE: ['DELETE', 'INSERT', 'REFERENCES', 'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'],
  SEQUENCE: ['SELECT', 'UPDATE', 'USAGE'],
  FUNCTION: ['EXECUTE'],
  PROCEDURE: ['EXECUTE'],
} as const;

type Kind = keyof typeof privileges;
type Grant = { grantee: string; privilege: string; grantable: boolean; grantor: string };
type ObjectAcl = { kind: Kind; name: string; arguments: string; owner: string; securityDefiner: boolean; grants: Grant[] };
type CatalogAcl = ObjectAcl & { target: string };
type RoleAttributes = { name: string; login: boolean; connectionLimit: number; validUntil: string | null };
export type RoleSnapshot = {
  version: 1;
  sourceDatabase: string;
  control: string;
  roles: RoleAttributes[];
  objects: ObjectAcl[];
};

const fail = (reason: string): never => {
  throw Object.assign(new Error(reason), { code: 'PROTECTED_DATABASE_ROLE_RECOVERY_REJECTED' });
};

const quoteIdentifier = (name: string) => '"' + name.replace(/"/g, '""') + '"';
const objectIdentity = (object: ObjectAcl) => JSON.stringify([object.kind, object.name, object.arguments]);
const byText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

const aclCatalog = `
  WITH objects AS (
    SELECT 'DATABASE' AS kind, '' AS name, '' AS arguments,
      format('%I', datname) AS target, datdba AS owner, 'd'::"char" AS code, datacl AS acl, false AS security_definer
    FROM pg_database WHERE datname = current_database()
    UNION ALL
    SELECT 'SCHEMA', nspname, '', format('%I', nspname), nspowner, 'n', nspacl, false
    FROM pg_namespace WHERE nspname = 'public'
    UNION ALL
    SELECT CASE WHEN c.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
      c.relname, '', format('%I.%I', 'public', c.relname), c.relowner,
      CASE WHEN c.relkind = 'S' THEN 's'::"char" ELSE 'r'::"char" END, c.relacl, false
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    UNION ALL
    SELECT CASE WHEN p.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
      p.proname, oidvectortypes(p.proargtypes), format('%I.%I(%s)', 'public', p.proname, oidvectortypes(p.proargtypes)),
      p.proowner, 'f', p.proacl, p.prosecdef
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  )
  SELECT kind, name, arguments, target, pg_get_userbyid(owner) AS owner, security_definer AS "securityDefiner",
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'grantee', CASE WHEN a.grantee = 0 THEN '' ELSE pg_get_userbyid(a.grantee) END,
        'privilege', a.privilege_type, 'grantable', a.is_grantable, 'grantor', pg_get_userbyid(a.grantor)))
      FROM aclexplode(COALESCE(acl, acldefault(code, owner))) a
    ), '[]'::jsonb) AS grants
  FROM objects
`;

async function withTransaction<T>(databaseUrl: string, mode: 'READ ONLY' | 'READ WRITE', work: (client: Client) => Promise<T>): Promise<T> {
  const target = nativePostgresCliConnection(databaseUrl);
  const url = new URL(target.url);
  url.password = encodeURIComponent(target.environment.PGPASSWORD);
  const client = new Client({
    connectionString: url.toString(), connectionTimeoutMillis: 10000,
  });
  try {
    await client.connect();
    await client.query(`BEGIN ISOLATION LEVEL REPEATABLE READ ${mode}`);
    await client.query("SET LOCAL search_path = pg_catalog; SET LOCAL TIME ZONE 'UTC'");
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } finally {
    await client.end();
  }
}

async function readIdentity(client: Client, roles: RoleSplit, requireRuntimeLogin = true) {
  const { rows: [identity] } = await client.query(`
    SELECT current_database() AS database, session_user AS control,
      current_user = session_user AND r.rolsuper AND r.rolcanlogin AND d.datdba = r.oid AS admitted,
      d.datconnlimit AS "connectionLimit"
    FROM pg_roles r CROSS JOIN pg_database d
    WHERE r.rolname = session_user AND d.datname = current_database()
  `);
  if (!identity?.admitted || roles.runtime === roles.controller || [roles.runtime, roles.controller].includes(identity.control)) {
    fail('The protected recovery connection does not own the database under its authenticated control role.');
  }
  const { rows: attributes } = await client.query(`
    WITH sepidar_schema AS (
      SELECT EXISTS (SELECT FROM pg_catalog.pg_proc p
        WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY($4::text[])) AS present
    )
    SELECT r.rolname AS name, r.rolcanlogin AS login, r.rolconnlimit AS "connectionLimit", r.rolvaliduntil::text AS "validUntil",
      sepidar_schema.present AS "hasSepidar",
      NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolreplication OR r.rolbypassrls)
      AND r.rolconfig IS NULL AND (r.rolcanlogin OR auth.rolpassword IS NULL)
      AND NOT EXISTS (SELECT FROM pg_auth_members WHERE member = r.oid OR roleid = r.oid)
      AND NOT EXISTS (
        SELECT FROM pg_shdepend
        WHERE refclassid = 'pg_authid'::regclass AND refobjid = r.oid AND deptype = 'o'
      )
      AND NOT EXISTS (SELECT FROM pg_db_role_setting WHERE setrole = r.oid) AS restricted
    FROM pg_roles r JOIN pg_authid auth USING (oid) CROSS JOIN sepidar_schema
    WHERE r.rolname IN ($1, $2) OR (sepidar_schema.present AND r.rolname = $3)
  `, [roles.runtime, roles.controller, sepidarController, [...sepidarRoutines.keys()]]);
  if (attributes.length !== (attributes[0]?.hasSepidar ? 3 : 2) || attributes.some(role => !role.restricted
    || (role.name === 'sabalan_application_runtime' && requireRuntimeLogin && !role.login))) {
    fail('The protected database roles are missing or have unsupported attributes or memberships.');
  }
  const roleAttributes: RoleAttributes[] = attributes.map(({ name, login, connectionLimit, validUntil }) => ({ name, login, connectionLimit, validUntil }));
  roleAttributes.sort((a, b) => byText(a.name, b.name));
  return { database: identity.database as string, control: identity.control as string, connectionLimit: identity.connectionLimit as number, roles: roleAttributes };
}

async function readCatalog(client: Client): Promise<CatalogAcl[]> {
  const { rows: [unsupported] } = await client.query(`
    SELECT EXISTS(SELECT FROM pg_default_acl)
      OR EXISTS(SELECT FROM pg_attribute a JOIN pg_class c ON a.attrelid = c.oid
        WHERE c.relnamespace = 'public'::regnamespace AND a.attacl IS NOT NULL)
      OR EXISTS(SELECT FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typacl IS NOT NULL)
      OR EXISTS(SELECT FROM pg_largeobject_metadata)
      OR EXISTS(SELECT FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('public', 'information_schema'))
      AS present
  `);
  if (unsupported.present) fail('The protected database contains ACL objects outside the supported role contract.');
  const { rows } = await client.query(aclCatalog);
  return (rows as CatalogAcl[]).sort((a, b) => byText(objectIdentity(a), objectIdentity(b)));
}

const isKind = (value: string): value is Kind => Object.prototype.hasOwnProperty.call(privileges, value);

function canonicalObjects(objects: ObjectAcl[], control: string, roles: RoleSplit): ObjectAcl[] {
  if (!Array.isArray(objects)) return fail('Protected role recovery requires a catalog ACL snapshot.');
  const identities = new Set<string>();
  return objects.map(({ kind, name, arguments: argumentTypes, owner, securityDefiner, grants }) => {
    if (!isKind(kind) || typeof name !== 'string' || typeof argumentTypes !== 'string' || typeof securityDefiner !== 'boolean'
      || (owner !== control && !(kind === 'SCHEMA' && name === 'public' && owner === 'pg_database_owner'))
      || !Array.isArray(grants)) return fail('An ACL object has unsupported identity or ownership.');
    const grantees = new Set([owner, '', roles.runtime, roles.controller]);
    if (sepidarRolePrivileges(kind, name, argumentTypes, securityDefiner).length) grantees.add(sepidarController);
    const validPrivileges: readonly string[] = privileges[kind];
    const id = objectIdentity({ kind, name, arguments: argumentTypes } as ObjectAcl);
    if (identities.has(id)) return fail('The ACL snapshot contains a duplicate object.');
    identities.add(id);
    const grantIds = new Set<string>();
    const canonicalGrants = grants.map(({ grantee, privilege, grantable, grantor }) => {
      const grantId = JSON.stringify([grantee, privilege]);
      if (grantor !== owner || !grantees.has(grantee) || !validPrivileges.includes(privilege)
        || grantable !== false || grantIds.has(grantId)) return fail('An ACL grant is outside the protected role contract.');
      grantIds.add(grantId);
      return { grantee, privilege, grantable, grantor };
    }).sort((a, b) => byText(JSON.stringify(a), JSON.stringify(b)));
    return { kind, name, arguments: argumentTypes, owner, securityDefiner, grants: canonicalGrants };
  }).sort((a, b) => byText(objectIdentity(a), objectIdentity(b)));
}

function assertRestrictedAccess(catalog: ObjectAcl[], roles: RoleSplit) {
  const protectedTables = new Set(['_prisma_migrations', 'deployment_operations',
    'customer_allocation_release_control', 'customer_allocation_release_audit',
    'sepidar_customer_opening_manifests', 'sepidar_customer_opening_admissions', 'sepidar_cheque_batch_admissions']);
  const openingRoutines = catalog.filter(object => sepidarRoutines.has(object.name));
  if (openingRoutines.length && (openingRoutines.length !== sepidarRoutines.size
    || new Set(openingRoutines.map(object => object.name)).size !== sepidarRoutines.size)) {
    fail('The protected Sepidar opening routine set is incomplete.');
  }
  const chequeBatch = catalog.some(object => object.kind === 'TABLE' && object.name === 'sepidar_cheque_batch_admissions');
  const chequeFunctions = catalog.filter(object => chequeRoutines.has(object.name) && object.securityDefiner);
  if ((chequeBatch && (chequeFunctions.length !== chequeRoutines.size
    || new Set(chequeFunctions.map(object => object.name)).size !== chequeRoutines.size)) || (!chequeBatch && chequeFunctions.length)) {
    fail('The protected Sepidar cheque routine set is incomplete.');
  }
  for (const object of catalog) {
    const sepidarRoutine = chequeBatch ? sepidarRoutineArguments(object.name) : sepidarRoutines.get(object.name);
    const openingRuntimeCheck = sepidarRuntimeRoutines.has(object.name);
    if (sepidarRoutine) {
      const external = object.grants.filter(grant => grant.grantee !== object.owner);
      const principal = openingRuntimeCheck ? roles.runtime : sepidarController;
      if (object.kind !== 'FUNCTION' || object.arguments !== sepidarRoutine || !object.securityDefiner
        || external.length !== 1 || external[0].grantee !== principal || external[0].privilege !== 'EXECUTE'
        || external[0].grantable || external[0].grantor !== object.owner) {
        fail('The protected Sepidar opening grants differ from the reviewed capability.');
      }
    }
    for (const grant of object.grants) {
      const runtimeAccess = [roles.runtime, ''].includes(grant.grantee);
      const controllerAccess = [roles.controller, ''].includes(grant.grantee);
      if (((object.kind === 'DATABASE' || object.kind === 'SCHEMA') && grant.privilege === 'CREATE'
          && (runtimeAccess || controllerAccess))
        || (object.kind === 'TABLE' && protectedTables.has(object.name) && (runtimeAccess || controllerAccess))
        || (grant.grantee === sepidarController && (!openingRoutines.length
          || !sepidarRolePrivileges(object.kind, object.name, object.arguments, object.securityDefiner).includes(grant.privilege)))
        || (object.securityDefiner && (grant.grantee === ''
          || (grant.grantee === roles.runtime && !openingRuntimeCheck
            && !(object.name === 'customer_allocation_runtime_admitted' && object.arguments === 'text, text'))))) {
        fail('The protected ACLs would expose database control authority to a restricted role.');
      }
    }
  }
}

const firstSplitRoles = { runtime: 'sabalan_application_runtime', controller: 'sabalan_allocation_controller' };
const firstSplitForbiddenTables = new Set(['_prisma_migrations', 'deployment_operations',
  'customer_allocation_release_control', 'customer_allocation_release_audit',
  'shipment_statement_migration_evidence', 'shipment_statement_migration_manifests', 'shipment_statement_migration_runs',
  'sepidar_customer_opening_manifests', 'sepidar_customer_opening_admissions', 'sepidar_cheque_batch_admissions']);

function firstSplitPrivilege(object: Pick<ObjectAcl, 'kind' | 'name'>, privilege: string) {
  switch (object.kind) {
    case 'DATABASE': return privilege === 'CONNECT';
    case 'SCHEMA': return object.name === 'public' && privilege === 'USAGE';
    case 'SEQUENCE': return object.name !== 'customer_allocation_release_audit_id_seq' && privilege === 'USAGE';
    case 'TABLE': return !firstSplitForbiddenTables.has(object.name) && ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(privilege);
    default: return false;
  }
}

type CutoverCatalogReceipt = { format: string; migrationCount: number; objects: ObjectAcl[]; roleFlags: RoleAttributes[] };

/**
 * Apply only the exact ACL delta in the transaction owned by the first-split
 * deployment controller. The caller owns the checkpoint and lease fence.
 */
export async function changeDormantFirstSplitRuntimeGrants(
  client: Client, before: CutoverCatalogReceipt, staged: CutoverCatalogReceipt, action: 'stage' | 'restore',
  runtimeActivated = false,
) {
  const identity = await readIdentity(client, firstSplitRoles, false);
  const withoutTestLogin = staged.roleFlags.map(role => role.name === firstSplitRoles.runtime ? { ...role, login: false } : role);
  const expectedRoles = runtimeActivated ? staged.roleFlags : before.roleFlags;
  if (identity.connectionLimit !== -1 || identity.roles.length !== 3
    || !isDeepStrictEqual(identity.roles, expectedRoles.map(({ name, login, connectionLimit, validUntil }) =>
      ({ name, login, connectionLimit, validUntil })))
    || !isDeepStrictEqual(withoutTestLogin, before.roleFlags)
    || !staged.roleFlags.some(role => role.name === firstSplitRoles.runtime && role.login)) {
    return fail('The first split requires its original dormant, restricted database roles.');
  }
  const baseFormat = 'sabalan-role-rehearsal-read-only-prod-catalog/v1';
  if (before.format !== baseFormat || staged.format !== baseFormat
    || !Number.isSafeInteger(before.migrationCount) || before.migrationCount < 1
    || before.migrationCount !== staged.migrationCount
    || !['stage', 'restore'].includes(action)) return fail('Invalid first-split ACL receipts.');

  const catalog = await readCatalog(client);
  const current = canonicalObjects(catalog, identity.control, firstSplitRoles);
  const previous = canonicalObjects(before.objects, identity.control, firstSplitRoles);
  const proposed = canonicalObjects(staged.objects, identity.control, firstSplitRoles);
  if (previous.length !== catalog.length || proposed.length !== catalog.length) {
    return fail('The live first-split catalog object count differs from the rehearsal.');
  }
  assertRestrictedAccess(previous, firstSplitRoles);
  assertRestrictedAccess(proposed, firstSplitRoles);
  const expectedPreimage = action === 'stage' ? previous : proposed;
  const expectedResult = action === 'stage' ? proposed : previous;
  const alreadyApplied = isDeepStrictEqual(current, expectedResult);
  if (!alreadyApplied && !isDeepStrictEqual(current, expectedPreimage)) return fail('The live first-split ACL preimage differs from the rehearsal.');

  const statements: string[] = [];
  for (let i = 0; i < catalog.length; i++) {
    const { grants: oldGrants, ...oldObject } = previous[i];
    const { grants: newGrants, ...newObject } = proposed[i];
    if (!isDeepStrictEqual(oldObject, newObject) || oldGrants.some(old => !newGrants.some(grant => isDeepStrictEqual(grant, old)))) {
      return fail('A first-split ACL plan cannot remove grants or change catalog objects.');
    }
    const extras = newGrants.filter(grant => !oldGrants.some(old => isDeepStrictEqual(grant, old)));
    for (const grant of extras) {
      if (grant.grantee !== firstSplitRoles.runtime || !firstSplitPrivilege(newObject, grant.privilege)) {
        return fail('A first-split ACL change is outside the runtime capability.');
      }
      const command = action === 'stage' ? 'GRANT' : 'REVOKE';
      const direction = action === 'stage' ? 'TO' : 'FROM';
      statements.push(`${command} ${grant.privilege} ON ${catalog[i].kind} ${catalog[i].target} ${direction} ${quoteIdentifier(firstSplitRoles.runtime)}`);
    }
  }
  if (!alreadyApplied && statements.length) await client.query(statements.join(';\n'));
  const verified = canonicalObjects(await readCatalog(client), identity.control, firstSplitRoles);
  if (!isDeepStrictEqual(verified, expectedResult)) return fail('The first-split ACL result differs from the rehearsal.');
  return { alreadyApplied, grants: statements.length };
}

const firstSplitPurpose = 'first-database-role-cutover';
const sha256Pattern = /^[a-f0-9]{64}$/;
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');

const firstSplitVerifierPattern = /^SCRAM-SHA-256\$4096:([A-Za-z0-9+/]{22}==)\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/;

export function firstSplitCredentialVerifier(password: Buffer, salt: Buffer) {
  const encoded = password.toString('ascii');
  if (password.length !== 43 || !/^[A-Za-z0-9_-]{43}$/.test(encoded)
    || !Buffer.from(Buffer.from(encoded, 'base64url').toString('base64url')).equals(password) || salt.length !== 16) {
    return fail('The first-split credential is invalid.');
  }
  const salted = pbkdf2Sync(password, salt, 4096, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  try {
    const stored = createHash('sha256').update(clientKey).digest('base64');
    const server = createHmac('sha256', salted).update('Server Key').digest('base64');
    return `SCRAM-SHA-256$4096:${salt.toString('base64')}$${stored}:${server}`;
  } finally {
    salted.fill(0);
    clientKey.fill(0);
  }
}

async function proveFirstSplitCredential(databaseUrl: string, credential: Buffer) {
  const url = new URL(nativePostgresCliConnection(databaseUrl).url);
  url.username = firstSplitRoles.runtime;
  url.searchParams.set('application_name', 'sabalan-first-role-login-proof');
  url.password = randomBytes(32).toString('base64url');
  try {
    await withTransaction(url.toString(), 'READ ONLY', async () => {});
    return fail('PostgreSQL accepted an unowned first-split credential.');
  } catch (error: any) {
    if (error?.code !== '28P01') return fail('PostgreSQL did not deny the unowned runtime credential as expected.');
  }
  url.password = credential.toString('ascii');
  try {
    await withTransaction(url.toString(), 'READ ONLY', async client => {
      const { rows: [proof] } = await client.query(`
        SELECT session_user = $1 AND current_user = session_user
          AND has_table_privilege('public.accounting_parties', 'SELECT')
          AND NOT has_table_privilege('public._prisma_migrations', 'SELECT')
          AND NOT has_table_privilege('public.deployment_operations', 'SELECT')
          AND NOT has_table_privilege('public.sepidar_customer_opening_admissions', 'SELECT') AS admitted
      `, [firstSplitRoles.runtime]);
      if (!proof?.admitted) return fail('The runtime did not pass its committed access proof.');
    });
  } catch {
    return fail('The runtime did not pass its committed access proof.');
  }
}

async function verifyFirstSplitMigrations(client: Client, expectedDigest: string, count: number) {
  const directory = path.resolve(__dirname, '../../prisma/migrations');
  const names = (await fs.readdir(directory, { withFileTypes: true }))
    .filter(item => item.isDirectory()).map(item => item.name).sort();
  if (names.length !== count || names.some(name => !/^\d+_[A-Za-z0-9_]+$/.test(name))) {
    return fail('The first-split migration source is incomplete.');
  }
  const source = Object.fromEntries(await Promise.all(names.map(async name =>
    [name, sha256(await fs.readFile(path.join(directory, name, 'migration.sql')))])));
  const { rows } = await client.query(`
    SELECT migration_name AS name, checksum, finished_at IS NOT NULL AS finished
    FROM public._prisma_migrations WHERE rolled_back_at IS NULL
  `);
  if (sha256(JSON.stringify(source)) !== expectedDigest || rows.length !== count
    || new Set(rows.map(row => row.name)).size !== count
    || rows.some(row => !row.finished || source[row.name] !== row.checksum)) {
    return fail('The first-split migration ledger differs from the pinned source.');
  }
}

/** Used only by the dedicated protected cutover owner after a verified checkpoint. */
export async function changeOwnedFirstSplitRuntimeGrants(input: {
  action: 'stage' | 'activate' | 'restore'; databaseUrl: string; credential?: Buffer;
  coordinationDir: string; reportDir: string; remoteRoot?: string;
  beforeBytes: Buffer; stagedBytes: Buffer;
}) {
  const phase = input.action === 'restore' ? 'ROLLBACK_STARTED' : 'MUTATION_STARTED';
  const reportPath = path.join(input.reportDir, 'active-deployment-session.json');
  const session = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  const binding = session.firstRoleCutover;
  const token = process.env.DEPLOYMENT_LEASE_TOKEN;
  if (!['stage', 'activate', 'restore'].includes(input.action)
    || (input.action === 'activate') !== Boolean(input.credential) || process.env.BACKEND_RUNTIME_ROLE !== 'control'
    || !sha256Pattern.test(token || '') || session.leaseToken !== token
    || session.deploymentId !== process.env.DEPLOYMENT_ID || session.releaseId !== process.env.DEPLOYMENT_RELEASE_ID
    || session.controlImage !== process.env.DEPLOYMENT_CONTROL_IMAGE
    || !/^sha256:[a-f0-9]{64}$/.test(session.controlImage ?? '') || !/^[a-f0-9]{40}$/.test(session.targetCommit ?? '')
    || session.purpose !== firstSplitPurpose || session.bootstrap !== false || session.phase !== phase
    || !binding || !sha256Pattern.test(binding.migrationSha256 ?? '')
    || !isDeepStrictEqual(Object.keys(binding).sort(), ['afterEnvironmentSha256', 'beforeEnvironmentSha256', 'beforeSha256', 'migrationSha256', 'stagedSha256'])
    || ![binding.beforeEnvironmentSha256, binding.afterEnvironmentSha256].every(hash => sha256Pattern.test(hash ?? ''))
    || binding.beforeEnvironmentSha256 === binding.afterEnvironmentSha256
    || binding.beforeSha256 !== sha256(input.beforeBytes) || binding.stagedSha256 !== sha256(input.stagedBytes)) {
    return fail('The first split requires its dedicated session and rehearsed ACL evidence.');
  }
  const assertMarker = async () => {
    const marker = await readDeploymentMaintenance(input.coordinationDir);
    if (marker?.deploymentId !== session.deploymentId || marker?.releaseId !== session.releaseId) {
      return fail('The first-split maintenance marker changed.');
    }
  };
  await assertMarker();
  const journal = await validateDeploymentHostJournal(path.join(input.reportDir, 'active-deployment.jsonl'));
  const markerIndex = journal.findIndex(entry => entry.event === 'maintenance-activated');
  const requiredPhases = ['SERVICES_DRAINED', 'LOCAL_CHECKPOINT_VERIFIED', 'REMOTE_CHECKPOINT_VERIFIED', 'MUTATION_STARTED',
    ...(input.action === 'restore' ? ['ROLLBACK_STARTED'] : [])];
  if (markerIndex < 0 || journal.some(entry => entry.deploymentId !== session.deploymentId)
    || journal[0]?.event !== 'deployment-prepared' || !isDeepStrictEqual(journal[0].details?.firstRoleCutover, binding)
    || !isDeepStrictEqual(journal.slice(markerIndex + 1)
      .filter(entry => entry.event === 'phase-transition' && requiredPhases.includes(entry.phase))
      .map(entry => entry.phase), requiredPhases)) return fail('The first-split journal does not prove the maintenance boundary.');

  try {
    await fs.lstat(path.join(input.reportDir, 'first-role-cutover-open-intent.json'));
    return fail('The first split may have reopened public traffic.');
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const checkpoint = readCanonicalCheckpointMetadata(JSON.parse(await fs.readFile(
    path.join(input.coordinationDir, 'deployment-checkpoint.json'), 'utf8')));
  const verified = checkpoint.metadata;
  if (verified.deploymentId !== session.deploymentId || verified.releaseId !== session.releaseId
    || verified.targetCommit !== session.targetCommit || verified.captureMethod !== 'PROTECTED_MAINTENANCE_COMPLETE'
    || verified.localVerified !== true || verified.remoteVerified !== true || verified.localRestoreVerified !== true
    || verified.manifestReadable !== true || !verified.sourceDatabase || !path.isAbsolute(verified.localPath ?? '')
    || !sha256Pattern.test(verified.checksum ?? '')) return fail('The first split requires its verified checkpoint.');
  const archive = await fs.lstat(verified.localPath);
  if (!archive.isFile() || archive.size !== verified.size || await sha256File(verified.localPath) !== verified.checksum) {
    return fail('The first-split local checkpoint archive changed.');
  }
  if (input.action !== 'restore') {
    if (!input.remoteRoot || !path.isAbsolute(input.remoteRoot) || !path.isAbsolute(verified.remotePath ?? '')
      || !path.resolve(verified.remotePath).startsWith(path.resolve(input.remoteRoot) + path.sep)) {
      return fail('The first-split checkpoint is outside the verified remote mount.');
    }
    await assertRemoteCheckpointFingerprint(verified.remotePath, verified.remoteFingerprint);
    const remote = readCanonicalCheckpointMetadata(JSON.parse(await fs.readFile(verified.remotePath + '.json', 'utf8')));
    if (remote.sha256 !== checkpoint.sha256) return fail('The first-split remote checkpoint receipt changed.');
  }

  const before = JSON.parse(input.beforeBytes.toString('utf8')) as CutoverCatalogReceipt;
  const staged = JSON.parse(input.stagedBytes.toString('utf8')) as CutoverCatalogReceipt;
  const transition = await withTransaction(input.databaseUrl, 'READ WRITE', async client => {
    await client.query("SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '30s'");
    const { rows } = await client.query(`
      SELECT "checkpointJson" AS checkpoint, "reportJson"->'firstRoleCutoverAcl' AS receipt
      FROM public.deployment_operations
      WHERE "activeKey" = 'production' AND id = $1 AND "releaseId" = $2 AND "targetCommit" = $3
        AND owner = $4 AND phase = $5 AND "leaseToken" = $6 AND "leaseExpiresAt" > clock_timestamp() AT TIME ZONE 'UTC'
      FOR UPDATE
    `, [session.deploymentId, session.releaseId, session.targetCommit, session.owner, phase, token]);
    if (rows.length !== 1 || !rows[0].checkpoint
      || checkpointMetadataTransport(rows[0].checkpoint).canonicalMetadataSha256 !== checkpoint.sha256) {
      return fail('The first-split lease or its bound checkpoint has changed.');
    }
    const { rows: [database] } = await client.query(`
      SELECT current_database() AS name, (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS oid,
        (SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier",
        NOT EXISTS (SELECT FROM pg_stat_activity WHERE backend_type = 'client backend' AND pid <> pg_backend_pid()
          AND (datname = current_database() OR usename IN ($1, $2, $3)))
        AND NOT EXISTS (SELECT FROM pg_prepared_xacts WHERE database = current_database()) AS drained
    `, [firstSplitRoles.runtime, firstSplitRoles.controller, sepidarController]);
    if (!database?.drained || database.name !== verified.sourceDatabase.name || database.oid !== verified.sourceDatabase.oid
      || database.systemIdentifier !== verified.sourceDatabase.systemIdentifier) {
      return fail('The first-split database is not the drained checkpoint source.');
    }
    await verifyFirstSplitMigrations(client, binding.migrationSha256, before.migrationCount);
    const ownership = { checkpointSha256: verified.checksum, checkpointMetadataSha256: checkpoint.sha256, ...binding };
    const prior = rows[0].receipt;
    const owns = (action: 'stage' | 'activate') => prior?.action === action
      && Object.entries(ownership).every(([key, value]) => prior[key] === value);
    const { rows: [runtime] } = await client.query(`
      SELECT rolcanlogin AS login, rolpassword AS verifier FROM pg_authid WHERE rolname = $1
    `, [firstSplitRoles.runtime]);
    if (!runtime || (!runtime.login && runtime.verifier !== null)
      || (runtime.login && (!owns('activate') || !firstSplitVerifierPattern.test(runtime.verifier ?? '')
        || sha256(runtime.verifier) !== prior.verifierSha256))) return fail('The runtime credential is outside this cutover.');
    if (input.action === 'restore' && runtime.login) {
      await client.query(`ALTER ROLE ${quoteIdentifier(firstSplitRoles.runtime)} NOLOGIN PASSWORD NULL`);
    }
    const activate = input.credential;
    if (activate && ((!owns('stage') && !runtime.login)
      || activate.toString('ascii') === nativePostgresCliConnection(input.databaseUrl).environment.PGPASSWORD)) {
      return fail('Credential activation requires the staged cutover grants and a separate credential.');
    }
    const result = await changeDormantFirstSplitRuntimeGrants(client, before, staged,
      input.action === 'restore' ? 'restore' : 'stage', input.action === 'activate' && runtime.login);
    let verifierSha256: string | undefined;
    if (activate) {
      if (!result.alreadyApplied || prior.grants !== result.grants) return fail('The staged cutover grants have changed.');
      const salt = runtime.login ? Buffer.from(firstSplitVerifierPattern.exec(runtime.verifier)![1], 'base64') : randomBytes(16);
      const verifier = firstSplitCredentialVerifier(activate, salt);
      if (runtime.login && !timingSafeEqual(Buffer.from(verifier), Buffer.from(runtime.verifier))) {
        return fail('The runtime credential differs from the owned cutover.');
      }
      if (!runtime.login) {
        try {
          await client.query(`ALTER ROLE ${quoteIdentifier(firstSplitRoles.runtime)} LOGIN PASSWORD '${verifier}'`);
        } catch {
          return fail('PostgreSQL refused the protected runtime credential.');
        }
      }
      const { rows: [stored] } = await client.query(`
        SELECT rolcanlogin AS login, rolpassword AS verifier FROM pg_authid WHERE rolname = $1
      `, [firstSplitRoles.runtime]);
      if (!stored?.login || stored.verifier !== verifier) return fail('The runtime login did not match the cutover result.');
      verifierSha256 = sha256(verifier);
    }
    await assertMarker();
    const receipt = { action: input.action, grants: result.grants, ...ownership, ...(verifierSha256 ? { verifierSha256 } : {}) };
    const write = await client.query(`
      UPDATE public.deployment_operations
      SET "reportJson" = COALESCE("reportJson", '{}'::jsonb) || jsonb_build_object('firstRoleCutoverAcl', $2::jsonb)
      WHERE id = $1 AND "leaseExpiresAt" > clock_timestamp() AT TIME ZONE 'UTC'
      RETURNING id
    `, [session.deploymentId, JSON.stringify(receipt)]);
    if (write.rows.length !== 1) return fail('The first-split lease expired before recording the ACL transition.');
    return { ...result, receipt };
  });
  if (input.credential) {
    await assertMarker();
    await proveFirstSplitCredential(input.databaseUrl, input.credential);
    await assertMarker();
  }
  return transition;
}

/** Capture a data-consistent ACL catalog while the caller dumps the exported snapshot. */
export function captureProtectedDatabaseRoles(databaseUrl: string, roles: RoleSplit, dump: (snapshotId: string) => Promise<void>) {
  return withTransaction(databaseUrl, 'READ ONLY', async client => {
    const identity = await readIdentity(client, roles);
    if (identity.connectionLimit !== -1) fail('The source database has a custom connection limit.');
    const catalog = await readCatalog(client);
    assertRestrictedAccess(catalog, roles);
    const objects = canonicalObjects(catalog, identity.control, roles);
    const { rows: [{ snapshot }] } = await client.query('SELECT pg_export_snapshot() AS snapshot');
    await dump(snapshot);
    return { version: 1, sourceDatabase: identity.database, control: identity.control, roles: identity.roles, objects } satisfies RoleSnapshot;
  });
}

const stageName = /^sabalan_(restore|checkpoint_verify)_[a-f0-9]{12}$/;

/** Construct statements only from validated ACL enums and the staged PostgreSQL catalog. */
export function applyProtectedDatabaseRoles(databaseUrl: string, roles: RoleSplit, snapshot: RoleSnapshot, expectedSource: string) {
  return withTransaction(databaseUrl, 'READ WRITE', async client => {
    const identity = await readIdentity(client, roles);
    if (snapshot?.version !== 1 || snapshot.sourceDatabase !== expectedSource
      || snapshot.sourceDatabase === identity.database || snapshot.control !== identity.control
      || !stageName.test(identity.database) || identity.connectionLimit !== 0
      || JSON.stringify(snapshot.roles) !== JSON.stringify(identity.roles)) {
      fail('The staged database does not match the protected role snapshot identity.');
    }
    const desired = canonicalObjects(snapshot.objects, identity.control, roles);
    const catalog = await readCatalog(client);
    const current = canonicalObjects(catalog, identity.control, roles);
    if (desired.length !== current.length) fail('The staged catalog differs from the protected database object set.');
    const statements: string[] = [];
    for (const [index, restored] of catalog.entries()) {
      const captured = desired[index];
      if (objectIdentity(captured) !== objectIdentity(restored) || captured.owner !== restored.owner
        || captured.securityDefiner !== restored.securityDefiner) {
        fail('The staged database object identity or ownership differs from the checkpoint.');
      }
      if (JSON.stringify(captured.grants) === JSON.stringify(current[index].grants)) continue;
      const target = `${restored.kind} ${restored.target}`;
      const recipients = new Set([...captured.grants, ...current[index].grants].map(grant => grant.grantee));
      const granteeSql = (grantee: string) => grantee ? quoteIdentifier(grantee) : 'PUBLIC';
      for (const recipient of recipients) statements.push(`REVOKE ALL PRIVILEGES ON ${target} FROM ${granteeSql(recipient)}`);
      for (const grant of captured.grants) statements.push(`GRANT ${grant.privilege} ON ${target} TO ${granteeSql(grant.grantee)}`);
    }
    assertRestrictedAccess(catalog.map((object, index) => ({ ...object, grants: desired[index].grants })), roles);
    if (statements.length) await client.query(statements.join(';\n'));
    const verified = await readCatalog(client);
    if (JSON.stringify(canonicalObjects(verified, identity.control, roles)) !== JSON.stringify(desired)) {
      fail('Staged role and object privileges did not verify against the checkpoint.');
    }
    assertRestrictedAccess(verified, roles);
  });
}

/** Verify the promoted database without modifying roles, ownership or grants. */
export function verifyPromotedProtectedDatabaseRoles(databaseUrl: string, roles: RoleSplit, snapshot: RoleSnapshot, expectedSource: string) {
  return withTransaction(databaseUrl, 'READ ONLY', async client => {
    const identity = await readIdentity(client, roles);
    if (snapshot?.version !== 1 || snapshot.sourceDatabase !== expectedSource || snapshot.control !== identity.control
      || identity.connectionLimit !== -1 || JSON.stringify(snapshot.roles) !== JSON.stringify(identity.roles)) {
      fail('The promoted role checkpoint identity differs from the archive.');
    }
    const catalog = await readCatalog(client);
    assertRestrictedAccess(catalog, roles);
    if (JSON.stringify(canonicalObjects(catalog, identity.control, roles))
      !== JSON.stringify(canonicalObjects(snapshot.objects, identity.control, roles))) {
      fail('The promoted ACLs differ from the protected checkpoint.');
    }
  });
}

/** Switch both database names and connection limits in one PostgreSQL transaction. */
export async function promoteProtectedDatabaseStage(databaseUrl: string, staged: string, safety: string) {
  const configured = new URL(databaseUrl);
  const current = decodeURIComponent(configured.pathname.slice(1));
  if (!/^sabalan_restore_[a-f0-9]{12}$/.test(staged) || !/^sabalan_safety_[a-f0-9]{12}$/.test(safety)
    || !current || current === 'postgres' || [staged, safety].includes(current)) {
    return fail('Protected database promotion requires the designated stage and safety databases.');
  }
  configured.pathname = '/postgres';
  await withTransaction(configured.toString(), 'READ WRITE', async client => {
    const { rows: [ownership] } = await client.query(`
      SELECT count(*) = 2 AS admitted FROM pg_database d JOIN pg_roles r ON d.datdba = r.oid
      WHERE r.rolname = session_user AND current_user = session_user AND r.rolsuper AND r.rolcanlogin
      AND (d.datname = $1 OR (d.datname = $2 AND d.datconnlimit = 0))
    `, [current, staged]);
    if (!ownership.admitted) fail('The protected owner or private staged database changed before promotion.');
    const liveName = quoteIdentifier(current);
    const stagedName = quoteIdentifier(staged);
    const safetyName = quoteIdentifier(safety);
    await client.query(`
      ALTER DATABASE ${liveName} RENAME TO ${safetyName};
      ALTER DATABASE ${safetyName} CONNECTION LIMIT 0;
      ALTER DATABASE ${stagedName} RENAME TO ${liveName};
      ALTER DATABASE ${liveName} CONNECTION LIMIT -1
    `);
  });
}

export function configuredProtectedDatabaseRoleRecovery(env: NodeJS.ProcessEnv = process.env) {
  const runtime = env.DEPLOYMENT_CHECKPOINT_RUNTIME_USER;
  if (!runtime) return undefined;
  if (env.BACKEND_RUNTIME_ROLE !== 'control' || !env.DATABASE_URL) {
    return fail('A protected control-plane database session is required for role recovery.');
  }
  const control = nativePostgresCliConnection(env.DATABASE_URL);
  const parsed = new URL(control.url);
  const controlName = decodeURIComponent(parsed.username);
  if (runtime === controlName) {
    if (runtime === 'sabalan_application_runtime') return fail('The deployment credential is configured as the runtime identity.');
    return undefined;
  }
  if (runtime !== 'sabalan_application_runtime') return fail('Unsupported protected database runtime identity.');
  return { roles: { runtime, controller: 'sabalan_allocation_controller' }, source: decodeURIComponent(parsed.pathname.slice(1)) };
}

export type ProtectedDatabaseRoleRecovery = NonNullable<ReturnType<typeof configuredProtectedDatabaseRoleRecovery>>;

export async function assertProtectedRoleCheckpointBoundary(input: {
  prisma: PrismaClient;
  coordinationDir: string;
  id: string;
  phase: 'SERVICES_DRAINED' | 'ROLLBACK_STARTED' | 'MUTATION_STARTED';
  checksum?: string;
}) {
  const { id, phase, checksum } = input;
  const token = process.env.DEPLOYMENT_LEASE_TOKEN;
  const sessionPath = path.join(process.env.DEPLOYMENT_REPORT_DIR || '/app/deployment-reports', 'active-deployment-session.json');
  const session = JSON.parse(await fs.readFile(sessionPath, 'utf8'));
  const maintenance = await readDeploymentMaintenance(input.coordinationDir);
  if (!token || process.env.DEPLOYMENT_ID !== id || session.deploymentId !== id
    || session.leaseToken !== token || session.phase !== phase || maintenance?.deploymentId !== id
    || maintenance.releaseId !== session.releaseId
    || (phase !== 'SERVICES_DRAINED' && !/^[a-f0-9]{64}$/.test(checksum || ''))) {
    return fail('The protected role checkpoint requires the owned maintenance session and deployment lease.');
  }
  const active = await input.prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM public.deployment_operations
    WHERE "activeKey" = 'production' AND id = ${id} AND "releaseId" = ${session.releaseId}
      AND "leaseToken" = ${token} AND phase = ${phase} AND "leaseExpiresAt" > clock_timestamp() AT TIME ZONE 'UTC'
      AND (${checksum ?? null}::text IS NULL OR (
        "checkpointJson"->>'checksum' = ${checksum ?? null}
        AND "checkpointJson"->>'localVerified' = 'true' AND "checkpointJson"->>'remoteVerified' = 'true'
      ))
  `;
  if (active.length !== 1) fail('The owned deployment lease or verified role checkpoint is no longer active.');
}
