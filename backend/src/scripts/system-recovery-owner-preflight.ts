import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { disconnectDatabase, prisma } from '../lib/prisma';
import { configuredProtectedDatabaseRoleRecovery } from '../services/protectedDatabaseRoleRecovery';
import { RECOVERY_ROOT } from '../services/recoveryRuntime';
import { readSealedRecoveryOwnerInput } from '../services/systemRecoveryOwnerInput';
import { preflightRecoveryOwnerRequest } from '../services/systemRecoveryOwnerPreflight';

/** Producers link a new ciphertext inode into the inbox without replacement;
 * the host flock serializes consumers. Preserve that exact encrypted inode. */
async function quarantine(operationId: string, sealedSha256: string) {
  const source = path.join(RECOVERY_ROOT, 'owner-inbox', operationId + '.json');
  const destinationRoot = path.join(RECOVERY_ROOT, 'owner-rejected');
  await fs.mkdir(destinationRoot, { recursive: true, mode: 0o700 });
  const destination = path.join(destinationRoot, `${operationId}.${sealedSha256}.json`);
  const file = await fs.open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    const existing = await fs.lstat(destination).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    const alreadyLinked = existing?.dev === before.dev && existing.ino === before.ino;
    if (!before.isFile() || before.nlink !== (alreadyLinked ? 2 : 1) || before.size > 32768
      || (existing && !alreadyLinked)
      || crypto.createHash('sha256').update(await file.readFile()).digest('hex') !== sealedSha256) {
      throw new Error('SYSTEM_RECOVERY_PREFLIGHT_CIPHERTEXT_CHANGED');
    }
    const named = await fs.lstat(source);
    if (named.dev !== before.dev || named.ino !== before.ino || named.size !== before.size) {
      throw new Error('SYSTEM_RECOVERY_PREFLIGHT_CIPHERTEXT_CHANGED');
    }
    if (!alreadyLinked) await fs.link(source, destination);
    const [linked, current] = await Promise.all([fs.lstat(destination), fs.lstat(source)]);
    if (linked.dev !== before.dev || linked.ino !== before.ino || current.dev !== before.dev || current.ino !== before.ino) {
      throw new Error('SYSTEM_RECOVERY_PREFLIGHT_CIPHERTEXT_CHANGED');
    }
    await fs.unlink(source);
    for (const directory of [path.dirname(source), destinationRoot]) {
      const descriptor = await fs.open(directory, 'r');
      try { await descriptor.sync(); } finally { await descriptor.close(); }
    }
  } finally { await file.close(); }
}

async function main() {
  const scope = configuredProtectedDatabaseRoleRecovery();
  if (!scope || process.stdin.isTTY || process.platform !== 'linux') throw new Error('SYSTEM_RECOVERY_PREFLIGHT_OWNER_REQUIRED');
  if (!/^pipe:\[\d+\]$/.test(await fs.readlink('/proc/self/fd/0'))) throw new Error('SYSTEM_RECOVERY_OWNER_INPUT_INVALID');
  const [identity] = await prisma.$queryRaw<Array<{ admitted: boolean }>>`
    SELECT current_database() = ${scope.source} AND current_user = session_user AND r.rolsuper AND r.rolcanlogin
      AND d.datdba = r.oid AS admitted
    FROM pg_roles r JOIN pg_database d ON d.datname = current_database() WHERE r.rolname = session_user
  `;
  if (identity?.admitted !== true) throw new Error('SYSTEM_RECOVERY_PREFLIGHT_OWNER_REQUIRED');
  const deadline = setTimeout(() => process.stdin.destroy(new Error('SYSTEM_RECOVERY_OWNER_INPUT_INVALID')), 10_000);
  const sealed = await readSealedRecoveryOwnerInput(process.argv.slice(2), process.stdin, process.env.DEPLOYMENT_ID)
    .finally(() => clearTimeout(deadline));
  const decision = await preflightRecoveryOwnerRequest(prisma, sealed);
  if (decision.admissible) return;
  await quarantine(sealed.request.operationId, sealed.sealedSha256);
  process.exitCode = 75;
}

main().catch(() => {
  console.error('SYSTEM_RECOVERY_OWNER_PREFLIGHT_FAILED');
  process.exitCode = 1;
}).finally(async () => {
  try { await disconnectDatabase(); } catch { process.exitCode = 1; }
});
