import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import { promisify } from 'node:util';
import ts from 'typescript';

async function fixture(stageSchema: string, cleanupAdmitted = true) {
  const statements: string[] = [];
  const connections: Array<{ connected: boolean; ended: boolean }> = [];
  const control = 'postgres';
  let rolePresent = false;
  const roles = [
    { name: 'sabalan_allocation_controller', login: true, connectionLimit: -1, validUntil: null },
    { name: 'sabalan_application_runtime', login: true, connectionLimit: -1, validUntil: null },
  ];
  const catalog = [
    { kind: 'DATABASE', name: '', arguments: '', target: 'main', owner: control, securityDefiner: false, grants: [] },
    { kind: 'SCHEMA', name: 'public', arguments: '', target: 'public', owner: 'pg_database_owner', securityDefiner: false, grants: [] },
  ];
  class Client {
    state = { connected: false, ended: false };
    database: string;
    constructor(config: { connectionString: string }) {
      this.database = new URL(config.connectionString).pathname.slice(1);
      connections.push(this.state);
    }
    async connect() { this.state.connected = true; }
    async end() { this.state.ended = true; }
    async query(sql: string) {
      statements.push(sql);
      if (sql.includes('CREATE ROLE')) rolePresent = true;
      if (sql.includes('DROP ROLE')) rolePresent = false;
      if (sql.includes('AS stage_role_admitted')) return { rows: rolePresent ? [{ stage_role_admitted: cleanupAdmitted,
        stage_owner_admitted: true, stage_database: 'sabalan_restore_abcdef012345' }] : [] };
      if (sql.includes('AS admitted')) return { rows: [{ database: this.database, control, admitted: true,
        connectionLimit: this.database === 'main' ? -1 : 0 }] };
      if (sql.includes('AS restricted')) return { rows: roles.map(role => ({ ...role, restricted: true })) };
      if (sql.includes('AS present')) return { rows: [{ present: false }] };
      if (sql.includes('WITH objects AS')) return { rows: catalog };
      if (sql.includes('pg_export_snapshot')) return { rows: [{ snapshot: 'trusted-snapshot' }] };
      return { rows: [] };
    }
  }
  const exec = Object.assign(() => {}, { [promisify.custom]: async (_tool: string, args: string[], options: any) => {
    assert.equal(args.includes('--no-owner'), true);
    assert.equal(args.includes('--no-privileges'), true);
    assert.equal(args.some(arg => arg.includes('secret')), false, 'password stays outside argv');
    const stage = args.some(arg => arg.includes('sabalan_restore_'));
    if (!stage) assert.equal(args.slice(-2).join(','), '--snapshot,trusted-snapshot');
    assert.equal(options.env.PGPASSWORD, 'secret');
    return { stdout: stage ? stageSchema : 'CREATE TABLE public.orders (id integer);\n', stderr: '' };
  } });
  const loaded = new Map<string, any>();
  async function load(filename: string): Promise<any> {
    if (loaded.has(filename)) return loaded.get(filename);
    const exported = {};
    loaded.set(filename, exported);
    const requireModule = createRequire(filename);
    const replacements: Record<string, any> = { pg: { Client }, 'node:child_process': { execFile: exec } };
    if (filename.endsWith('applicationRecoveryStage.ts')) {
      replacements['./protectedDatabaseRoleRecovery'] = await load(path.join(__dirname, '..', 'protectedDatabaseRoleRecovery.ts'));
    }
    const source = await fs.readFile(filename, 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
    } }).outputText;
    vm.runInNewContext(code, { exports: exported, require: (name: string) => replacements[name] ?? requireModule(name),
      process, Buffer, console, URL }, { filename });
    return exported;
  }
  const api = await load(path.join(__dirname, '..', 'applicationRecoveryStage.ts'));
  return { api, statements, connections, scope: {
    roles: { runtime: roles[1].name, controller: roles[0].name }, source: 'main', assertBoundary: async () => {},
  } };
}

test('application stage refuses owner elevation when restored definitions differ from the trusted target', async () => {
  const fixtureData = await fixture('CREATE FUNCTION public.escalate() RETURNS void SECURITY DEFINER LANGUAGE sql AS $$ SELECT 1 $$;\n');
  const { api, scope, statements, connections } = fixtureData;
  const stage = await api.prepareApplicationRecoveryStage('postgresql://postgres:secret@localhost/main?connection_limit=5',
    'sabalan_restore_abcdef012345', scope);
  await assert.rejects(stage.finalize(), { code: 'APPLICATION_RECOVERY_SCHEMA_MISMATCH' });
  assert.equal(statements.some(sql => sql.includes('REASSIGN OWNED')), false);
  await stage.cleanup();
  assert.equal(connections.every(state => state.ended), true);
  const login = new URL(stage.loginUrl);
  assert.equal(login.username, 'sabalan_restore_abcdef012345_login');
  assert.notEqual(login.password, 'secret');
  assert.equal(statements.some(sql => sql.includes('NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS')), true);
  assert.equal(statements.some(sql => /SET ROLE/.test(sql)), false);
  assert.equal(statements.some(sql => /DROP ROLE/.test(sql)), true);
});

test('application stage verifies full schema and disables its login before assigning trusted ownership and ACLs', async () => {
  const { api, scope, statements, connections } = await fixture(
    '\\restrict independent_nonce\nCREATE TABLE public.orders (id integer);\n\\unrestrict independent_nonce\n');
  const stage = await api.prepareApplicationRecoveryStage('postgresql://postgres:secret@localhost/main?pool_timeout=20',
    'sabalan_restore_abcdef012345', scope);
  await stage.verifySchema();
  await stage.finalize();
  await stage.cleanup();
  const elevation = statements.findIndex(sql => sql.includes('REASSIGN OWNED'));
  const disabled = statements.findIndex(sql => sql.includes('NOLOGIN'));
  assert.ok(elevation > disabled && disabled > 0);
  assert.equal(statements.filter(sql => sql.includes('DROP ROLE')).length, 1);
  assert.equal(statements.some(sql => sql.includes('CONNECTION LIMIT 0')), true);
  assert.equal(connections.every(state => state.ended), true);
});

test('application stage does not normalize directive-shaped text inside restored definitions', async () => {
  const { api, scope } = await fixture(
    '\\restrict outer\nCREATE TABLE public.orders (id integer);\n\\restrict hidden\n\\unrestrict hidden\n\\unrestrict outer\n');
  const stage = await api.prepareApplicationRecoveryStage('postgresql://postgres:secret@localhost/main',
    'sabalan_restore_abcdef012345', scope);
  await assert.rejects(stage.verifySchema(), { code: 'APPLICATION_RECOVERY_SCHEMA_MISMATCH' });
  await stage.cleanup();
});

test('interrupted stage retirement refuses a role with authority outside its journal stage', async () => {
  const { api, scope, statements } = await fixture('CREATE TABLE public.orders (id integer);\n', false);
  await api.prepareApplicationRecoveryStage('postgresql://postgres:secret@localhost/main',
    'sabalan_restore_abcdef012345', scope);
  await assert.rejects(api.retireApplicationRecoveryStageRole('postgresql://postgres:secret@localhost/main',
    'sabalan_restore_abcdef012345', 'sabalan_restore_abcdef012345_login'), /unexpected authority/);
  assert.equal(statements.some(sql => sql.includes('DROP ROLE')), false);
  await assert.rejects(api.retireApplicationRecoveryStageRole('postgresql://postgres:secret@localhost/main',
    'sabalan_restore_abcdef012345', 'other_role'), /journal identity differs/);
});

