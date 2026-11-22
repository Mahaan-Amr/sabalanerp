import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const exec = promisify(execFile);
const imageId = /^sha256:[a-f0-9]{64}$/;

/** A stopped container is not evidence that its release can be discarded. */
export function planStorageCleanup(inventory) {
  if (!inventory.evidenceComplete) throw new Error('STORAGE_PROTECTION_EVIDENCE_INCOMPLETE');
  if (!/^[a-z][a-z0-9_-]*$/.test(inventory.project)) throw new Error('STORAGE_PROJECT_INVALID');
  if (inventory.images.some(image => !imageId.test(image.id))) throw new Error('STORAGE_IMAGE_ID_INVALID');
  if (inventory.protectedImages.some(id => !imageId.test(id))) throw new Error('STORAGE_PROTECTED_IMAGE_INVALID');
  const now = inventory.now ?? Date.now();
  if (!Number.isFinite(now)) throw new Error('STORAGE_CLOCK_INVALID');
  const protectedImages = new Set(inventory.protectedImages);
  const protectedContainers = new Set(inventory.protectedContainers);
  const containers = inventory.containers.filter(container =>
    container.project === inventory.project && container.state === 'exited'
    && container.operationTerminal === true && !protectedContainers.has(container.id)
    && !protectedImages.has(container.image));
  const removing = new Set(containers.map(container => container.id));
  for (const container of inventory.containers) {
    if (!removing.has(container.id)) protectedImages.add(container.image);
  }
  return {
    containers: containers.map(container => container.id).sort(),
    images: inventory.images.filter(image => image.project === inventory.project && !protectedImages.has(image.id)
      && Number.isFinite(Date.parse(image.createdAt)) && now - Date.parse(image.createdAt) > 24 * 60 * 60 * 1000)
      .map(image => image.id).sort(),
  };
}

/** The adapter owns the deployment/recovery exclusion lock for this entire call. */
export async function executeStorageCleanup(adapter) {
  const availableBeforeBytes = await adapter.availableBytes();
  const initial = planStorageCleanup(await adapter.snapshot());
  const removed = { containers: [], images: [] };
  for (const kind of ['containers', 'images']) {
    for (const id of initial[kind]) {
      const current = planStorageCleanup(await adapter.snapshot());
      if (!current[kind].includes(id)) continue;
      await adapter.record({ event: 'CLEANUP_INTENT', kind, id });
      if (kind === 'containers') await adapter.removeContainer(id);
      else await adapter.removeImage(id);
      removed[kind].push(id);
      await adapter.record({ event: 'CLEANUP_COMPLETED', kind, id });
    }
  }
  const availableBytes = await adapter.availableBytes();
  return { removed, availableBeforeBytes, availableBytes, observedReclaimedBytes: availableBytes - availableBeforeBytes };
}

export async function readStorageProtection(roots, documents = []) {
  const images = new Set();
  const visit = (value, found) => {
    if (typeof value === 'string' && imageId.test(value)) found.add(value);
    else if (Array.isArray(value)) value.forEach(item => visit(item, found));
    else if (value && typeof value === 'object') Object.values(value).forEach(item => visit(item, found));
  };
  const read = async (file, checkpoint = false) => {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error('STORAGE_EVIDENCE_INVALID');
    const found = new Set();
    visit(JSON.parse(await fs.readFile(file, 'utf8')), found);
    if (checkpoint && found.size === 0) throw new Error('STORAGE_EVIDENCE_INVALID');
    for (const id of found) images.add(id);
  };
  const walk = async root => {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const file = path.join(root, entry.name);
      if (entry.isSymbolicLink()) throw new Error('STORAGE_EVIDENCE_SYMLINK');
      if (entry.isDirectory()) await walk(file);
      else if (entry.name.endsWith('.sabrec.json')) await read(file, true);
    }
  };
  for (const root of roots) {
    if ((await fs.lstat(root)).isSymbolicLink()) throw new Error('STORAGE_EVIDENCE_SYMLINK');
    await walk(root);
  }
  for (const file of documents) {
    try { await read(file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return [...images];
}

export async function readTerminalDeployments(roots) {
  const terminal = new Set();
  for (const root of roots) {
    if ((await fs.lstat(root)).isSymbolicLink()) throw new Error('STORAGE_JOURNAL_INVALID');
    for (const file of await fs.readdir(root, { withFileTypes: true })) {
      if (!file.name.endsWith('.journal.jsonl')) continue;
      if (!file.isFile() || file.isSymbolicLink()) throw new Error('STORAGE_JOURNAL_INVALID');
      const absolute = path.join(root, file.name);
      if ((await fs.stat(absolute)).size > 32 * 1024 * 1024) throw new Error('STORAGE_JOURNAL_INVALID');
      const entries = (await fs.readFile(absolute, 'utf8')).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
      let previousHash = null;
      for (const [index, entry] of entries.entries()) {
        const { hash, ...unsigned } = entry;
        if (entry.sequence !== index + 1 || entry.previousHash !== previousHash
          || `${entry.deploymentId}.journal.jsonl` !== file.name
          || createHash('sha256').update(JSON.stringify(unsigned)).digest('hex') !== hash) {
          throw new Error('STORAGE_JOURNAL_INVALID');
        }
        previousHash = hash;
      }
      const last = entries.at(-1);
      if (last && ['COMPLETED', 'ABORTED', 'ROLLED_BACK', 'COMPLETED_WITH_NOTIFICATION_FAILURE'].includes(last.phase)
        && ['deployment-finished', 'preflight-cancelled-before-database-lease'].includes(last.event)) {
        terminal.add(last.deploymentId);
      }
    }
  }
  return terminal;
}

export function dockerStorageAdapter({ project, checkpointRoots, documents, journalRoots = [], protectedImages, auditPath, storageRoot, assertLock }) {
  const docker = async args => {
    await assertLock();
    const result = await exec('docker', args, { maxBuffer: 32 * 1024 * 1024, timeout: 60_000 });
    return result.stdout;
  };
  const inspect = async args => {
    const ids = (await docker(args)).trim().split(/\s+/).filter(Boolean);
    return ids.length ? JSON.parse(await docker(['inspect', ...new Set(ids)])) : [];
  };
  return {
    async snapshot() {
      const evidence = await readStorageProtection(checkpointRoots, documents);
      const terminal = await readTerminalDeployments(journalRoots);
      const containers = await inspect(['ps', '-aq']);
      const ids = (await docker(['image', 'ls', '-q', '--no-trunc'])).trim().split(/\s+/).filter(Boolean);
      const images = ids.length ? JSON.parse(await docker(['image', 'inspect', ...new Set(ids)])) : [];
      return {
        project, evidenceComplete: true, protectedImages: [...evidence, ...protectedImages], protectedContainers: [],
        containers: containers.map(container => ({
          id: container.Id, image: container.Image, state: container.State.Status,
          project: container.Config.Labels?.['com.docker.compose.project'],
          // The controller emits the immutable deployment label; only a validated
          // finalized journal can prove that operation no longer owns this container.
          operationTerminal: terminal.has(container.Config.Labels?.['io.sabalan.deployment.id']),
        })),
        images: images.map(image => ({ id: image.Id, project: image.Config.Labels?.['com.docker.compose.project'], createdAt: image.Created })),
      };
    },
    removeContainer: id => docker(['container', 'rm', id]),
    removeImage: id => docker(['image', 'rm', id]),
    async availableBytes() {
      const stat = await fs.statfs(storageRoot);
      return stat.bavail * stat.bsize;
    },
    async record(event) {
      await assertLock();
      await fs.mkdir(path.dirname(auditPath), { recursive: true, mode: 0o700 });
      const handle = await fs.open(auditPath, 'a', 0o600);
      try { await handle.writeFile(`${JSON.stringify({ at: new Date().toISOString(), project, ...event })}\n`); await handle.sync(); }
      finally { await handle.close(); }
    },
  };
}
