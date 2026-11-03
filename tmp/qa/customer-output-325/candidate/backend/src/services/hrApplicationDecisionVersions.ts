type VersionedDecision = { kind: string; version: number };

export const latestDecisionsByKind = <T extends VersionedDecision>(decisions: T[]) => {
  const latest = new Map<string, T>();
  for (const decision of decisions) {
    const current = latest.get(decision.kind);
    if (!current || decision.version > current.version) latest.set(decision.kind, decision);
  }
  return latest;
};
