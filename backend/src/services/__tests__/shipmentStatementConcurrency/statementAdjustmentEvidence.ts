import { Prisma } from '@prisma/client';

type ArtifactEvidence = { id: string; sourceIntegrityHash: string } | null;

type PostingEvidence = {
  reason: string;
  adjustmentId: string;
  sequence: number;
  integrityHash: string;
  artifact: ArtifactEvidence;
  commandCount: number;
  commandAdjustmentId: string;
  auditCount: number;
  adjustmentIntegrityVerified: boolean;
  auditIntegrityVerified: boolean;
};

type AdjustmentLineEvidence = {
  contractId: string;
  contractItemId: string;
  productRowId: string;
  quantityDelta: string;
  grossAmountDelta: string;
  discountDelta: string;
  netAmountDelta: string;
  consumesFinalRemainder: boolean;
};

export type StatementAdjustmentRaceEvidence = {
  sequencePosts: PostingEvidence[];
  returnAndReship: Array<PostingEvidence & { line: AdjustmentLineEvidence }>;
  consumedReturnEvidenceCount: number;
};

const invariant: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(`Statement adjustment concurrency invariant failed: ${message}`);
};

export const assertStatementAdjustmentRaceEvidence = (evidence: StatementAdjustmentRaceEvidence) => {
  invariant(evidence.sequencePosts.length === 2, 'expected exactly two sequence posts');
  invariant(evidence.returnAndReship.length === 2, 'expected exactly one verified return and one reship');
  const posts = [...evidence.sequencePosts, ...evidence.returnAndReship].sort((left, right) => left.sequence - right.sequence);
  invariant(posts.every((post, index) => index === 0 || post.sequence === posts[index - 1].sequence + 1),
    'statement adjustment sequences must be contiguous');
  invariant(posts.every((post) => post.commandCount === 1 && post.auditCount === 1),
    'every correction must have exactly one command result and lifecycle audit');
  invariant(posts.every((post) => post.commandAdjustmentId === post.adjustmentId),
    'every command result must identify its exact persisted adjustment');
  invariant(posts.every((post) => post.adjustmentIntegrityVerified && post.auditIntegrityVerified),
    'every adjustment snapshot and lifecycle audit must pass canonical integrity verification');
  invariant(posts.every((post) => post.artifact?.sourceIntegrityHash === post.integrityHash),
    'every adjustment artifact must bind the immutable adjustment integrity hash');
  invariant(new Set(posts.map((post) => post.artifact?.id)).size === posts.length,
    'every adjustment must own a distinct artifact');

  const [firstLine, secondLine] = evidence.returnAndReship.map((item) => item.line);
  invariant(firstLine.contractId === secondLine.contractId
    && firstLine.contractItemId === secondLine.contractItemId
    && firstLine.productRowId === secondLine.productRowId,
  'verified return and reship must retain the same stable pricing attribution');
  const quantity = new Prisma.Decimal(firstLine.quantityDelta).add(secondLine.quantityDelta);
  const gross = new Prisma.Decimal(firstLine.grossAmountDelta).add(secondLine.grossAmountDelta);
  const discount = new Prisma.Decimal(firstLine.discountDelta).add(secondLine.discountDelta);
  const net = new Prisma.Decimal(firstLine.netAmountDelta).add(secondLine.netAmountDelta);
  invariant(quantity.isZero(), 'verified return and reship quantity deltas must net to zero');
  invariant(gross.isZero() && discount.isZero() && net.isZero(),
    'verified return and reship monetary deltas must net to zero');
  invariant(evidence.returnAndReship.filter((item) => item.line.consumesFinalRemainder).length === 1,
    'exactly one serialized return/reship writer must consume the final remainder');
  invariant(evidence.consumedReturnEvidenceCount === 1, 'verified Guard return evidence must be consumed exactly once');

  return {
    sequenceRange: [posts[0].sequence, posts.at(-1)!.sequence],
    artifactCount: posts.length,
    zeroNetQuantity: quantity.toFixed(3),
    zeroNetAmount: net.toFixed(12),
  };
};
