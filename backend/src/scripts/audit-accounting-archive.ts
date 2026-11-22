import path from 'node:path';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { auditArchiveEvidence, planLegacyArchiveMigration } from './lib/accountingArchiveAudit';

/** Read-only inventory. DATABASE_URL must name the exact matching database snapshot. */
async function main() {
  const args = process.argv.slice(2);
  const payloadFlag = args.indexOf('--payload-root');
  const planMode = args.length === 1 && args[0] === '--plan';
  if (args.length && !planMode && (args.length !== 2 || payloadFlag !== 0 || !path.isAbsolute(args[1]))) {
    throw new Error('Use --plan, --payload-root with an absolute restored checkpoint path, or no arguments.');
  }
  const payloadRoot = payloadFlag === 0 ? path.resolve(args[1]) : null;
  const protectedRoot = payloadRoot
    ? path.join(payloadRoot, 'files', 'accounting-contracts', '.official-reports', 'archive-evidence')
    : path.join(process.cwd(), 'storage', 'accounting-contracts', '.official-reports', 'archive-evidence');
  const legacyRoot = payloadRoot ? undefined : path.join(process.cwd(), 'storage', 'accounting-archive');
  const prisma = new PrismaClient();
  try {
    const references = await prisma.accountingArchiveEvidence.findMany({
      select: { id: true, storageKey: true, contentHash: true, sizeBytes: true }, orderBy: { id: 'asc' },
    });
    if (planMode) {
      const plan = await planLegacyArchiveMigration(references, { protectedRoot, legacyRoot: legacyRoot! });
      process.stdout.write(`${JSON.stringify({ mode: 'DRY_RUN_ONLY', plan: { format: plan.format, sha256: plan.sha256,
        actionCount: plan.actionCount, actions: plan.actions.map(action => ({
          keyHash: createHash('sha256').update(action.storageKey).digest('hex'), contentHash: action.contentHash,
          sizeBytes: action.sizeBytes, referenceCount: action.referenceIds.length,
        })) }, checkpointPairingVerified: false, releaseReady: false })}\n`);
      return;
    }
    const result = await auditArchiveEvidence(references, { protectedRoot, legacyRoot });
    process.stdout.write(`${JSON.stringify({ format: 'sabalan-accounting-archive-audit/v1',
      inspectedAt: new Date().toISOString(), mode: payloadRoot ? 'RESTORED_PAYLOAD' : 'LIVE_READ_ONLY',
      records: references.length, referencesProtected: result.ready, releaseReady: false, counts: result.counts,
      items: result.items.map(({ keyHash, status }) => ({ keyHash, status })),
      checkpointPairingVerified: false,
      notice: 'File checks alone do not prove snapshot pairing, remote durability or restore admission.' })}\n`);
    if (!result.ready) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
void main().catch(() => { process.stderr.write('Accounting archive audit failed; no readiness conclusion was made.\n'); process.exitCode = 1; });
