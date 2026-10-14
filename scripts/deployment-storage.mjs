import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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
  const visit = value => {
    if (typeof value === 'string' && imageId.test(value)) images.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  const read = async file => {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error('STORAGE_EVIDENCE_INVALID');
    visit(JSON.parse(await fs.readFile(file, 'utf8')));
  };
  const walk = async root => {
    const entries = await fs.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const file = path.join(root, entry.name);
      if (entry.isSymbolicLink()) throw new Error('STORAGE_EVIDENCE_SYMLINK');
      if (entry.isDirectory()) await walk(file);
      else if (entry.name.endsWith('.sabrec.json')) await read(file);
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

export function dockerStorageAdapter({ project, checkpointRoots, documents, protectedImages, auditPath, storageRoot, assertLock }) {
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
      const containers = await inspect(['ps', '-aq']);
      const ids = (await docker(['image', 'ls', '-q', '--no-trunc'])).trim().split(/\s+/).filter(Boolean);
      const images = ids.length ? JSON.parse(await docker(['image', 'inspect', ...new Set(ids)])) : [];
      return {
        project, evidenceComplete: true, protectedImages: [...evidence, ...protectedImages], protectedContainers: [],
        containers: containers.map(container => ({
          id: container.Id, image: container.Image, state: container.State.Status,
          project: container.Config.Labels?.['com.docker.compose.project'],
          // Legacy stopped containers with no durable terminal attribution stay protected.
          operationTerminal: container.Config.Labels?.['io.sabalan.operation.terminal'] === 'true',
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
