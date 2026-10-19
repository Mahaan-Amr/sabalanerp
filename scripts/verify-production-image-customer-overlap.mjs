import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..'), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const [manifestFile, intentFile, receiptFile] = process.argv.slice(2);
assert.ok(manifestFile && intentFile && receiptFile);
const manifestBytes = fs.readFileSync(manifestFile), manifest = JSON.parse(manifestBytes);
const intent = JSON.parse(fs.readFileSync(intentFile)), receipt = JSON.parse(fs.readFileSync(receiptFile));
assert.equal(manifest.format, 'sabalan-actual-image-customer-input/v1');
assert.equal(intent.format, 'sabalan-actual-image-customer-intent/v1');
assert.equal(sha(manifestBytes), intent.inputManifestSha256);
assert.equal(sha(fs.readFileSync(intent.remoteFile)), intent.remoteEnvelopeSha256);
assert.equal(receipt.remoteEnvelopeSha256, intent.remoteEnvelopeSha256);
const proof = JSON.parse(receipt.stdout);
assert.equal(proof.format, 'sabalan-native-actual-image-customer-overlap/v1');
assert.equal(proof.operation, intent.operation);
assert.equal(proof.inputManifestSha256, intent.inputManifestSha256);
assert.equal(proof.preflightSha256, intent.preflightSha256);
assert.equal(proof.controllerSha256, intent.controllerSha256);
assert.deepEqual(proof.sourceHashes, intent.sourceHashes);
for (const [name, hash] of Object.entries(manifest.sources)) assert.equal(sha(fs.readFileSync(path.join(root, name))), hash);
assert.equal(proof.backendImage, 'sha256:13c89b392eb1903f55c1160f4f5f72a85d0ec57cd39476edff7928453516dde6');
assert.equal(proof.postgresImage, 'sha256:15283455b75304c90f51bf16b42c272a25fb52807945dc24830ec88e63cd896d');
assert.equal(proof.productionAdmission, false); assert.equal(proof.healthyRecoveryPoint, false);
assert.equal(proof.fullApplicationRestore, false);
assert.equal(proof.nativeDaemonAndSqlClosureVerified, true);
assert.equal(proof.derivedRetirement.exactDerivedPathsRetired, true);
assert.equal(proof.derivedRetirement.sourceBaseAndImagesRetained, true);
assert.equal(proof.derivedRetirement.physicalPrivacyErasureCertified, false);
assert.equal(receipt.sshExitCode, 0); assert.equal(proof.backendExitCode, 0);
assert.ok([0, 137].includes(proof.postgresStopClientExitCode));
assert.equal(proof.allForeignIdentitiesUnchanged, true);
const actual = proof.actualImageModuleAcceptance;
assert.equal(actual.format, 'sabalan-actual-image-customer-overlap/v1');
assert.equal(actual.actualImageModuleAcceptance, true);
assert.equal(actual.oldSchemaTokensSha256, 'c8021f3262a99c80f5a6f741f17ee05a210a785457fdf85e37a56b66f026ec12');
assert.equal(actual.prismaVersion.client, '5.22.0');
assert.equal(actual.runtimeUid, 0); assert.equal(actual.effectiveCapabilitiesZero, true); assert.equal(actual.noNewPrivileges, true);
assert.equal(actual.imageWorkspacePackages['/packages/contract-product-graph/dist/index.js'], 'e11b3367896c71be7766aa85972663f338c5ee5c728d7de83fe80630d7d491d7');
assert.equal(actual.imageWorkspacePackages['/packages/partner-sales-contracts/dist/index.js'], '84ce45c53ebddca60c63793454093109996ef8923beee9156b0987c6a69858c4');
assert.equal(actual.predecessorMigrations, 427); assert.equal(actual.finalMigrations, 435);
assert.equal(actual.predecessorHistoryRows, 428); assert.equal(actual.finalHistoryRows, 436);
assert.equal(actual.retainedHistorySha256, '7e095386a618dda9ac3d2491772f5c473e91dc97fe4f12eb19a1b0004addefe2');
assert.equal(actual.retainedHistoryPreserved, true);
for (const key of ['financialSnapshotsPreserved', 'legacyReceiptRetryPreserved', 'originalUsersAndContractsPreserved', 'originalLedgerConfigurationPreserved']) assert.equal(actual[key], true);
assert.equal(actual.productionAdmission, false); assert.equal(actual.fullApplicationRestore, false);
assert.ok(Object.hasOwn(actual.modules, '/app/dist/services/accountingCustomerWorkspace.js'));
for (const [name, hash] of Object.entries(actual.modules)) {
  assert.ok(name.startsWith('/app/dist/')); assert.match(hash, /^[a-f0-9]{64}$/);
}
const validation = { format: 'sabalan-actual-image-customer-validation/v1', pass: true, productionAdmission: false,
  operation: intent.operation, inputManifestSha256: sha(manifestBytes), receiptSha256: sha(fs.readFileSync(receiptFile)),
  actualImageModuleCount: Object.keys(actual.modules).length, fullApplicationRestore: false };
const target = path.join(root, 'reports/qa', intent.operation + '-validation.json');
fs.writeFileSync(target, JSON.stringify(validation, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ pass: true, validation: target }));
