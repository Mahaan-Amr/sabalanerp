import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';

/** Database rows and files must come from the same quiescent checkpoint. */
export type ArchiveEvidenceReference = { id: string; storageKey: string; contentHash: string; sizeBytes: bigint };
export type ArchiveInspection = {
  id: string; keyHash: string; status: 'PROTECTED' | 'LEGACY_ONLY' | 'MISSING' | 'CORRUPT' | 'CONFLICT' | 'UNSAFE';
};
type Candidate = { state: 'MISSING' | 'UNSAFE' | 'FILE'; hash?: string; size?: bigint };

function keyParts(storageKey: string): string[] | null {
  const normalized = storageKey.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)
      || parts.some(part => !part || part === '.' || part === '..' || part.includes('\0'))) return null;
  return parts;
}

/** Refuse symlinked components; never follow a stored key outside the named root. */
async function inspect(root: string, parts: string[]): Promise<Candidate> {
  let current = path.resolve(root);
  try {
    const resolved = await realpath(current);
    const same = process.platform === 'win32' ? resolved.toLowerCase() === current.toLowerCase() : resolved === current;
    if (!same) return { state: 'UNSAFE' };
  } catch (error: any) { if (error?.code === 'ENOENT') return { state: 'MISSING' }; throw error; }
  for (const part of ['', ...parts]) {
    if (part) current = path.join(current, part);
    let stat;
    try { stat = await lstat(current, { bigint: true }); }
    catch (error: any) { if (error?.code === 'ENOENT') return { state: 'MISSING' }; throw error; }
    if (stat.isSymbolicLink()) return { state: 'UNSAFE' };
    if (current !== path.join(path.resolve(root), ...parts) && !stat.isDirectory()) return { state: 'UNSAFE' };
    if (current === path.join(path.resolve(root), ...parts)) {
      if (!stat.isFile()) return { state: 'UNSAFE' };
      const fd = await open(current, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      try {
        const opened = await fd.stat({ bigint: true });
        if (!opened.isFile() || (process.platform !== 'win32' && stat.dev !== opened.dev) || stat.ino !== opened.ino) return { state: 'UNSAFE' };
        const hash = createHash('sha256');
        for await (const chunk of fd.createReadStream({ autoClose: false })) hash.update(chunk as Buffer);
        const after = await lstat(current, { bigint: true });
        const afterOpen = await fd.stat({ bigint: true });
        if (!after.isFile() || after.isSymbolicLink() || stat.dev !== after.dev || stat.ino !== after.ino
            || stat.size !== after.size || stat.mtimeNs !== after.mtimeNs || stat.ctimeNs !== after.ctimeNs
            || opened.size !== afterOpen.size || opened.mtimeNs !== afterOpen.mtimeNs || opened.ctimeNs !== afterOpen.ctimeNs) return { state: 'UNSAFE' };
        return { state: 'FILE', hash: hash.digest('hex'), size: stat.size };
      } finally { await fd.close(); }
    }
  }
  return { state: 'UNSAFE' };
}

export async function auditArchiveEvidence(references: readonly ArchiveEvidenceReference[], roots: {
  protectedRoot: string; legacyRoot?: string;
}): Promise<{ ready: boolean; counts: Record<ArchiveInspection['status'], number>; items: ArchiveInspection[] }> {
  const items: ArchiveInspection[] = [];
  const counts: Record<ArchiveInspection['status'], number> = { PROTECTED: 0, LEGACY_ONLY: 0, MISSING: 0, CORRUPT: 0, CONFLICT: 0, UNSAFE: 0 };
  for (const row of references) {
    const keyHash = createHash('sha256').update(row.storageKey).digest('hex');
    const parts = keyParts(row.storageKey);
    let status: ArchiveInspection['status'];
    if (!parts || !/^[a-f0-9]{64}$/.test(row.contentHash) || row.sizeBytes < 0n) status = 'UNSAFE';
    else {
      const current = await inspect(roots.protectedRoot, parts);
      const legacy = roots.legacyRoot ? await inspect(roots.legacyRoot, parts) : { state: 'MISSING' } as Candidate;
      if (current.state === 'UNSAFE' || legacy.state === 'UNSAFE') status = 'UNSAFE';
      else if (current.state === 'FILE' && legacy.state === 'FILE' && (current.hash !== legacy.hash || current.size !== legacy.size)) status = 'CONFLICT';
      else if (current.state === 'MISSING' && legacy.state === 'MISSING') status = 'MISSING';
      else if ([current, legacy].some(item => item.state === 'FILE' && (item.hash !== row.contentHash || item.size !== row.sizeBytes))) status = 'CORRUPT';
      else status = current.state === 'FILE' ? 'PROTECTED' : 'LEGACY_ONLY';
    }
    counts[status] += 1;
    items.push({ id: row.id, keyHash, status });
  }
  return { ready: items.every(item => item.status === 'PROTECTED'), counts, items };
}

export type ArchiveMigrationPlan = {
  format: 'sabalan-accounting-archive-plan/v1';
  actionCount: number;
  actions: Array<{ storageKey: string; contentHash: string; sizeBytes: string; referenceIds: string[] }>;
  sha256: string;
};

/** Read-only planning only. No argument or receipt grants production write authority. */
export async function planLegacyArchiveMigration(references: readonly ArchiveEvidenceReference[], roots: {
  protectedRoot: string; legacyRoot: string;
}): Promise<ArchiveMigrationPlan> {
  const inspection = await auditArchiveEvidence(references, roots);
  const blocked = inspection.items.filter(item => !['PROTECTED', 'LEGACY_ONLY'].includes(item.status));
  if (blocked.length) throw Object.assign(new Error('Archive inventory has unresolved evidence.'), { code: 'ARCHIVE_PLAN_BLOCKED' });
  const byKey = new Map<string, { storageKey: string; contentHash: string; sizeBytes: string; referenceIds: string[] }>();
  for (let index = 0; index < references.length; index += 1) {
    const row = references[index];
    if (inspection.items[index].status !== 'LEGACY_ONLY') continue;
    const normalizedKey = row.storageKey.replace(/\\/g, '/');
    const existing = byKey.get(normalizedKey);
    if (existing && (existing.contentHash !== row.contentHash || existing.sizeBytes !== String(row.sizeBytes))) {
      throw Object.assign(new Error('Archive references disagree about the same file.'), { code: 'ARCHIVE_PLAN_BLOCKED' });
    }
    if (existing) existing.referenceIds.push(row.id);
    else byKey.set(normalizedKey, { storageKey: normalizedKey, contentHash: row.contentHash,
      sizeBytes: String(row.sizeBytes), referenceIds: [row.id] });
  }
  const actions = [...byKey.values()].sort((a, b) => a.storageKey < b.storageKey ? -1 : a.storageKey > b.storageKey ? 1 : 0);
  for (const action of actions) action.referenceIds.sort();
  const format = 'sabalan-accounting-archive-plan/v1' as const;
  const sha256 = createHash('sha256').update(JSON.stringify({ format, actions })).digest('hex');
  return { format, actionCount: actions.length, actions, sha256 };
}
