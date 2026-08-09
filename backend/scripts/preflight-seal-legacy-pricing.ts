import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  buildLegacyPricingManifest,
  loadLegacyPricingCandidates,
  parseLegacyPricingReviews,
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
if (apply) throw new Error('Legacy sealing apply is disabled until the approved-pricing writer port from issue 259 is present.');

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
  const output = {
    mode: 'DRY_RUN' as const,
    manifest,
    persistedReadinessProjection: manifest.entries.map(entry => ({
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
    manifestHash: manifest.manifestHash,
    sourceContractCount: manifest.sourceContractCount,
    sourceApprovalRecordCount: manifest.sourceApprovalRecordCount,
    sourceRowCount: manifest.sourceRowCount,
    counts: manifest.counts,
  }));
};

run().finally(() => prisma.$disconnect());
