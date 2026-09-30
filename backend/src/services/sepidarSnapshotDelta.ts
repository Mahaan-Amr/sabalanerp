export type SepidarRowIdentity = Readonly<{ sourceTable: string; sourceKey: string; sourceHash: string }>;
export type SepidarSnapshotDelta = Readonly<{
  added: SepidarRowIdentity[];
  changed: Array<{ before: SepidarRowIdentity; after: SepidarRowIdentity }>;
  removed: SepidarRowIdentity[];
  unchangedCount: number;
}>;

const keyOf = (row: SepidarRowIdentity) => `${row.sourceTable.length}:${row.sourceTable}${row.sourceKey.length}:${row.sourceKey}`;
const compareRows = (left: SepidarRowIdentity, right: SepidarRowIdentity) =>
  left.sourceTable.localeCompare(right.sourceTable) || left.sourceKey.localeCompare(right.sourceKey, 'en', { numeric: true });

/** A new complete backup is immutable. Changes are evidence, never instructions to rewrite target postings. */
export const compareSepidarSnapshots = (before: readonly SepidarRowIdentity[], after: readonly SepidarRowIdentity[]): SepidarSnapshotDelta => {
  const old = new Map<string, SepidarRowIdentity>();
  for (const row of before) {
    const key = keyOf(row);
    if (old.has(key)) throw new Error(`Duplicate source identity in predecessor: ${row.sourceTable}:${row.sourceKey}`);
    old.set(key, row);
  }
  const seen = new Set<string>();
  const added: SepidarRowIdentity[] = [];
  const changed: SepidarSnapshotDelta['changed'] = [];
  let unchangedCount = 0;
  for (const row of after) {
    const key = keyOf(row);
    if (seen.has(key)) throw new Error(`Duplicate source identity in successor: ${row.sourceTable}:${row.sourceKey}`);
    seen.add(key);
    const previous = old.get(key);
    if (!previous) added.push(row);
    else if (previous.sourceHash !== row.sourceHash) changed.push({ before: previous, after: row });
    else unchangedCount++;
  }
  const removed = [...old].filter(([key]) => !seen.has(key)).map(([, row]) => row);
  added.sort(compareRows);
  changed.sort((left, right) => compareRows(left.after, right.after));
  removed.sort(compareRows);
  return { added, changed, removed, unchangedCount };
};
