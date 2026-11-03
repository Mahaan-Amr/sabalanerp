import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  buildLegacyPricingManifest,
  createPrismaLegacyPricingSealWriter,
  loadLegacyPricingCandidates,
  parseLegacyPricingReviews,
  runLegacyPricingSeal,
  toPersistedPricingReadiness,
} from '../src/services/legacyApprovedPricing';

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] ?? null;
  return process.argv.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
};
const apply = process.argv.includes('--apply');
const manifestPath = argument('--manifest') ?? process.env.LEGACY_PRICING_MANIFEST_PATH?.trim() ?? null;
if (!manifestPath) throw new Error('--manifest <path> or LEGACY_PRICING_MANIFEST_PATH is required; preflight never chooses an implicit output location.');

const reviewsPath = argument('--reviews') ?? process.env.LEGACY_PRICING_REVIEWS_PATH?.trim() ?? null;
const prisma = new PrismaClient();

const run = async () => {
  const reviews = reviewsPath
    ? parseLegacyPricingReviews(JSON.parse(await readFile(resolve(reviewsPath), 'utf8')))
    : [];
  const candidates = await prisma.$transaction(
    tx => loadLegacyPricingCandidates(tx, reviews),
    { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 120_000 },
  );
  const manifest = buildLegacyPricingManifest(candidates);
  const sealRun = apply ? await runLegacyPricingSeal(candidates, createPrismaLegacyPricingSealWriter(prisma), {
    recapture: () => prisma.$transaction(
      tx => loadLegacyPricingCandidates(tx, reviews),
      { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 120_000 },
    ),
  }) : null;
  const output = {
    mode: apply ? 'APPLY' as const : 'DRY_RUN' as const,
    status: sealRun?.status ?? 'COMPLETED' as const,
    reason: sealRun?.reason ?? null,
    beforeManifest: sealRun?.beforeManifest ?? manifest,
    afterManifest: sealRun?.afterManifest ?? manifest,
    sourceComparison: sealRun?.sourceComparison ?? { matched: true, differences: [] },
    sealResults: sealRun?.results ?? [],
    outcomeCounts: sealRun?.outcomeCounts ?? { SEALED: 0, REPLAYED: 0 },
    persistedReadinessProjection: (sealRun?.afterManifest ?? manifest).entries.map(entry => ({
      contractId: entry.contractId,
      sourceFinancialRecordId: entry.sourceFinancialRecordId,
      ...toPersistedPricingReadiness(entry),
    })),
    repairInstructions: {
      LEGACY_REVIEW_REQUIRED: 'Verify the exact source hash and add an immutable APPROVE_SEAL review; review never edits pricing.',
      REPAIR_REQUIRED: 'Correct the owning Sales/Accounting source and create a successor valid financial approval.',
      EVIDENCE_CONFLICT: 'Resolve contradictory source identities, amounts, relationships, or hashes before rerunning preflight.',
      STALE: 'Create successor approved evidence and a successor allocation; never refresh an immutable prior binding.',
    },
  };
  const destination = resolve(manifestPath);
  const temporary = `${destination}.tmp`;
  await writeFile(temporary, `${JSON.stringify(output, null, 2)}\n`, { encoding: 'utf8', flag: 'w' });
  await rename(temporary, destination);
  console.log(JSON.stringify({
    mode: output.mode,
    manifestPath: destination,
    status: output.status,
    manifestHash: output.afterManifest.manifestHash,
    sourceContractCount: output.afterManifest.sourceContractCount,
    sourceApprovalRecordCount: output.afterManifest.sourceApprovalRecordCount,
    sourceRowCount: output.afterManifest.sourceRowCount,
    counts: output.afterManifest.counts,
    outcomeCounts: output.outcomeCounts,
  }));
  if (output.status === 'FAILED') process.exitCode = 1;
};

run().finally(() => prisma.$disconnect());
