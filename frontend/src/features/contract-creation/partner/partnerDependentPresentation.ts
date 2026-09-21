import type { PartnerTechnicalDraft } from '@sabalanerp/partner-sales-contracts';

type Remainder = Extract<NonNullable<PartnerTechnicalDraft['dependents']>[number], { kind: 'remainder' }>;

export type PartnerRemainderChild = { row: Remainder; depth: number };

/** Projects the canonical dependent graph beneath one primary product without
 * relying on array position. A child can itself own later remainder children. */
export function partnerRemainderChildren(draft: PartnerTechnicalDraft,
  parentProductRowId: string): PartnerRemainderChild[] {
  const remainders = (draft.dependents ?? [])
    .filter((item): item is Remainder => item.kind === 'remainder')
    .slice()
    .sort((left, right) => left.creationOrder - right.creationOrder || left.productRowId.localeCompare(right.productRowId));
  const byParent = new Map<string, Remainder[]>();
  for (const row of remainders) byParent.set(row.sourceProductRowId, [...(byParent.get(row.sourceProductRowId) ?? []), row]);
  const result: PartnerRemainderChild[] = [];
  const seen = new Set<string>();
  const visit = (parentId: string, depth: number) => {
    for (const row of byParent.get(parentId) ?? []) {
      if (seen.has(row.productRowId)) continue;
      seen.add(row.productRowId);
      result.push({ row, depth });
      visit(row.productRowId, depth + 1);
    }
  };
  visit(parentProductRowId, 0);
  return result;
}
