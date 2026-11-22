import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..'), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const [input, preflightFile] = process.argv.slice(2);
assert.ok(input && preflightFile, 'Pass the prepared input manifest and completed both-host preflight receipt.');
const inputBytes = fs.readFileSync(input), manifest = JSON.parse(inputBytes);
assert.equal(manifest.format, 'sabalan-actual-image-customer-input/v1');
assert.equal(path.resolve(input), path.join(manifest.destination, 'input-manifest.json'));
assert.equal(path.dirname(manifest.destination), path.resolve('D:/sabalanerp-online-qa'));
const operation = path.basename(manifest.destination);
assert.match(operation, /^actual-image-customer-[a-f0-9]{32}$/);
assert.equal(manifest.productionAdmission, false);
for (const [name, hash] of Object.entries(manifest.sources)) assert.equal(sha(fs.readFileSync(path.join(root, name))), hash);
const preflightBytes = fs.readFileSync(preflightFile), preflight = JSON.parse(preflightBytes);
assert.equal(preflight.sshExitCode, 0);
const checked = JSON.parse(preflight.stdout);
assert.equal(checked.exitCode, 0); assert.equal(checked.lockHeldThroughBothHostPreflight, true);
assert.equal(checked.productionCommitBefore, 'a2c75f1027a069e91837ff433e1c91cdc7746798');
assert.equal(checked.productionCommitAfter, checked.productionCommitBefore);
assert.ok(Date.now() - Date.parse(preflight.observedAt) >= 0 && Date.now() - Date.parse(preflight.observedAt) <= 600_000,
  'Run fresh both-host cleanup/capacity preflight before preparing the operation.');
const files = Object.fromEntries(Object.entries(manifest.files).map(([name, identity]) => {
  assert.ok(!name.includes('/') && !name.includes('\\'));
  const bytes = fs.readFileSync(path.join(manifest.destination, name));
  assert.equal(bytes.length, identity.bytes); assert.equal(sha(bytes), identity.sha256);
  return [name, { sha256: identity.sha256, base64: bytes.toString('base64') }];
}));
const controller = fs.readFileSync(path.join(manifest.destination, 'controller.py'));
assert.equal(sha(controller), manifest.controller.sha256);
const spec = { operation, files, controller: { sha256: sha(controller), base64: controller.toString('base64') },
  inputManifest: { sha256: sha(inputBytes), base64: inputBytes.toString('base64') },
  preflight: { sha256: sha(preflightBytes), base64: preflightBytes.toString('base64'), observedAt: preflight.observedAt } };
const remote = Buffer.concat([Buffer.from('SPEC = __import__("json").loads(__import__("base64").b64decode("'
  + Buffer.from(JSON.stringify(spec)).toString('base64') + '"))\n'), controller]);
const remoteFile = path.join('D:/sabalanerp-online-qa', operation + '-remote.py');
fs.writeFileSync(remoteFile, remote, { flag: 'wx', mode: 0o400 });
const intent = { format: 'sabalan-actual-image-customer-intent/v1', operation, inputManifestSha256: sha(inputBytes),
  controllerSha256: sha(controller), remoteEnvelopeSha256: sha(remote), remoteFile,
  preflightSha256: sha(preflightBytes), sourceHashes: Object.fromEntries(Object.entries(files).map(([name, item]) => [name, item.sha256])),
  productionAdmission: false, fullApplicationRestore: false };
const intentFile = path.join(root, 'reports/qa', operation + '-intent.json');
fs.writeFileSync(intentFile, JSON.stringify(intent, null, 2) + '\n', { flag: 'wx', mode: 0o400 });
console.log(JSON.stringify({ intentFile, intentSha256: sha(fs.readFileSync(intentFile)), remoteFile, operation }));
