import type { PrismaClient } from '@prisma/client';
import { readPerformancePayload, validatePerformanceVaultEnvironment } from './personnelPerformancePayloadStore';
import { validatePerformanceExportKeyEnvironment } from './personnelPerformanceDisclosureStore';

/** A non-production drill must still use independently held application keys.
 * NODE_ENV=test is isolation, never authority to substitute development keys. */
export function assertIndependentRecoveryApplicationKeys(environment: NodeJS.ProcessEnv = process.env) {
  const vault = validatePerformanceVaultEnvironment(environment);
  const exports = validatePerformanceExportKeyEnvironment(environment);
  return { vaultKeyId: vault.keyId, exportKeyId: exports.keyId };
}

export async function verifyRecoveredApplicationPayloads(client: Pick<PrismaClient, 'performanceEncryptedPayload'>) {
  const identities = assertIndependentRecoveryApplicationKeys();
  const keyring = validatePerformanceVaultEnvironment();
  let cursor: string | undefined;
  let payloads = 0;
  for (;;) {
    const rows = await client.performanceEncryptedPayload.findMany({
      select: { id: true }, orderBy: { id: 'asc' }, take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!rows.length) break;
    for (const row of rows) {
      // Canonical decryption verifies key identity, authenticated AAD and the
      // stored plaintext hash. Plaintext never enters the evidence report.
      await readPerformancePayload<unknown>(client, row.id, keyring);
      payloads += 1;
    }
    cursor = rows[rows.length - 1].id;
  }
  return { ...identities, payloads };
}
