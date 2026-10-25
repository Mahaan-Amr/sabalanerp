import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
import { assertNativeRecoveryDatabaseQuiet } from '../nativeRecoveryLedgerProof';

// Execute the exact production function bodies with explicit SQL/crypto ports.
// These tests prove control/cleanup behavior, not a real database restore. The
// real native-child closure seam is tested separately with finite Node children.
const filename = path.resolve(__dirname, '../systemRecoveryEngine.ts');
const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
function selected(name: string, scope: Record<string, unknown>) {
  let initializer: ts.Expression | undefined;
  for (const node of source.statements) if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) if (declaration.name.getText(source) === name) initializer = declaration.initializer;
  }
  assert.ok(initializer);
  const javascript = ts.transpileModule('exports.selected = ' + initializer.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const output = { ...scope, exports: {} as Record<string, any> };
  vm.runInNewContext(javascript, output, { filename: 'exact-production-' + name });
  (output as any)[name] = output.exports.selected;
  return output.exports.selected;
}
const sha = (raw: Buffer) => crypto.createHash('sha256').update(raw).digest('hex');
async function harness(action: (run: any, state: any) => Promise<void>, options: { callbackFailure?: unknown; liveSession?: boolean; dropFailure?: boolean; badOid?: boolean; packageType?: string } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-strict-recovery-unit-'));
  const work = path.join(root, 'work'), old = path.join(work, 'preserved-old-failure');
  fs.mkdirSync(old, { recursive: true }); fs.writeFileSync(path.join(old, 'evidence'), 'old');
  fs.utimesSync(old, new Date(0), new Date(0));
  const trace: string[] = [], state: any = { trace, root, old, work, database: undefined, disconnected: false, callbacks: [], commands: [] };
  const bytes = Buffer.from('synthetic component');
  const manifest = { format: 'sabalan-recovery', formatVersion: 1, packageType: options.packageType ?? 'COMPLETE', appVersion: '1.0.0', postgresVersion: '15.16',
    components: ['database/main.dump', 'inquiry/inquiry.db'].map(name => ({ path: name, size: bytes.length, sha256: sha(bytes) })) };
  const original = { format: 'synthetic-original-unit-port', originalPid: 123, code: 0, signal: null, stdoutEof: true, stderrEof: true };
  const scope: Record<string, any> = { fs, path, crypto, process, Date, URL, Buffer,
    PERFORMANCE_EXPORT_STORAGE_DIR: '/app/storage/performance-exports',
    PACKAGES_DIR: path.join(root, 'packages'), UPLOADS_DIR: path.join(root, 'uploads'), WORK_DIR: work, RECOVERY_COORDINATION_DIR: path.join(root, 'coordination'),
    validateNativeRecoveryExpectation: () => trace.push('expected'),
    decryptRecoveryArchive: async (_source: string, target: string) => { trace.push('decrypt'); fs.writeFileSync(target, 'owned intermediate'); },
    extractRecoveryArchive: async (_archive: string, payload: string) => {
      trace.push('extract'); for (const name of ['database', 'inquiry']) fs.mkdirSync(path.join(payload, name), { recursive: true });
      for (const component of manifest.components) fs.writeFileSync(path.join(payload, component.path), bytes);
      fs.writeFileSync(path.join(payload, 'manifest.json'), JSON.stringify(manifest));
    },
    sha256File: async (file: string) => sha(fs.readFileSync(file)),
    recoveryCompatibility: () => ({ compatible: true }), currentPostgresVersion: async () => '15.16',
    execFileAsync: async (command: string) => { assert.equal(command, 'sqlite3'); trace.push('sqlite'); return { stdout: 'ok\n' }; },
    captureInquiryBusinessProof: async () => { trace.push('inquiry'); return { synthetic: true }; },
    safeDatabaseName: (prefix: string) => prefix + '_abcdef012345',
    createDatabase: async (_url: string, name: string) => { trace.push('create'); state.database = { name, oid: '123', systemIdentifier: '456' }; },
    observeStrictRecoveryDatabase: async () => ({ ...state.database, visible: true, sessions: state.disconnected && options.liveSession ? 1 : 0, transactions: 0, prepared: 0,
      oid: state.dropped ? null : state.disconnected && options.badOid ? '999' : state.database.oid }),
    assertNativeRecoveryDatabaseQuiet,
    databaseArgs: (_url: string, database: string) => ({ connection: ['--dbname', database], env: {} }),
    strictRecoveryCommand: async (command: string, args: string[]) => {
      state.commands.push([command, args]);
      if (command === 'pg_restore') { trace.push('pg_restore'); return { original }; }
      trace.push('drop'); assert.ok(state.disconnected); assert.ok(!args.some(value => /force|terminate/i.test(value)));
      if (options.dropFailure) throw new Error('drop failed');
      state.dropped = true; return { original };
    },
    restoreDatabase: async () => trace.push('legacy-restore'),
    databaseUrlWithName: (_url: string, name: string) => 'postgresql://test@postgres:5432/' + name + '?application_name=sabalan-rt-' + 'a'.repeat(48),
    validateStoredFileReferences: async () => trace.push('files-and-security'),
    verifyRecoveredApplicationPayloads: async () => trace.push('independent-keys-and-payloads'),
    captureRecoveryBusinessProof: async () => { trace.push('business'); return []; },
    inspectNativeRecoveryLedger: async () => { trace.push('native-history'); return { cleanupPending: true, sourceAuthorityAuthenticated: false, rawHistoryJson: 'private raw' }; },
    dropDatabase: async () => trace.push('legacy-drop'),
    PrismaClient: class {
      constructor(input: any) { const u = new URL(input.datasources.db.url); assert.equal(u.hostname, 'postgres'); state.clientApplicationName = u.searchParams.get('application_name'); }
      async $queryRawUnsafe(sql: string) { assert.equal(sql, 'SELECT 1'); trace.push('client-probe'); }
      async $transaction(callback: (client: object) => Promise<unknown>) { return callback({}); }
      async $disconnect() { trace.push('disconnect'); state.disconnected = true; }
    },
  };
  scope.activeStrictRestoreProofs = new WeakMap();
  scope.freezeStrictRestoreValue = selected('freezeStrictRestoreValue', scope);
  scope.assertActiveStrictRestoreProof = selected('assertActiveStrictRestoreProof', scope);
  state.assertActive = scope.assertActiveStrictRestoreProof;
  scope.ensureDirectories = selected('ensureDirectories', scope);
  scope.retireStrictRecoveryDatabase = selected('retireStrictRecoveryDatabase', scope);
  const validate = selected('validateRecoveryPackage', scope);
  const input = { sourcePath: path.join(root, 'original.sabrec'), passphrase: 'unit mock only', prisma: {}, verifyRestore: true,
    verifyApplicationPayloads: true, verifyBusinessData: true, nativeRestoreInspection: { expectedLedger: {} as any,
      onVerified: async (proof: any) => {
        trace.push('callback'); assert.equal(state.disconnected, true); assert.equal(proof.client, undefined);
        const context = state.assertActive(proof); state.context = context;
        assert.equal(context.proof, proof); assert.equal(context.manifest.packageType, 'COMPLETE');
        assert.equal(context.sourceStorageRoots.performanceExports, '/app/storage/performance-exports');
        assert.equal(Object.isFrozen(context.sourceStorageRoots), true);
        assert.ok(fs.existsSync(path.join(context.payloadRoot, 'inquiry', 'inquiry.db')));
        assert.equal(Object.isFrozen(context), true); assert.equal(Object.isFrozen(proof), true);
        assert.throws(() => state.assertActive({ ...proof }), /PROOF_NOT_ACTIVE/);
        assert.throws(() => state.assertActive(JSON.parse(JSON.stringify(proof))), /PROOF_NOT_ACTIVE/);
        assert.equal(proof.originalRestore, original); state.callbacks.push(proof);
        if ('callbackFailure' in options) throw options.callbackFailure;
      } } };
  try { await action((overrides: object = {}) => validate({ ...input, ...overrides }), state); }
  finally {
    assert.ok(path.basename(root).startsWith('sabalan-strict-recovery-unit-') && path.dirname(root) === os.tmpdir());
    fs.rmSync(root, { recursive: true });
  }
}
test('strict full flow preserves old failed work, runs mandatory validators and drops only after client closure', async () => {
  await harness(async (run, state) => {
    const result = await run(); assert.equal(state.callbacks.length, 1); assert.equal(state.dropped, true);
    assert.ok(fs.existsSync(path.join(state.old, 'evidence'))); assert.deepEqual(fs.readdirSync(state.work), ['preserved-old-failure']);
    for (const stage of ['sqlite', 'inquiry', 'files-and-security', 'independent-keys-and-payloads', 'business', 'native-history', 'callback', 'disconnect', 'drop']) assert.ok(state.trace.includes(stage));
    assert.ok(state.trace.indexOf('disconnect') < state.trace.indexOf('callback')); assert.ok(state.trace.indexOf('callback') < state.trace.indexOf('drop'));
    assert.throws(() => state.assertActive(state.callbacks[0]), /PROOF_NOT_ACTIVE/);
    assert.throws(() => state.assertActive({}), /PROOF_NOT_ACTIVE/);
    assert.throws(() => state.assertActive(null), /PROOF_NOT_ACTIVE/);
    assert.equal(fs.existsSync(state.context.payloadRoot), false);
    assert.equal(result.nativeRestoreInspection, undefined); assert.equal(result.rawHistoryJson, undefined); assert.ok(!state.trace.includes('legacy-drop'));
    assert.equal(state.clientApplicationName, 'sabalan-rt-' + 'a'.repeat(48), 'temporary recovery clients must remain visible to the SAME native guardian namespace');
  });
});
test('strict flags cannot turn off any complete validator or supply a nonfunction callback', async () => {
  await harness(async (run, state) => {
    for (const overrides of [{ verifyRestore: false }, { verifyApplicationPayloads: false }, { verifyBusinessData: false },
      { nativeRestoreInspection: { expectedLedger: {}, onVerified: true } }]) await assert.rejects(run(overrides), /STRICT_COMPLETE_FLAGS/);
    assert.equal(state.trace.length, 0);
  });
});
test('sanitized content cannot enter the strict COMPLETE native lane', async () => {
  await harness(async (run, state) => {
    await assert.rejects(run(), /STRICT_COMPLETE_PACKAGE_REQUIRED/);
    assert.equal(state.database, undefined); assert.equal(state.callbacks.length, 0);
    assert.ok(fs.readdirSync(state.work).some((name: string) => name.startsWith('validate-')));
    assert.ok(fs.existsSync(path.join(state.old, 'evidence')));
  }, { packageType: 'SANITIZED_TEST' });
});
test('an unknown SQL session prevents DROP and retains the private job', async () => {
  await harness(async (run, state) => {
    await assert.rejects(run(), (error: any) => error.code === 'RECOVERY_STRICT_CLEANUP_FAILED');
    assert.equal(state.dropped, undefined); assert.ok(fs.readdirSync(state.work).some((name: string) => name.startsWith('validate-')));
  }, { liveSession: true });
});
test('a replaced OID prevents DROP even when sessions are quiet', async () => {
  await harness(async (run, state) => {
    await assert.rejects(run(), (error: any) => error.code === 'RECOVERY_STRICT_CLEANUP_FAILED'); assert.equal(state.dropped, undefined);
  }, { badOid: true });
});
test('cleanup failures are not suppressed and preserve both the primary and cleanup errors', async () => {
  const failure = new Error('private observation failed');
  await harness(async (run, state) => {
    await assert.rejects(run(), (error: any) => error.code === 'RECOVERY_STRICT_CLEANUP_FAILED' && error.validationFailure === failure && error.cleanupError.message === 'drop failed');
    assert.ok(fs.readdirSync(state.work).some((name: string) => name.startsWith('validate-')));
  }, { callbackFailure: failure, dropFailure: true });
});
test('even a falsy thrown callback failure preserves failed private work after safe retirement', async () => {
  await harness(async (run, state) => {
    let threw = false; try { await run(); } catch (error) { threw = true; assert.equal(error, null); }
    assert.equal(threw, true); assert.equal(state.dropped, true);
    assert.throws(() => state.assertActive(state.callbacks[0]), /PROOF_NOT_ACTIVE/); assert.ok(fs.readdirSync(state.work).some((name: string) => name.startsWith('validate-')));
  }, { callbackFailure: null });
});
test('ordinary validation keeps the legacy return and cleanup path', async () => {
  await harness(async (run, state) => {
    const result = await run({ nativeRestoreInspection: undefined }); assert.ok(state.trace.includes('legacy-restore'));
    assert.ok(state.trace.includes('legacy-drop')); assert.equal(state.callbacks.length, 0); assert.deepEqual(fs.readdirSync(state.work), []);
    assert.equal(result.rawHistoryJson, undefined);
  });
});

test('rejected active callback expires exact origin proof before safe cleanup', async () => {
  const failure = new Error('callback rejected');
  await harness(async (run, state) => {
    await assert.rejects(run(), error => error === failure);
    assert.equal(state.dropped, true); assert.equal(state.disconnected, true);
    assert.throws(() => state.assertActive(state.callbacks[0]), /PROOF_NOT_ACTIVE/);
    assert.equal(fs.existsSync(state.context.payloadRoot), true, 'negative private work remains diagnostic evidence');
  }, { callbackFailure: failure });
});
