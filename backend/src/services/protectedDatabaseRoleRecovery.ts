import { createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { checkpointMetadataTransport, readCanonicalCheckpointMetadata } from './deploymentCheckpointMetadataIdentity';
import { assertRemoteCheckpointFingerprint } from './deploymentCheckpointStorage';
import { validateDeploymentHostJournal } from './deploymentHostJournal';
import { readDeploymentMaintenance } from './deploymentMaintenance';
import { nativePostgresCliConnection } from './nativePostgresCli';
import { sha256File } from './recoveryCrypto';

type RoleSplit = { runtime: string; controller: string };
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
type CatalogAcl = ObjectAcl & { target: string; oid: string };
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
      format('%I', datname) AS target, datdba AS owner, 'd'::"char" AS code, datacl AS acl, false AS security_definer, oid
    FROM pg_database WHERE datname = current_database()
    UNION ALL
    SELECT 'SCHEMA', nspname, '', format('%I', nspname), nspowner, 'n', nspacl, false, oid
    FROM pg_namespace WHERE nspname = 'public'
    UNION ALL
    SELECT CASE WHEN c.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
      c.relname, '', format('%I.%I', 'public', c.relname), c.relowner,
      CASE WHEN c.relkind = 'S' THEN 's'::"char" ELSE 'r'::"char" END, c.relacl, false, c.oid
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
    UNION ALL
    SELECT CASE WHEN p.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
      p.proname, oidvectortypes(p.proargtypes), format('%I.%I(%s)', 'public', p.proname, oidvectortypes(p.proargtypes)),
      p.proowner, 'f', p.proacl, p.prosecdef, p.oid
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  )
  SELECT kind, name, arguments, target, oid::text, pg_get_userbyid(owner) AS owner, security_definer AS "securityDefiner",
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
    SELECT r.oid::text, r.rolname AS name, r.rolcanlogin AS login, r.rolconnlimit AS "connectionLimit", r.rolvaliduntil::text AS "validUntil",
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
  const roleOids = roleAttributes.map(({ name }) => attributes.find(role => role.name === name)!.oid as string);
  return { database: identity.database as string, control: identity.control as string, connectionLimit: identity.connectionLimit as number, roles: roleAttributes, roleOids };
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
  views: { name: string; definitionSha256: string; relationOptions: string[] }[];
  protectedSequences: string[];
  definerRoutines: CutoverRoutine[];
  invokerRoutinesSha256: string;
};
const cutoverRoles = { runtime: 'sabalan_application_runtime', controller: 'sabalan_allocation_controller' };
const sha256 = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');
const cutoverCatalogSha256 = '88d1a3381641dbae0c3223f3c343eb43b23730cde98519cd8923c8361851cbfa';

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

async function verifyCutoverViews(client: Client, views: CutoverCatalog['views']) {
  const approved = new Map(views.map(view => [view.name, view]));
  const { rows } = await client.query(`
    SELECT c.relname AS name, pg_get_viewdef(c.oid, false) AS definition,
      COALESCE(c.reloptions, '{}'::text[]) AS "relationOptions",
      ARRAY(SELECT a.attname || ':' || format_type(a.atttypid, a.atttypmod)
        FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY a.attnum) AS "columnTypes"
    FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v'
  `);
  if (approved.size !== views.length || rows.length !== views.length || rows.some(row => {
    const view = approved.get(row.name);
    return !view || row.name !== 'partner_release_readiness_completed'
      || JSON.stringify(row.columnTypes) !== '["id:text"]'
      || sha256(row.definition.replace(/\r\n/g, '\n')) !== view.definitionSha256
      || JSON.stringify(row.relationOptions.sort()) !== JSON.stringify(view.relationOptions);
  })) fail('A view differs from the reviewed cutover inventory.');
  return approved;
}

type CutoverSource = { databaseUrl: string; migrationsDirectory: string; catalogFile: string };
type CutoverStage = 'before-grants' | 'grants-staged';
type CutoverGrant = { recipient: string; privilege: string };

async function readCutoverManifest(file: string) {
  const bytes = await fs.readFile(file);
  if (sha256(bytes) !== cutoverCatalogSha256) fail('The pinned predecessor cutover catalog changed.');
  return JSON.parse(bytes.toString('utf8')) as CutoverCatalog;
}

async function inspectCutover(client: Client, directory: string, manifest: CutoverCatalog, runtimeLogin = false) {
  const identity = await readIdentity(client, cutoverRoles, runtimeLogin);
  if (identity.roles.some(role => role.name === cutoverRoles.controller && role.login)) {
    fail('The allocation controller must remain dormant throughout the role cutover.');
  }
  const migrations = await verifyCutoverMigrationLedger(client, directory, manifest.migrationSha256);
  const catalog = await readCatalog(client);
  const objects = canonicalObjects(catalog, identity.control, cutoverRoles);
  const { rows: [state] } = await client.query(`
    SELECT
      (SELECT count(*) = 1 AND bool_and(id = 'grouped-allocation' AND state = 'CLOSED')
        FROM public.customer_allocation_release_control) AS closed,
      NOT EXISTS (SELECT FROM pg_class WHERE relnamespace = 'public'::regnamespace
        AND relkind IN ('p', 'f', 'm')) AS relations
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

  const views = await verifyCutoverViews(client, manifest.views);
  const viewCount = views.size;
  const tableCount = tables.size;
  const sequenceCount = sequences.size;
  const invokers: string[] = [];
  const profiles: { before: CutoverGrant[]; staged: CutoverGrant[] }[] = [];
  for (const object of objects) {
    const before: CutoverGrant[] = [];
    const staged: CutoverGrant[] = [];
    const addGrants = (profile: CutoverGrant[], recipient: string, ...verbs: string[]) =>
      profile.push(...verbs.map(privilege => ({ recipient, privilege })));
    switch (object.kind) {
      case 'DATABASE':
        addGrants(staged, cutoverRoles.runtime, 'CONNECT');
        addGrants(staged, cutoverRoles.controller, 'CONNECT');
        addGrants(before, '', 'CONNECT', 'TEMPORARY');
        break;
      case 'SCHEMA':
        addGrants(staged, cutoverRoles.runtime, 'USAGE');
        addGrants(staged, cutoverRoles.controller, 'USAGE');
        addGrants(before, '', 'USAGE');
        break;
      case 'TABLE': {
        if (views.delete(object.name)) {
          addGrants(before, cutoverRoles.runtime, 'SELECT');
          addGrants(staged, cutoverRoles.runtime, 'SELECT');
          break;
        }
        const verbs = tables.get(object.name) ?? fail(`Unexpected cutover table: ${object.name}`);
        addGrants(staged, cutoverRoles.runtime, ...verbs);
        tables.delete(object.name);
        break;
      }
      case 'SEQUENCE':
        if (!sequences.delete(object.name)) fail(`Unexpected cutover sequence: ${object.name}`);
        if (manifest.sequences.includes(object.name)) addGrants(staged, cutoverRoles.runtime, 'USAGE');
        break;
      case 'FUNCTION': {
        const key = routineKey(object.name, object.arguments);
        if (object.securityDefiner) {
          const executor = approvedExecutors[key];
          if (executor === 'runtime' || executor === 'controller') {
            addGrants(before, cutoverRoles[executor], 'EXECUTE');
            addGrants(staged, cutoverRoles[executor], 'EXECUTE');
          }
        } else {
          invokers.push(key);
          addGrants(before, '', 'EXECUTE');
          addGrants(staged, '', 'EXECUTE');
        }
        break;
      }
      default:
        fail(`Unexpected cutover object kind: ${object.kind}`);
    }
    profiles.push({ before, staged });
  }
  if (tables.size || views.size || sequences.size || sha256(JSON.stringify(invokers.sort())) !== manifest.invokerRoutinesSha256) {
    fail('The cutover object identities differ from the reviewed inventory.');
  }
  const summary = {
    catalogSha256: cutoverCatalogSha256,
    migrationSha256: manifest.migrationSha256,
    migrations,
    tables: tableCount,
    views: viewCount,
    sequences: sequenceCount,
    securityDefinerRoutines: routineDefinitions.length,
  };
  return { identity, catalog, objects, profiles, summary };
}

const grantKey = (grant: CutoverGrant) => `${grant.recipient}:${grant.privilege}`;

function assertCutoverProfile(cutover: Awaited<ReturnType<typeof inspectCutover>>, stage: CutoverStage) {
  for (const [index, object] of cutover.objects.entries()) {
    const profile = cutover.profiles[index];
    const expected = (stage === 'grants-staged' ? profile.staged : profile.before).map(grantKey).sort();
    const actual = object.grants.filter(grant => grant.grantee !== object.owner)
      .map(grant => grantKey({ recipient: grant.grantee, privilege: grant.privilege })).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail(`Cutover privilege drift on ${object.kind} ${object.name || '(current database)'}.`);
    }
  }
}

/** Read-only admission for the first split, before the runtime receives a credential. */
export async function verifyPredecessorRoleCutover(input: CutoverSource & { stage: CutoverStage }) {
  if (input.stage !== 'before-grants' && input.stage !== 'grants-staged') fail('Unknown cutover verification stage.');
  const manifest = await readCutoverManifest(input.catalogFile);
  return withTransaction(input.databaseUrl, 'READ ONLY', async client => {
    const cutover = await inspectCutover(client, input.migrationsDirectory, manifest);
    assertCutoverProfile(cutover, input.stage);
    return { stage: input.stage, ...cutover.summary };
  });
}

export const protectedPredecessorRoleCutoverPurpose = 'predecessor-role-cutover';

type CutoverSession = {
  deploymentId: string; releaseId: string; targetCommit: string; owner: string; controlImage: string;
  leaseToken: string; phase: string; bootstrap: boolean; purpose?: string;
  rollbackReleaseSet?: Record<string, string>; preservedClamav?: { selection: { image: string } };
};

const receiptFormat = 'sabalan-predecessor-role-acl-cutover-v1';
const hexSha = /^[a-f0-9]{64}$/;

async function holdPredecessorRoleCutover(journalPath: string, identity: {
  deploymentId: string; releaseId: string; checkpointMetadataSha256: string; controlImage: string;
}) {
  const directory = path.dirname(journalPath);
  const file = path.join(directory, 'predecessor-role-cutover-active.json');
  const raw = JSON.stringify({
    format: 'sabalan-predecessor-role-cutover-hold/v1',
    deploymentId: identity.deploymentId, releaseId: identity.releaseId,
    checkpointMetadataSha256: identity.checkpointMetadataSha256, controlImage: identity.controlImage,
  }) + '\n';
  try {
    const handle = await fs.open(file, 'wx', 0o600);
    try {
      await handle.writeFile(raw);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (process.platform === 'linux') {
      const parent = await fs.open(directory, 'r');
      try { await parent.sync(); } finally { await parent.close(); }
    }
  } catch (error: any) {
    if (error?.code !== 'EEXIST') throw error;
    const state = await fs.lstat(file);
    if (!state.isFile() || state.nlink !== 1 || state.size !== Buffer.byteLength(raw)
      || (process.platform === 'linux' && (state.uid !== process.getuid?.() || (state.mode & 0o077)))
      || await fs.readFile(file, 'utf8') !== raw) fail('The owned predecessor role cutover hold differs.');
  }
}

// PostgreSQL's checkpoint row binds the durable archive identity and verification flags.
// Prisma can round fractional JSON observations such as mtimeMs. The canonical sidecars
// preserve those observations, and the stage command rechecks them against the remote file.
function cutoverCheckpointBinding(metadata: Record<string, unknown>) {
  const keys = ['captureMethod', 'id', 'deploymentId', 'releaseId', 'targetCommit', 'sourceDatabase',
    'createdAt', 'checksum', 'size', 'archivePath', 'localPath', 'remotePath',
    'localVerified', 'remoteVerified', 'localRestoreVerified', 'manifestReadable'];
  return checkpointMetadataTransport(Object.fromEntries(keys.map(key => [key, metadata[key]]))).canonicalMetadataSha256;
}

function cutoverCatalogFingerprint(cutover: Awaited<ReturnType<typeof inspectCutover>>, objects = cutover.objects) {
  const identity = {
    ...cutover.identity,
    roles: cutover.identity.roles.map(role => role.name === cutoverRoles.runtime ? { ...role, login: false } : role),
  };
  return sha256(JSON.stringify({ identity, objects, oids: cutover.catalog.map(object => object.oid) }));
}

async function applyCutoverAclDelta(client: Client, cutover: Awaited<ReturnType<typeof inspectCutover>>, restoring: boolean) {
  const statements: string[] = [];
  for (const [index, object] of cutover.catalog.entries()) {
    const { before, staged } = cutover.profiles[index];
    const [from, to] = restoring ? [staged, before] : [before, staged];
    const difference = (left: CutoverGrant[], right: CutoverGrant[]) =>
      left.filter(grant => !right.some(other => grantKey(grant) === grantKey(other)));
    const grantee = (grant: CutoverGrant) => grant.recipient ? quoteIdentifier(grant.recipient) : 'PUBLIC';
    const target = `${object.kind} ${object.target}`;
    for (const grant of difference(from, to)) {
      statements.push(`REVOKE ${grant.privilege} ON ${target} FROM ${grantee(grant)} RESTRICT`);
    }
    for (const grant of difference(to, from)) {
      statements.push(`GRANT ${grant.privilege} ON ${target} TO ${grantee(grant)}`);
    }
  }
  if (!statements.length) fail('The cutover manifest contains no ACL transition.');
  await client.query(statements.join(';\n'));
}

async function assertDatabaseDrained(client: Client) {
  await client.query('SELECT pg_stat_clear_snapshot()');
  const { rows: [state] } = await client.query(`
    SELECT NOT EXISTS (SELECT FROM pg_stat_activity WHERE (datname = current_database() OR usename = $1)
      AND backend_type = 'client backend' AND pid <> pg_backend_pid())
      AND NOT EXISTS (SELECT FROM pg_prepared_xacts WHERE database = current_database()) AS drained
  `, [cutoverRoles.runtime]);
  if (!state.drained) fail('The cutover requires the source database to remain drained.');
}

function runtimeCredentialVerifier(password: Buffer, salt: Buffer) {
  const salted = pbkdf2Sync(password, salt, 4096, 32, 'sha256');
  try {
    const client = createHmac('sha256', salted).update('Client Key').digest();
    const stored = createHash('sha256').update(client).digest('base64');
    client.fill(0);
    const server = createHmac('sha256', salted).update('Server Key').digest('base64');
    return 'SCRAM-SHA-256$4096:' + salt.toString('base64') + '$' + stored + ':' + server;
  } finally {
    salted.fill(0);
  }
}

async function readOwnedRuntimeVerifier(client: Client, expectedSha256: string) {
  const { rows: [row] } = await client.query('SELECT rolpassword AS verifier FROM pg_authid WHERE rolname = $1', [cutoverRoles.runtime]);
  const verifier: string | undefined = row?.verifier;
  if (!verifier || !/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$/.test(verifier)
    || sha256(verifier) !== expectedSha256) fail('The active runtime credential differs from the owned cutover receipt.');
  return verifier!;
}

/** Authenticate with PostgreSQL itself after the LOGIN transaction commits. */
async function proveRuntimeCredential(databaseUrl: string, password: Buffer) {
  const url = new URL(nativePostgresCliConnection(databaseUrl).url);
  url.username = cutoverRoles.runtime;
  url.searchParams.set('application_name', 'sabalan-predecessor-role-auth-proof');
  url.password = randomBytes(32).toString('base64url');
  try {
    await withTransaction(url.toString(), 'READ ONLY', async () => {});
    fail('The source database accepted an unowned runtime credential.');
  } catch (error: unknown) {
    if ((error as { code?: string }).code !== '28P01') throw error;
  }
  url.password = password.toString('ascii');
  await withTransaction(url.toString(), 'READ ONLY', async client => {
    const { rows: [proof] } = await client.query(`
      SELECT session_user = $1 AND current_user = session_user
        AND NOT has_table_privilege('public._prisma_migrations', 'SELECT')
        AND NOT has_table_privilege('public.deployment_operations', 'SELECT')
        AND NOT has_table_privilege('public.customer_allocation_release_control', 'SELECT')
        AND NOT has_database_privilege(current_database(), 'CREATE') AS admitted
    `, [cutoverRoles.runtime]);
    if (!proof?.admitted) fail('The authenticated runtime credential did not prove the source database boundary.');
  });
}

/** Own the lease row and ACLs in one transaction. A failed or unacknowledged commit can be resolved by rerunning the command. */
export async function changeProtectedPredecessorRoleGrants(input: CutoverSource & {
  action: 'stage' | 'restore' | 'activate'; credential?: { password: Buffer; stagedAclSha256: string }; session: CutoverSession; coordinationDir: string; journalPath: string;
  deploymentId: string; leaseToken: string; controlImage: string; remoteRoot?: string;
}) {
  const restoring = input.action === 'restore';
  const activating = input.action === 'activate';
  const credential = input.credential;
  if (activating !== Boolean(credential) || (credential && (!hexSha.test(credential.stagedAclSha256)
    || !/^[A-Za-z0-9_-]{43}$/.test(credential.password.toString('latin1'))
    || Buffer.from(credential.password.toString('latin1'), 'base64url').toString('base64url') !== credential.password.toString('latin1')
    || credential.password.toString('latin1') === nativePostgresCliConnection(input.databaseUrl).environment.PGPASSWORD))) {
    fail('The runtime credential frame is invalid.');
  }
  const phase = restoring ? 'ROLLBACK_STARTED' : 'MUTATION_STARTED';
  const session = input.session;
  const assertMarker = async () => {
    const marker = await readDeploymentMaintenance(input.coordinationDir);
    if (marker?.deploymentId !== session.deploymentId || marker?.releaseId !== session.releaseId) {
      fail('The first role cutover requires the owned maintenance marker.');
    }
  };
  if (session.purpose !== protectedPredecessorRoleCutoverPurpose || session.bootstrap || session.phase !== phase
    || session.deploymentId !== input.deploymentId || session.leaseToken !== input.leaseToken
    || !hexSha.test(input.leaseToken) || session.controlImage !== input.controlImage
    || !/^sha256:[a-f0-9]{64}$/.test(input.controlImage) || !/^[a-f0-9]{40}$/.test(session.targetCommit)) {
    fail('The first role cutover requires its owned maintenance session, phase and immutable control image.');
  }
  await assertMarker();
  const journal = await validateDeploymentHostJournal(input.journalPath);
  const sequence = ['SERVICES_DRAINED', 'LOCAL_CHECKPOINT_VERIFIED', 'REMOTE_CHECKPOINT_VERIFIED', 'MUTATION_STARTED'];
  if (restoring) sequence.push('ROLLBACK_STARTED');
  if (journal.some(entry => entry.deploymentId !== session.deploymentId)) fail('The cutover journal belongs to another deployment.');
  const markerIndex = journal.findIndex(entry => entry.event === 'maintenance-activated');
  const journalPhases = journal.slice(markerIndex + 1)
    .filter(entry => entry.event === 'phase-transition' && sequence.includes(entry.phase)).map(entry => entry.phase);
  if (markerIndex === -1 || JSON.stringify(journalPhases) !== JSON.stringify(sequence)) {
    fail('The cutover journal does not prove drain and checkpoint verification.');
  }

  const sidecarPath = path.join(input.coordinationDir, 'deployment-checkpoint.json');
  const { metadata, sha256: metadataSha256 } = readCanonicalCheckpointMetadata(JSON.parse(await fs.readFile(sidecarPath, 'utf8')));
  if (metadata.id !== session.deploymentId || metadata.deploymentId !== session.deploymentId
    || metadata.releaseId !== session.releaseId || metadata.targetCommit !== session.targetCommit
    || metadata.captureMethod !== 'PROTECTED_MAINTENANCE_COMPLETE' || metadata.localVerified !== true
    || metadata.remoteVerified !== true || metadata.localRestoreVerified !== true || metadata.manifestReadable !== true
    || typeof metadata.remotePath !== 'string' || !path.isAbsolute(metadata.remotePath)
    || !metadata.remoteFingerprint || metadata.remoteFingerprint.size !== metadata.size
    || !Number.isFinite(metadata.remoteFingerprint.mtimeMs) || !hexSha.test(metadata.checksum || '')
    || typeof metadata.localPath !== 'string' || !path.isAbsolute(metadata.localPath)) {
    fail('The cutover requires its exact locally and remotely verified checkpoint.');
  }
  const archive = await fs.lstat(metadata.localPath);
  if (!archive.isFile() || archive.size !== metadata.size || await sha256File(metadata.localPath) !== metadata.checksum) {
    fail('The locally verified cutover checkpoint bytes changed.');
  }
  if (!restoring) {
    if (!input.remoteRoot || !path.isAbsolute(input.remoteRoot)
      || !path.resolve(metadata.remotePath).startsWith(`${path.resolve(input.remoteRoot)}${path.sep}`)) {
      fail('The verified cutover checkpoint is outside the configured remote mount.');
    }
    await assertRemoteCheckpointFingerprint(metadata.remotePath, metadata.remoteFingerprint);
    const remote = readCanonicalCheckpointMetadata(JSON.parse(await fs.readFile(`${metadata.remotePath}.json`, 'utf8')));
    if (remote.sha256 !== metadataSha256) fail('The verified remote cutover checkpoint metadata changed.');
  }
  const manifest = await readCutoverManifest(input.catalogFile);
  const checkpointBinding = cutoverCheckpointBinding(metadata);
  const receipt = await withTransaction(input.databaseUrl, 'READ WRITE', async client => {
    await client.query("SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '30s'");
    const liveLease = async (lock = false) => {
      const { rows } = await client.query(`
        SELECT "checkpointJson" AS checkpoint, "reportJson" AS report
        FROM public.deployment_operations
        WHERE "activeKey" = 'production' AND id = $1 AND "releaseId" = $2 AND "targetCommit" = $3
          AND owner = $4 AND phase = $5 AND "leaseToken" = $6 AND "leaseExpiresAt" > clock_timestamp() AT TIME ZONE 'UTC'
        ${lock ? 'FOR UPDATE' : ''}
      `, [session.deploymentId, session.releaseId, session.targetCommit, session.owner, phase, session.leaseToken]);
      if (rows.length !== 1 || !rows[0].checkpoint
        || cutoverCheckpointBinding(rows[0].checkpoint) !== checkpointBinding) {
        fail('The cutover deployment lease or verified checkpoint has changed.');
      }
      return rows[0].report;
    };
    const report = await liveLease(true);
    const { rows } = await client.query(`
      SELECT current_database() AS name, (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS oid,
        (SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier"
    `);
    const source = metadata.sourceDatabase;
    if (!source || rows.length !== 1 || rows[0].name !== source.name || rows[0].oid !== source.oid
      || rows[0].systemIdentifier !== source.systemIdentifier) fail('The cutover database differs from the checkpoint source.');
    await assertDatabaseDrained(client);
    const runtimeLogin = report?.state === 'staged' && hexSha.test(report.loginVerifierSha256 || '');
    const cutover = await inspectCutover(client, input.migrationsDirectory, manifest, runtimeLogin);
    if (cutover.identity.connectionLimit !== -1) fail('The cutover database has a custom connection limit.');
    const binding = {
      format: receiptFormat, deploymentId: session.deploymentId, releaseId: session.releaseId, controlImage: session.controlImage,
      checkpointSha256: metadata.checksum as string, checkpointMetadataSha256: metadataSha256,
      sourceDatabase: { name: source.name as string, oid: source.oid as string, systemIdentifier: source.systemIdentifier as string },
      ...cutover.summary,
    };
    const current = cutoverCatalogFingerprint(cutover);
    if (report !== null && (!report?.binding || checkpointMetadataTransport(report.binding).canonicalMetadataSha256
      !== checkpointMetadataTransport(binding).canonicalMetadataSha256 || !hexSha.test(report.before || '') || !hexSha.test(report.staged || '')
      || (report.state !== 'staged' && report.state !== 'restored')
      || (report.loginVerifierSha256 !== undefined && !runtimeLogin))) {
      fail('The owned cutover ACL receipt is invalid.');
    }
    if (restoring && !report) fail('No owned staged ACL preimage is available for restoration.');
    if (!restoring && report?.state === 'restored') fail('The owned operation has already restored its ACL preimage.');
    const currentStage = report?.state === 'staged' ? 'grants-staged' : 'before-grants';
    assertCutoverProfile(cutover, currentStage);
    if (report && current !== (currentStage === 'grants-staged' ? report.staged : report.before)) {
      fail('The live ACLs differ from the owned cutover receipt.');
    }
    if (activating && (!credential || !report || report.state !== 'staged' || credential.stagedAclSha256 !== report.staged)) {
      fail('Runtime activation requires the exact owned staged ACL receipt.');
    }
    if (activating) {
      const graph = session.rollbackReleaseSet;
      const names = ['backend', 'frontend', 'inquiry', 'nginx', 'postgres', 'clamav'];
      if (!graph || Object.keys(graph).length !== names.length || graph.backend !== session.controlImage
        || session.preservedClamav?.selection.image !== graph.clamav
        || names.some(name => !/^sha256:[a-f0-9]{64}$/.test(graph[name] || '') || graph[name] !== metadata.rollbackReleaseSet?.[name])
        || Object.keys(metadata.rollbackReleaseSet || {}).length !== names.length) {
        fail('Runtime activation requires the checkpointed immutable six-image graph and preserved scanner.');
      }
    }
    if (!restoring && !activating && runtimeLogin) fail('The owned cutover runtime is no longer dormant.');
    await holdPredecessorRoleCutover(input.journalPath, binding);
    const verifier = runtimeLogin ? await readOwnedRuntimeVerifier(client, report.loginVerifierSha256) : null;
    if (activating && credential) {
      if (verifier) {
        const salt = Buffer.from(verifier.split('$')[1].split(':')[1], 'base64');
        if (!timingSafeEqual(Buffer.from(runtimeCredentialVerifier(credential.password, salt)), Buffer.from(verifier))) {
          fail('The credential does not match the already-owned runtime login.');
        }
      } else {
        const replacement = runtimeCredentialVerifier(credential.password, randomBytes(16));
        await client.query("SET LOCAL log_statement = 'none'; SET LOCAL log_min_error_statement = 'panic'; "
          + "SET LOCAL log_min_duration_statement = '-1'; SET LOCAL log_min_duration_sample = '-1'");
        // PostgreSQL utility statements cannot bind a password parameter. Send
        // only the well-formed SCRAM verifier, never the plaintext password.
        await client.query("ALTER ROLE " + quoteIdentifier(cutoverRoles.runtime) + " LOGIN PASSWORD '" + replacement + "'");
        await readOwnedRuntimeVerifier(client, sha256(replacement));
        await client.query('UPDATE public.deployment_operations SET "reportJson" = $1::jsonb, "updatedAt" = clock_timestamp() AT TIME ZONE \'UTC\' WHERE id = $2',
          [JSON.stringify({ ...report, loginVerifierSha256: sha256(replacement) }), session.deploymentId]);
      }
      await assertDatabaseDrained(client);
      await assertMarker();
      await liveLease();
      return { outcome: verifier ? 'login-already-active' : 'login-activated', ...binding,
        preimageSha256: report.before as string, stagedAclSha256: report.staged as string };
    }
    if (report && (!restoring || report.state === 'restored')) {
      await assertDatabaseDrained(client);
      await assertMarker();
      await liveLease();
      return { outcome: restoring ? 'already-restored' : 'already-staged', ...binding,
        preimageSha256: report.before as string, stagedAclSha256: report.staged as string };
    }
    const expectedObjects = canonicalObjects(cutover.objects.map((object, index) => ({
      ...object,
      grants: [
        ...object.grants.filter(grant => grant.grantee === object.owner),
        ...(restoring ? cutover.profiles[index].before : cutover.profiles[index].staged).map(({ recipient, privilege }) =>
          ({ grantee: recipient, grantor: object.owner, privilege, grantable: false })),
      ],
    })), cutover.identity.control, cutoverRoles);
    const expected = cutoverCatalogFingerprint(cutover, expectedObjects);
    if (restoring && expected !== report.before) fail('The expected ACL rollback differs from the owned cutover preimage.');
    if (restoring && verifier) {
      await client.query('ALTER ROLE ' + quoteIdentifier(cutoverRoles.runtime) + ' NOLOGIN PASSWORD NULL');
    }
    await applyCutoverAclDelta(client, cutover, restoring);
    const verified = await inspectCutover(client, input.migrationsDirectory, manifest);
    assertCutoverProfile(verified, restoring ? 'before-grants' : 'grants-staged');
    const next = cutoverCatalogFingerprint(verified);
    if (next !== expected) fail('The resulting ACLs differ from the expected cutover catalog.');
    await assertDatabaseDrained(client);
    await assertMarker();
    await liveLease();
    const receipt = restoring ? { binding, before: report.before, staged: report.staged, state: 'restored' }
      : { binding, before: current, staged: next, state: 'staged' };
    await client.query('UPDATE public.deployment_operations SET "reportJson" = $1::jsonb, "updatedAt" = clock_timestamp() AT TIME ZONE \'UTC\' WHERE id = $2',
      [JSON.stringify(receipt), session.deploymentId]);
    return { outcome: restoring ? 'restored' : 'staged', ...binding,
      preimageSha256: receipt.before as string, stagedAclSha256: receipt.staged as string };
  });
  if (activating && credential) await proveRuntimeCredential(input.databaseUrl, credential.password);
  return receipt;
}
