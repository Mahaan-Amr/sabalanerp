import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); }
catch { ts = require('../../../typescript.js'); }
const source = fs.readFileSync(new URL('../../backend/src/services/qaNativeCheckpointReadback.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const moduleExports = {};
new Function('require', 'exports', code)(require, moduleExports);

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pin = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const request = {
  requestId: 'a'.repeat(64), size: 1585766492, mtimeSeconds: 1795293000,
  objectKey: '20261121T192606Z-1526f22d9894-release/deploy-20261121T192606Z-1526f22d9894-release.sabrec',
};
const result = { ...request, format: 'sabalan-qa-native-readback-result/v1', sha256: 'b'.repeat(64) };

function signed(value) {
  const bytes = Buffer.from(JSON.stringify(value));
  return { result: bytes.toString('base64'), signature: sign(null, bytes, privateKey).toString('base64') };
}

test('a valid native readback binds the complete-object digest to its exact request', () => {
  assert.equal(moduleExports.verifyQaNativeReceipt(signed(result), pin, request), result.sha256);
});

test('native readback rejects signed replays, changed object identity and corrupt signatures', () => {
  for (const change of [{ requestId: 'c'.repeat(64) }, { size: request.size + 1 },
    { mtimeSeconds: request.mtimeSeconds + 1 }, { objectKey: request.objectKey + '.uploading' }]) {
    assert.throws(() => moduleExports.verifyQaNativeReceipt(signed({ ...result, ...change }), pin, request), /MISMATCH/);
  }
  const receipt = signed(result);
  receipt.result = Buffer.from(JSON.stringify({ ...result, sha256: 'c'.repeat(64) })).toString('base64');
  assert.throws(() => moduleExports.verifyQaNativeReceipt(receipt, pin, request), /SIGNATURE_INVALID/);
});

test('the native readback opt-in is refused outside the plan-bound QA incident', () => {
  const names = ['DEPLOYMENT_QA_NATIVE_READBACK', 'SABALAN_BACKUP_TARGET', 'DEPLOYMENT_CLAMAV_OPERATION', 'SABALAN_QA_PLAN_SHA256'];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    delete process.env.DEPLOYMENT_QA_NATIVE_READBACK;
    assert.equal(moduleExports.usesQaNativeReadback(), false);
    process.env.DEPLOYMENT_QA_NATIVE_READBACK = '1';
    process.env.SABALAN_BACKUP_TARGET = 'production';
    process.env.DEPLOYMENT_CLAMAV_OPERATION = 'incident-recovery';
    process.env.SABALAN_QA_PLAN_SHA256 = 'a'.repeat(64);
    assert.throws(() => moduleExports.usesQaNativeReadback(), /ENVIRONMENT_INVALID/);
    process.env.SABALAN_BACKUP_TARGET = 'qa';
    assert.equal(moduleExports.usesQaNativeReadback(), true);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
