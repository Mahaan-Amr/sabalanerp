export interface LatestRequestTracker {
  begin(source: string): number;
  isLatest(source: string, sequence: number): boolean;
}

export const createLatestRequestTracker = (): LatestRequestTracker => {
  const sequences = new Map<string, number>();

  return {
    begin(source) {
      const sequence = (sequences.get(source) || 0) + 1;
      sequences.set(source, sequence);
      return sequence;
    },
    isLatest(source, sequence) {
      return sequences.get(source) === sequence;
    },
  };
};

export const hasAnyPendingOperation = (pending: ReadonlySet<string>, sources: readonly string[]): boolean =>
  sources.some((source) => pending.has(source));
