import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import test from 'node:test';
import ts from 'typescript';

async function fixture(options: { checksum?: string; uploadedSchema?: string } = {}) {
  const filename = path.join(__dirname, '..', 'privateRecoveryPostgres.ts');
  const requireModule = createRequire(filename);
  const calls: Array<{ tool: string; args: string[]; env: Record<string, string> }> = [];
  const writes: Array<{ file: string; value: Buffer }> = [];
  const canonical = Buffer.from('CREATE TABLE public.orders (id integer);\n');
  const databaseSemantics = { encoding: 'UTF8', collate: 'en_US.utf8', ctype: 'en_US.utf8', provider: 'c',
    icuLocale: null, collationVersion: null, actualCollationVersion: null, serverVersionNum: 150010 };
  const imageId = 'sha256:' + 'a'.repeat(64);
  const child = Object.assign(new EventEmitter(), { exitCode: null as number | null, signalCode: null });
  const system: any = {
    mkdtemp: async () => '/tmp/sbr-ABC123', chmod: async () => {}, cp: async () => {}, chown: async () => {},
    mkdir: async () => {}, copyFile: async () => {}, rm: async () => {},
    readdir: async (directory: string) => directory.endsWith('/migrations') ? [{ isDirectory: () => true, name: '20250101000000_first' }] : [],
    readFile: async (file: string) => file === filename ? fs.readFile(file, 'utf8')
      : file.endsWith('/identity.json') ? JSON.stringify({ imageId }) : canonical,
    writeFile: async (file: string, value: Buffer) => { writes.push({ file, value }); },
  };
  const execute = Object.assign(() => {}, { [promisify.custom]: async (tool: string, args: string[], configuration: any) => {
    calls.push({ tool, args: [...args], env: { ...configuration.env } });
    if (tool === 'psql' && args.at(-1)?.includes('pg_database_collation_actual_version')) {
      return { stdout: JSON.stringify(databaseSemantics), stderr: '' };
    }
    if (args[0] === '--stop') { child.exitCode = 0; child.emit('exit'); return { stdout: '', stderr: '' }; }
    if (tool === 'psql' && args.at(-1)?.includes('json_agg')) return { stdout: JSON.stringify([{
      migration_name: '20250101000000_first', checksum: options.checksum || crypto.createHash('sha256').update(canonical).digest('hex'),
      finished: true, rolled_back: false, applied_steps_count: 1,
    }]), stderr: '' };
    if (tool === 'pg_dump' && args.includes('--schema-only')) {
      const url = new URL(args[1]);
      return { stdout: url.pathname === '/recovery_source' && !calls.some(call => call.args.includes('REASSIGN OWNED'))
        ? options.uploadedSchema || 'CREATE TABLE public.orders (id integer);\n' : 'CREATE TABLE public.orders (id integer);\n', stderr: '' };
    }
    return { stdout: '1', stderr: '' };
  } });
  const localRequire = Object.assign((name: string) => name === 'node:fs/promises' ? system
    : name === 'node:path' ? path.posix
      : name === 'node:child_process' ? { execFile: execute, spawn: (tool: string, args: string[], config: any) => {
        calls.push({ tool, args, env: { ...config.env } }); return child;
      } } : requireModule(name), { resolve: requireModule.resolve });
  const exported: any = {};
  vm.runInNewContext(ts.transpileModule(await fs.readFile(filename, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText, { exports: exported, require: localRequire, Buffer, URL, setTimeout, console,
    clearTimeout, process: { platform: 'linux', pid: 41, getuid: () => 0, cwd: () => '/image/app', execPath: '/usr/bin/node',
      env: { DATABASE_URL: 'postgresql://owner:production-secret@production/live', SECRET: 'production-secret',
        SYSTEM_RECOVERY_POSTGRES_IMAGE_ID: imageId } } }, { filename });
  const run = () => exported.migrateRecoveryArchivePrivately({ sourceDump: '/private/upload.dump', workDirectory: '/private/job',
    applyMigrations: true, databaseSemantics, assertBoundary: async () => {}, verifyCurrentSchema: async () => {} });
  return { run, calls, writes };
}

test('private archive migration never passes production credentials to child processes and preserves canonical migration bytes', async () => {
  const { run, calls, writes } = await fixture();
  const result = await run();
  assert.equal(result.dumpPath, '/private/job/migrated-application.dump');
  assert.equal(calls.every(call => !JSON.stringify(call.env).includes('production-secret')), true);
  assert.equal(calls.filter(call => ['psql', 'pg_dump', 'pg_restore'].includes(call.tool))
    .every(call => call.env.PGOPTIONS === '-csearch_path=pg_catalog'), true,
  'every private CLI connection overrides archived database search_path, including public.pg_get_functiondef shadows');
  assert.equal(calls.find(call => call.tool.endsWith('recovery-postgres-sandbox') && call.args[0] !== '--stop')?.env.SABALAN_RECOVERY_PARENT_PID, '41');
  const uploaded = calls.find(call => call.tool === 'pg_restore')!;
  assert.equal(new URL(uploaded.args[1]).username, 'recovery_import');
  assert.equal(new URL(uploaded.args[1]).searchParams.get('host'), '/tmp/sbr-ABC123/root/run');
  const migrations = calls.filter(call => call.tool === '/usr/bin/node');
  assert.equal(migrations.length, 2);
  assert.equal(migrations[0].env.DATABASE_URL.includes('/recovery_expected?'), true);
  assert.equal(migrations[1].env.DATABASE_URL.includes('/recovery_source?'), true);
  assert.equal(writes[0].value.toString(), 'CREATE TABLE public.orders (id integer);\n');
  const exported = calls.find(call => call.tool === 'pg_dump' && call.args.includes('--format=custom'))!;
  assert.equal(exported.args.filter(arg => arg.startsWith('--exclude-table-data=')).join(','),
    '--exclude-table-data=public.deployment_operations,--exclude-table-data=public.customer_allocation_release_control,--exclude-table-data=public.customer_allocation_release_audit,--exclude-table-data=public.partner_release_readiness_publications');
  assert.equal(calls.at(-1)?.args.join(','), '--stop,/tmp/sbr-ABC123/root');
});

test('an altered archived migration checksum stops before privileged migrations and still retires the private server', async () => {
  const { run, calls } = await fixture({ checksum: '0'.repeat(64) });
  await assert.rejects(run(), /checksum differs/);
  assert.equal(calls.some(call => call.tool === '/usr/bin/node'), false);
  assert.equal(calls.some(call => call.args.some(arg => arg.includes('REASSIGN OWNED'))), false);
  assert.equal(calls.at(-1)?.args[0], '--stop');
});

test('an uploaded replacement function is rejected before archive objects become private-superuser owned', async () => {
  const { run, calls } = await fixture({ uploadedSchema: 'CREATE FUNCTION public.steal() RETURNS void LANGUAGE c AS \'/data/payload.so\';\n' });
  await assert.rejects(run(), /historical migration prefix/);
  assert.equal(calls.filter(call => call.tool === '/usr/bin/node').length, 1, 'only canonical empty reference DB is migrated');
  assert.equal(calls.some(call => call.args.some(arg => arg.includes('REASSIGN OWNED'))), false);
  assert.equal(calls.at(-1)?.args[0], '--stop');
});
