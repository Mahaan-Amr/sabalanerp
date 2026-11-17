import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { readDeploymentMaintenance } from './deploymentMaintenance';
import { nativePostgresCliConnection } from './nativePostgresCli';

type RoleSplit = { runtime: string; controller: string };
type Client = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query(sql: string, values?: unknown[]): Promise<{ rows: any[] }>;
};

const { Client } = require('pg') as { Client: new (config: {
  connectionString: string; connectionTimeoutMillis: number;
}) => Client };

export const PROTECTED_DATABASE_ROLE_COMPONENT = 'database/protected-role-acls.json';

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
    SELECT r.rolname AS name, r.rolcanlogin AS login, r.rolconnlimit AS "connectionLimit", r.rolvaliduntil::text AS "validUntil",
      NOT (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolinherit OR r.rolreplication OR r.rolbypassrls)
      AND r.rolconfig IS NULL AND (r.rolcanlogin OR auth.rolpassword IS NULL)
      AND NOT EXISTS (SELECT FROM pg_auth_members WHERE member = r.oid OR roleid = r.oid)
      AND NOT EXISTS (
        SELECT FROM pg_shdepend
        WHERE refclassid = 'pg_authid'::regclass AND refobjid = r.oid AND deptype = 'o'
      )
      AND NOT EXISTS (SELECT FROM pg_db_role_setting WHERE setrole = r.oid) AS restricted
    FROM pg_roles r JOIN pg_authid auth USING (oid) WHERE r.rolname IN ($1, $2)
  `, [roles.runtime, roles.controller]);
  if (attributes.length !== 2 || attributes.some(role => !role.restricted
    || (role.name === 'sabalan_application_runtime' && role.login !== requireRuntimeLogin)
    || (!requireRuntimeLogin && role.login))) {
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

function assertRestrictedAccess(catalog: CatalogAcl[], roles: RoleSplit) {
  const protectedTables = new Set(['_prisma_migrations', 'deployment_operations',
    'customer_allocation_release_control', 'customer_allocation_release_audit']);
  for (const object of catalog) {
    for (const grant of object.grants) {
      const runtimeAccess = [roles.runtime, ''].includes(grant.grantee);
      const controllerAccess = [roles.controller, ''].includes(grant.grantee);
      if (((object.kind === 'DATABASE' || object.kind === 'SCHEMA') && grant.privilege === 'CREATE'
          && (runtimeAccess || controllerAccess))
        || (object.kind === 'TABLE' && protectedTables.has(object.name) && (runtimeAccess || controllerAccess))
        || (object.securityDefiner && (grant.grantee === ''
          || (grant.grantee === roles.runtime && !(object.name === 'customer_allocation_runtime_admitted' && object.arguments === 'text, text'))))) {
        fail('The protected ACLs would expose database control authority to a restricted role.');
      }
    }
  }
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
  phase: 'SERVICES_DRAINED' | 'ROLLBACK_STARTED';
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
    || (phase === 'ROLLBACK_STARTED' && !/^[a-f0-9]{64}$/.test(checksum || ''))) {
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

type CutoverRoutine = {
  name: string;
  arguments: string;
  definitionSha256: string;
  execute: 'controller' | 'runtime' | 'owner';
};
type CutoverCatalog = {
  migrationSha256: string;
  tables: Record<string, string[]>;
  sequences: string[];
  protectedSequences: string[];
  definerRoutines: CutoverRoutine[];
  invokerRoutinesSha256: string;
};
const cutoverRoles = { runtime: 'sabalan_application_runtime', controller: 'sabalan_allocation_controller' };
const sha256 = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');

async function verifyCutoverMigrationLedger(client: Client, directory: string, expectedDigest: string) {
  const names = (await fs.readdir(directory, { withFileTypes: true }))
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  if (!names.length || names.some(name => !/^\d+_[a-zA-Z0-9_]+$/.test(name))) {
    fail('The cutover migration directory is invalid.');
  }
  const checksums = Object.fromEntries(await Promise.all(names.map(async name =>
    [name, sha256(await fs.readFile(path.join(directory, name, 'migration.sql')))] as const)));
  if (sha256(JSON.stringify(checksums)) !== expectedDigest) fail('The cutover source migration digest changed.');
  const { rows } = await client.query(`
    SELECT migration_name AS name, checksum, finished_at IS NOT NULL AS finished
    FROM public._prisma_migrations WHERE rolled_back_at IS NULL
  `);
  if (rows.length !== names.length || new Set(rows.map(row => row.name)).size !== names.length
    || rows.some(row => !row.finished || checksums[row.name] !== row.checksum)) {
    fail('The live migration ledger differs from the cutover source migrations.');
  }
  return names.length;
}

const routineKey = (name: string, argumentTypes: string) => JSON.stringify([name, argumentTypes]);

/** Read-only admission for the first split, before the runtime receives a credential. */
export function verifyPredecessorRoleCutover(input: {
  databaseUrl: string;
  migrationsDirectory: string;
  catalogFile: string;
  stage: 'before-grants' | 'grants-staged';
}) {
  return withTransaction(input.databaseUrl, 'READ ONLY', async client => {
    if (input.stage !== 'before-grants' && input.stage !== 'grants-staged') fail('Unknown cutover verification stage.');
    const { control } = await readIdentity(client, cutoverRoles, false);
    const catalogBytes = await fs.readFile(input.catalogFile);
    const manifest = JSON.parse(catalogBytes.toString('utf8')) as CutoverCatalog;
    const migrations = await verifyCutoverMigrationLedger(client, input.migrationsDirectory, manifest.migrationSha256);
    const objects = canonicalObjects(await readCatalog(client), control, cutoverRoles);
    const { rows: [state] } = await client.query(`
      SELECT
        (SELECT count(*) = 1 AND bool_and(id = 'grouped-allocation' AND state = 'CLOSED')
          FROM public.customer_allocation_release_control) AS closed,
        NOT EXISTS (SELECT FROM pg_class WHERE relnamespace = 'public'::regnamespace
          AND relkind IN ('p', 'f', 'v', 'm')) AS relations
    `);
    if (!state.closed || !state.relations) fail('The cutover requires a closed allocation boundary and the reviewed relation types.');

    const tables = new Map<string, string[]>();
    for (const [profile, names] of Object.entries(manifest.tables)) {
      if (!/^(NONE|SELECT( INSERT)?( UPDATE)?( DELETE)?)$/.test(profile)) fail('Unknown cutover table privilege profile.');
      for (const name of names) {
        if (tables.has(name)) fail('Duplicate cutover table identity.');
        tables.set(name, profile === 'NONE' ? [] : profile.split(' '));
      }
    }
    const protectedTables = ['_prisma_migrations', 'deployment_operations', 'customer_allocation_release_control',
      'customer_allocation_release_audit', 'shipment_statement_migration_evidence',
      'shipment_statement_migration_manifests', 'shipment_statement_migration_runs'];
    if (protectedTables.some(name => tables.get(name)?.length !== 0)) fail('A protected table is outside the cutover denial inventory.');
    if (tables.get('recovery_operations')?.join(' ') !== 'SELECT INSERT UPDATE'
      || tables.get('recovery_audit_events')?.join(' ') !== 'SELECT INSERT') fail('The cutover recovery status or audit permissions changed.');
    const sequences = new Set([...manifest.sequences, ...manifest.protectedSequences]);
    if (manifest.sequences.includes('customer_allocation_release_audit_id_seq') ||
        !manifest.protectedSequences.includes('customer_allocation_release_audit_id_seq')) {
      fail('The allocation audit sequence is outside the cutover denial inventory.');
    }
    const definerRoutines = new Map(manifest.definerRoutines.map(routine =>
      [routineKey(routine.name, routine.arguments), routine]));
    const { rows: routineDefinitions } = await client.query(`
      SELECT proname AS name, oidvectortypes(proargtypes) AS arguments, pg_get_functiondef(oid) AS definition
      FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND prosecdef
    `);
    const approvedExecutors: Record<string, CutoverRoutine['execute']> = {
      [routineKey('customer_allocation_controller_activate', 'text, text, text, text, timestamp with time zone')]: 'controller',
      [routineKey('customer_allocation_controller_close', 'text, text, text, text')]: 'controller',
      [routineKey('customer_allocation_controller_lock', 'text, text')]: 'controller',
      [routineKey('customer_allocation_runtime_admitted', 'text, text')]: 'runtime',
      [routineKey('require_active_grouped_allocation_child', '')]: 'owner',
    };
    if (definerRoutines.size !== Object.keys(approvedExecutors).length || routineDefinitions.length !== definerRoutines.size
      || routineDefinitions.some(row => {
        const key = routineKey(row.name, row.arguments);
        const routine = definerRoutines.get(key);
        return !routine || routine.execute !== approvedExecutors[key]
          || sha256(row.definition.replace(/\r\n/g, '\n')) !== routine.definitionSha256;
      })) fail('A privileged routine differs from the reviewed cutover inventory.');

    const tableCount = tables.size;
    const sequenceCount = sequences.size;
    const invokers: string[] = [];
    const staged = input.stage === 'grants-staged';
    for (const object of objects) {
      const expected: string[] = [];
      const expectGrants = (recipient: string, ...verbs: string[]) =>
        expected.push(...verbs.map(verb => `${recipient}:${verb}`));
      switch (object.kind) {
        case 'DATABASE':
          if (staged) {
            expectGrants(cutoverRoles.runtime, 'CONNECT');
            expectGrants(cutoverRoles.controller, 'CONNECT');
          } else expectGrants('', 'CONNECT', 'TEMPORARY');
          break;
        case 'SCHEMA':
          if (staged) {
            expectGrants(cutoverRoles.runtime, 'USAGE');
            expectGrants(cutoverRoles.controller, 'USAGE');
          } else expectGrants('', 'USAGE');
          break;
        case 'TABLE': {
          const verbs = tables.get(object.name) ?? fail(`Unexpected cutover table: ${object.name}`);
          if (staged) expectGrants(cutoverRoles.runtime, ...verbs);
          tables.delete(object.name);
          break;
        }
        case 'SEQUENCE':
          if (!sequences.delete(object.name)) fail(`Unexpected cutover sequence: ${object.name}`);
          if (staged && manifest.sequences.includes(object.name)) expectGrants(cutoverRoles.runtime, 'USAGE');
          break;
        case 'FUNCTION': {
          const key = routineKey(object.name, object.arguments);
          if (object.securityDefiner) {
            const executor = approvedExecutors[key];
            if (executor === 'runtime' || executor === 'controller') expectGrants(cutoverRoles[executor], 'EXECUTE');
          } else {
            invokers.push(key);
            expectGrants('', 'EXECUTE');
          }
          break;
        }
        default:
          fail(`Unexpected cutover object kind: ${object.kind}`);
      }
      const actual = object.grants.filter(grant => grant.grantee !== object.owner)
        .map(grant => `${grant.grantee}:${grant.privilege}`).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected.sort())) {
        fail(`Cutover privilege drift on ${object.kind} ${object.name || '(current database)'}.`);
      }
    }
    if (tables.size || sequences.size || sha256(JSON.stringify(invokers.sort())) !== manifest.invokerRoutinesSha256) {
      fail('The cutover object identities differ from the reviewed inventory.');
    }
    return {
      stage: input.stage,
      catalogSha256: sha256(catalogBytes),
      migrationSha256: manifest.migrationSha256,
      migrations,
      tables: tableCount,
      sequences: sequenceCount,
      securityDefinerRoutines: routineDefinitions.length,
    };
  });
}
