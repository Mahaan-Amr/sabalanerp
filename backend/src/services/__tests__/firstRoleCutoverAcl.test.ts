import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { changeDormantFirstSplitRuntimeGrants, changeOwnedFirstSplitRuntimeGrants } from '../protectedDatabaseRoleRecovery';

const runtime = 'sabalan_application_runtime';
const control = 'sabalanerp';
const sepidar = 'sabalan_sepidar_opening_controller';
const grant = (grantee: string, privilege: string) => ({ grantee, privilege, grantor: control, grantable: false });
type Receipt = Parameters<typeof changeDormantFirstSplitRuntimeGrants>[1];
type Client = Parameters<typeof changeDormantFirstSplitRuntimeGrants>[0];

function fixture() {
  const table = (name: string): Receipt['objects'][number] =>
    ({ kind: 'TABLE', name, arguments: '', owner: control, securityDefiner: false, grants: [grant(control, 'SELECT')] });
  const routine = (name: string, args: string, executor: string): Receipt['objects'][number] =>
    ({ kind: 'FUNCTION', name, arguments: args, owner: control, securityDefiner: true, grants: [grant(executor, 'EXECUTE')] });
  const legacy: Receipt = {
    format: 'sabalan-role-rehearsal-read-only-prod-catalog/v1',
    migrationCount: 508,
    roleFlags: ['sabalan_allocation_controller', runtime, sepidar]
      .map(name => ({ name, login: false, connectionLimit: -1, validUntil: null })),
    objects: [
      table('accounting_parties'), table('sepidar_customer_opening_admissions'),
      routine('sepidar_customer_opening_lock', 'text, text, text', sepidar),
      routine('sepidar_customer_opening_register_manifest', 'text, text, text, text, text', sepidar),
      routine('sepidar_customer_opening_runtime_admitted',
        'text, text, text, text, text, timestamp with time zone, text, text, text, text, text, text', runtime),
    ],
  };
  const stage = structuredClone(legacy);
  stage.roleFlags[1].login = true;
  stage.objects[0].grants.push(grant(runtime, 'SELECT'), grant(runtime, 'INSERT'));
  let objects = structuredClone(legacy.objects);
  const sql: string[] = [];
  const client: Client = {
    async connect() {},
    async end() {},
    async query(command) {
      if (command.includes('current_user = session_user AND r.rolsuper')) {
        return { rows: [{ database: 'sepidar_qa', control, admitted: true, connectionLimit: -1 }] };
      }
      if (command.includes('WITH sepidar_schema')) {
        return { rows: legacy.roleFlags.map(role => ({ ...role, restricted: true, hasSepidar: true })) };
      }
      if (command.includes('SELECT EXISTS(SELECT FROM pg_default_acl)')) return { rows: [{ present: false }] };
      if (command.includes('WITH objects AS')) {
        return { rows: objects.map(object => ({ ...object, target: `public."${object.name}"` })) };
      }
      sql.push(command);
      if (command.startsWith('GRANT ')) objects = structuredClone(stage.objects);
      else if (command.startsWith('REVOKE ')) objects = structuredClone(legacy.objects);
      else assert.fail('Unexpected database statement');
      return { rows: [] };
    },
  };
  return { client, legacy, stage, sql };
}

test('dormant first-split ACL staging and rollback apply only the rehearsed deltas and can be retried', async () => {
  const { client, legacy, stage, sql } = fixture();
  assert.deepEqual(await changeDormantFirstSplitRuntimeGrants(client, legacy, stage, 'stage'),
    { alreadyApplied: false, grants: 2 });
  assert.deepEqual(await changeDormantFirstSplitRuntimeGrants(client, legacy, stage, 'stage'),
    { alreadyApplied: true, grants: 2 });
  assert.deepEqual(await changeDormantFirstSplitRuntimeGrants(client, legacy, stage, 'restore'),
    { alreadyApplied: false, grants: 2 });
  assert.deepEqual(await changeDormantFirstSplitRuntimeGrants(client, legacy, stage, 'restore'),
    { alreadyApplied: true, grants: 2 });
  assert.deepEqual(sql, [
    'GRANT INSERT ON TABLE public."accounting_parties" TO "sabalan_application_runtime";\nGRANT SELECT ON TABLE public."accounting_parties" TO "sabalan_application_runtime"',
    'REVOKE INSERT ON TABLE public."accounting_parties" FROM "sabalan_application_runtime";\nREVOKE SELECT ON TABLE public."accounting_parties" FROM "sabalan_application_runtime"',
  ]);
});

test('dormant staging refuses drift and access to opening admissions without issuing mutable SQL', async () => {
  const { client, legacy, stage, sql } = fixture();
  stage.objects[1].grants.push(grant(runtime, 'SELECT'));
  await assert.rejects(changeDormantFirstSplitRuntimeGrants(client, legacy, stage, 'stage'),
    { code: 'PROTECTED_DATABASE_ROLE_RECOVERY_REJECTED' });
  stage.objects[1].grants.pop();
  legacy.objects[0].grants.push(grant(runtime, 'DELETE'));
  await assert.rejects(changeDormantFirstSplitRuntimeGrants(client, legacy, stage, 'stage'),
    /first-split ACL preimage differs/);
  assert.deepEqual(sql, []);
});

test('owned staging refuses an ordinary deployment or changed receipts before contacting PostgreSQL', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'first-role-lease-'));
  const { legacy, stage } = fixture();
  const beforeBytes = Buffer.from(JSON.stringify(legacy));
  const stagedBytes = Buffer.from(JSON.stringify(stage));
  const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
  const environment = {
    BACKEND_RUNTIME_ROLE: 'control',
    DEPLOYMENT_ID: 'role-deployment',
    DEPLOYMENT_RELEASE_ID: 'role-release',
    DEPLOYMENT_LEASE_TOKEN: 'a'.repeat(64),
    DEPLOYMENT_CONTROL_IMAGE: 'sha256:' + 'b'.repeat(64),
  };
  const previous = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  const session = {
    deploymentId: environment.DEPLOYMENT_ID,
    releaseId: environment.DEPLOYMENT_RELEASE_ID,
    leaseToken: environment.DEPLOYMENT_LEASE_TOKEN,
    controlImage: environment.DEPLOYMENT_CONTROL_IMAGE,
    targetCommit: 'c'.repeat(40),
    phase: 'MUTATION_STARTED',
    bootstrap: false,
    firstRoleCutover: {
      migrationSha256: 'd'.repeat(64),
      beforeSha256: digest(beforeBytes),
      stagedSha256: digest(stagedBytes),
      beforeEnvironmentSha256: '1'.repeat(64),
      afterEnvironmentSha256: '2'.repeat(64),
    },
  };
  const input = {
    action: 'stage' as const, databaseUrl: 'intentionally-invalid', coordinationDir: directory, reportDir: directory,
    beforeBytes, stagedBytes,
  };
  try {
    const sessionFile = path.join(directory, 'active-deployment-session.json');
    await writeFile(sessionFile, JSON.stringify(session));
    await assert.rejects(changeOwnedFirstSplitRuntimeGrants(input), /dedicated session and rehearsed ACL evidence/);
    await writeFile(sessionFile, JSON.stringify({ ...session, purpose: 'first-database-role-cutover' }));
    await assert.rejects(changeOwnedFirstSplitRuntimeGrants({ ...input, stagedBytes: Buffer.from('drift') }),
      /dedicated session and rehearsed ACL evidence/);
    await assert.rejects(changeOwnedFirstSplitRuntimeGrants(input), /maintenance marker changed/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { force: true, recursive: true });
  }
});
