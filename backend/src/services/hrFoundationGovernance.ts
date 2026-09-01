import { Prisma } from '@prisma/client';

export type FoundationEntityType = 'ORGANIZATIONAL_UNIT' | 'JOB' | 'POSITION' | 'WORKPLACE' | 'COST_CENTER';

export type FoundationDependencyFact = {
  kind: string;
  referenceId: string;
  resolution: 'REQUIRED' | 'SNAPSHOT';
  href: string;
};

export type FoundationDependencyGroup = {
  kind: string;
  count: number;
  href: string;
};

const entityLabelsFa: Record<FoundationEntityType, string> = {
  ORGANIZATIONAL_UNIT: 'واحد سازمانی',
  JOB: 'شغل',
  POSITION: 'جایگاه',
  WORKPLACE: 'محل کار',
  COST_CENTER: 'مرکز هزینه',
};

export const nextFoundationCodeOccurrence = (occurrences: readonly number[]) => (
  occurrences.length ? Math.max(...occurrences) + 1 : 1
);

export const versionedFoundationIdentity = (entityType: FoundationEntityType, code: string, occurrence: number) => (
  `${entityLabelsFa[entityType]} ${code} · نسخه ${occurrence}`
);

export const projectFoundationAtEvent = <T extends Record<string, unknown>>(
  current: T,
  versions: Array<{ version: number; effectiveFrom: Date; afterJson: unknown }>,
  at: Date,
) => {
  const creation = versions.find((version) => version.version === 0)
    ?? versions.find((version) => version.version === 1);
  const base = creation?.afterJson && typeof creation.afterJson === 'object' && !Array.isArray(creation.afterJson)
    ? creation.afterJson as T
    : current;
  return versions
    .filter((version) => version !== creation && version.effectiveFrom <= at && version.afterJson && typeof version.afterJson === 'object' && !Array.isArray(version.afterJson))
    .sort((left, right) => left.effectiveFrom.getTime() - right.effectiveFrom.getTime() || left.version - right.version)
    .reduce<T>((projected, version) => ({ ...projected, ...(version.afterJson as Partial<T>) }), base);
};

const groupDependencies = (facts: FoundationDependencyFact[], resolution: FoundationDependencyFact['resolution']) => {
  const grouped = new Map<string, FoundationDependencyGroup>();
  for (const fact of facts.filter((candidate) => candidate.resolution === resolution)) {
    const key = `${fact.kind}:${fact.href}`;
    const current = grouped.get(key);
    grouped.set(key, current
      ? { ...current, count: current.count + 1 }
      : { kind: fact.kind, count: 1, href: fact.href });
  }
  return [...grouped.values()];
};

export const summarizeFoundationDependencies = (facts: FoundationDependencyFact[]) => {
  const resolvable = groupDependencies(facts, 'REQUIRED');
  const snapshotEligible = groupDependencies(facts, 'SNAPSHOT');
  return { resolvable, snapshotEligible, eligible: resolvable.length === 0 };
};

export type FoundationDefinition = {
  id: string;
  code: string;
  codeOccurrence?: number;
  name?: string;
  title?: string;
  type?: string;
  [key: string]: unknown;
};

export const foundationReferenceSnapshot = (
  entityType: FoundationEntityType,
  definition: FoundationDefinition,
  capturedAt = new Date(),
) => {
  const displayName = definition.name ?? definition.title ?? definition.code;
  return {
    entityType,
    entityId: definition.id,
    code: definition.code,
    codeOccurrence: definition.codeOccurrence ?? 1,
    name: displayName,
    title: displayName,
    displayName,
    definition: { ...definition },
    capturedAt: capturedAt.toISOString(),
  };
};

export const allocateFoundationCodeOccurrence = async (
  client: any,
  input: { entityType: FoundationEntityType; entityId: string; code: string; actorUserId: string; at?: Date },
) => {
  const lockKey = `${input.entityType}:${input.code}`;
  if (typeof client.$executeRaw === 'function') {
    await client.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
  }
  const latest = await client.hrFoundationCodeOccurrence.findFirst({
    where: { entityType: input.entityType, code: input.code },
    orderBy: { occurrence: 'desc' },
    select: { occurrence: true },
  });
  const occurrence = nextFoundationCodeOccurrence(latest ? [latest.occurrence] : []);
  await client.hrFoundationCodeOccurrence.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      code: input.code,
      occurrence,
      assignedByUserId: input.actorUserId,
      assignedAt: input.at ?? new Date(),
    },
  });
  return occurrence;
};

export const releaseFoundationCodeOccurrence = async (
  client: any,
  input: { entityType: FoundationEntityType; entityId: string; code: string; occurrence: number; actorUserId: string; reason: string; at?: Date },
) => client.hrFoundationCodeOccurrence.updateMany({
  where: {
    entityType: input.entityType,
    entityId: input.entityId,
    code: input.code,
    occurrence: input.occurrence,
    releasedAt: null,
  },
  data: {
    releasedAt: input.at ?? new Date(),
    releasedByUserId: input.actorUserId,
    releaseReason: input.reason,
  },
});
