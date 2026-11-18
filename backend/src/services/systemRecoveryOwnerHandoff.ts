import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { RECOVERY_ROOT } from './recoveryRuntime';
import { assertStrongBackupPassphrase, type RecoveryPackageType } from './systemRecoveryPolicy';

export const OWNER_HANDOFF_REQUESTED = 'RECOVERY_OWNER_HANDOFF_REQUESTED';
export const OWNER_HANDOFF_FORMAT = 'sabalan-system-recovery-owner/v1';
export type RecoveryOwnerRequest = {
  format: typeof OWNER_HANDOFF_FORMAT;
  requestId: string;
  operationId: string;
  actorId: string;
  action: 'BACKUP' | 'RESTORE';
  packageType: RecoveryPackageType;
  passphrase: string;
  checksum?: string;
  approvedById?: string | null;
  approvalExpiresAt?: string | null;
  breakGlassReason?: string;
  confirmationPhrase?: string;
  bootstrapPassword?: string;
};

const invalid = () => new Error('SYSTEM_RECOVERY_OWNER_HANDOFF_INVALID');
const envelope = require('../../scripts/system-recovery-envelope.cjs') as {
  seal(request: RecoveryOwnerRequest, publicKey: string): Buffer;
  open(bytes: Buffer, privateKey: string): unknown;
};
export function parseRecoveryOwnerRequest(value: unknown): RecoveryOwnerRequest {
  const input = value as RecoveryOwnerRequest;
  if (!input || input.format !== OWNER_HANDOFF_FORMAT || !/^[a-f0-9]{64}$/.test(input.requestId)
    || !/^c[a-z0-9]{24}$/.test(input.operationId) || typeof input.actorId !== 'string' || !input.actorId
    || !['BACKUP', 'RESTORE'].includes(input.action) || !['COMPLETE', 'SANITIZED_TEST'].includes(input.packageType)
    || JSON.stringify(input).length > 16384) throw invalid();
  assertStrongBackupPassphrase(input.passphrase);
  if (input.action === 'RESTORE' && !/^[a-f0-9]{64}$/.test(input.checksum || '')) throw invalid();
  return input;
}

/** Only ciphertext crosses the durable inbox. The private key stays on the host. */
export function sealRecoveryOwnerRequest(request: RecoveryOwnerRequest, publicKey: string): Buffer {
  parseRecoveryOwnerRequest(request);
  return envelope.seal(request, publicKey);
}

export function openRecoveryOwnerRequest(bytes: Buffer, privateKey: string): RecoveryOwnerRequest {
  return parseRecoveryOwnerRequest(envelope.open(bytes, privateKey));
}

export async function queueRecoveryOwnerRequest(prisma: PrismaClient,
  input: Omit<RecoveryOwnerRequest, 'format' | 'requestId'>) {
  const publicKeyPath = process.env.SYSTEM_RECOVERY_OWNER_PUBLIC_KEY_FILE;
  if (!publicKeyPath || !path.isAbsolute(publicKeyPath)) throw new Error('SYSTEM_RECOVERY_OWNER_PUBLIC_KEY_REQUIRED');
  const request: RecoveryOwnerRequest = { ...input, format: OWNER_HANDOFF_FORMAT, requestId: crypto.randomBytes(32).toString('hex') };
  const sealed = sealRecoveryOwnerRequest(request, await fs.readFile(publicKeyPath, 'utf8'));
  const checksum = crypto.createHash('sha256').update(sealed).digest('hex');
  const inbox = path.join(RECOVERY_ROOT, 'owner-inbox');
  await fs.mkdir(inbox, { recursive: true, mode: 0o700 });
  const destination = path.join(inbox, input.operationId + '.json');
  const temporary = destination + '.' + request.requestId + '.pending';
  const file = await fs.open(temporary, 'wx', 0o600);
  try { await file.writeFile(sealed); await file.sync(); }
  finally { await file.close(); }
  try {
    await prisma.recoveryAuditEvent.create({ data: { operationId: input.operationId, actorId: input.actorId,
      eventType: OWNER_HANDOFF_REQUESTED, packageChecksum: input.checksum,
      details: { requestId: request.requestId, sealedSha256: checksum, action: input.action, packageType: input.packageType } } });
    await fs.link(temporary, destination);
    await fs.unlink(temporary);
    if (process.platform !== 'win32') {
      const directory = await fs.open(inbox, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}
