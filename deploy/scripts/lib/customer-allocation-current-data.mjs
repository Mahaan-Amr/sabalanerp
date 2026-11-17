import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalGoPayload } from './customer-allocation-go-manifest.mjs';

const roles = ['backend', 'frontend', 'inquiry'];
const commit = /^[0-9a-f]{40}$/;
const digest = /^[0-9a-f]{64}$/;
const imageId = /^sha256:[0-9a-f]{64}$/;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const labels = value => value?.Config?.Labels ?? {};
const sourceCommit = 'io.sabalan.performance.source-commit';
const sourceHash = 'io.sabalan.performance.source-hash';
const uploadPolicy = 'io.sabalan.release.upload-policy';
const fail = () => { throw new Error('CUSTOMER_ALLOCATION_CURRENT_DATA_UNPROVEN'); };

function assertScanner(scanner, id, image, expectedStatus) {
  if (!digest.test(id) || !imageId.test(image) || scanner?.Id !== id || scanner.Image !== image
    || labels(scanner)['com.docker.compose.project'] !== 'sabalanerp'
    || labels(scanner)['com.docker.compose.service'] !== 'clamav'
    || scanner.Mounts?.filter(mount => mount.Destination === '/var/lib/clamav').length !== 1
    || !scanner.Mounts.some(mount => mount.Destination === '/var/lib/clamav'
      && mount.Type === 'volume' && mount.Name === 'sabalanerp_clamav_database' && mount.RW === true)
    || (expectedStatus && (scanner.State?.Status !== expectedStatus || scanner.State.Running !== false))) fail();
}

/** The locked DB closure checks the historical payload digest against the active receipt. */
export function selectCurrentDataPredecessor({ payload, readerBytes, current, selected, scanner }) {
  if (payload?.schemaVersion !== 1 || payload.decision !== 'GO' || payload.operation !== 'GROUPED_ALLOCATION'
    || !commit.test(payload.candidateCommit) || !digest.test(payload.migrationSha256)
    || payload.evidence?.reader !== sha256(readerBytes)) fail();
  const evidence = JSON.parse(readerBytes);
  if (!commit.test(evidence.predecessorCommit) || evidence.predecessorCommit === payload.candidateCommit
    || evidence.predecessorMigrationSha256 !== payload.migrationSha256
    || !/^erp_[a-z0-9_-]{8,90}$/.test(evidence.predecessorBrowserBuildId)) fail();
  const targetSourceHash = labels(selected.backend)[sourceHash];
  if (!digest.test(targetSourceHash)
    || labels(current.backend)[uploadPolicy] !== 'no-malware-scan'
    || labels(selected.backend)[uploadPolicy]
    || labels(selected.frontend)['io.sabalan.browser.build-id'] !== evidence.predecessorBrowserBuildId) fail();

  for (const role of roles) {
    if (!imageId.test(payload.candidateImages?.[role]) || current[role]?.Id !== payload.candidateImages[role]
      || labels(current[role])[sourceCommit] !== payload.candidateCommit
      || !imageId.test(payload.predecessorImages?.[role]) || selected[role]?.Id !== payload.predecessorImages[role]
      || labels(selected[role])[sourceCommit] !== evidence.predecessorCommit
      || labels(selected[role])[sourceHash] !== targetSourceHash) fail();
  }
  assertScanner(scanner, evidence.predecessorScannerContainerId, evidence.predecessorScannerImage, 'exited');
  return {
    manifestSha256: sha256(canonicalGoPayload(payload)), targetCommit: evidence.predecessorCommit, targetSourceHash,
    browserBuildId: evidence.predecessorBrowserBuildId, images: payload.predecessorImages,
    scannerId: scanner.Id, scannerImage: scanner.Image,
  };
}

function readPrivate(file, maxBytes) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.uid !== BigInt(process.getuid()) || before.nlink !== 1n
      || (before.mode & 0o077n) || before.size < 1n || before.size > BigInt(maxBytes)) fail();
    const bytes = readFileSync(fd);
    const after = fstatSync(fd, { bigint: true });
    const named = lstatSync(file, { bigint: true });
    for (const key of ['dev', 'ino', 'mode', 'uid', 'nlink', 'size', 'mtimeNs', 'ctimeNs']) {
      if (before[key] !== after[key] || before[key] !== named[key]) fail();
    }
    if (BigInt(bytes.length) !== before.size) fail();
    return bytes;
  } finally { closeSync(fd); }
}

function inspect(kind, id) {
  if (!(kind === 'image' ? imageId : digest).test(id)) fail();
  const rows = JSON.parse(execFileSync('docker', [kind, 'inspect', id], { stdio: ['ignore', 'pipe', 'ignore'] }));
  if (rows.length !== 1 || rows[0].Id !== id) fail();
  return rows[0];
}

function exportsForSelection({ targetCommit, targetSourceHash, browserBuildId, images, scannerId, scannerImage, manifestSha256 }) {
  const variables = {
    DEPLOYMENT_TARGET_COMMIT: targetCommit,
    DEPLOYMENT_TARGET_BACKEND_IMAGE: images.backend,
    DEPLOYMENT_BACKEND_IMAGE: images.backend,
    DEPLOYMENT_FRONTEND_IMAGE: images.frontend,
    DEPLOYMENT_INQUIRY_IMAGE: images.inquiry,
    DEPLOYMENT_BROWSER_BUILD_ID: browserBuildId,
    PERFORMANCE_RELEASE_COMMIT: targetCommit,
    PERFORMANCE_RELEASE_SOURCE_HASH: targetSourceHash,
    PERFORMANCE_RELEASE_BACKEND_IMAGE: images.backend,
    PERFORMANCE_RELEASE_FRONTEND_IMAGE: images.frontend,
    PERFORMANCE_RELEASE_INQUIRY_IMAGE: images.inquiry,
    CUSTOMER_ALLOCATION_RETAINED_SCANNER: scannerId,
    CUSTOMER_ALLOCATION_SCANNER_IMAGE: scannerImage,
    CUSTOMER_ALLOCATION_CLOSE_MANIFEST_SHA256: manifestSha256,
  };
  for (const value of Object.values(variables)) if (!/^[A-Za-z0-9_:-]+$/.test(value)) fail();
  return Object.entries(variables).map(([key, value]) => `export ${key}='${value}'`).join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action, input, backend, frontend, inquiry] = process.argv.slice(2);
    if (action === 'select' && process.argv.length === 7) {
      if (!path.isAbsolute(input) || realpathSync(input) !== input) fail();
      const directory = lstatSync(input);
      if (!directory.isDirectory() || directory.uid !== process.getuid() || (directory.mode & 0o077)) fail();
      const { payload } = JSON.parse(readPrivate(path.join(input, 'decision.json'), 64 * 1024));
      const readerBytes = readPrivate(path.join(input, 'reader.json'), 4 * 1024 * 1024);
      if (payload?.evidence?.reader !== sha256(readerBytes)) fail();
      const reader = JSON.parse(readerBytes);
      const current = Object.fromEntries(Object.entries({ backend, frontend, inquiry })
        .map(([role, id]) => [role, inspect('image', id)]));
      const selected = Object.fromEntries(roles.map(role => [role, inspect('image', payload.predecessorImages?.[role])]));
      inspect('image', reader.predecessorScannerImage);
      const scanner = inspect('container', reader.predecessorScannerContainerId);
      process.stdout.write(exportsForSelection(selectCurrentDataPredecessor({ payload, readerBytes, current, selected, scanner })));
    } else if (action === 'stage-scanner' && process.argv.length === 6) {
      const [id, image] = [backend, frontend];
      assertScanner(inspect('container', id), id, image, 'exited');
      const fd = openSync(input, 'wx', 0o600);
      try {
        writeFileSync(fd, JSON.stringify({ id, image }));
        fsyncSync(fd);
      } finally { closeSync(fd); }
      const parent = openSync(path.dirname(input), constants.O_DIRECTORY | constants.O_RDONLY);
      try { fsyncSync(parent); } finally { closeSync(parent); }
    } else if (action === 'stop-staged-scanner' && process.argv.length === 4) {
      const { id, image } = JSON.parse(readPrivate(input, 4096));
      const scanner = inspect('container', id);
      assertScanner(scanner, id, image);
      if (scanner.State.Running === true) execFileSync('docker', ['stop', '-t', '60', id], { stdio: 'ignore' });
      assertScanner(inspect('container', id), id, image, 'exited');
    } else fail();
  } catch {
    console.error('CUSTOMER_ALLOCATION_CURRENT_DATA_UNPROVEN');
    process.exitCode = 1;
  }
}
