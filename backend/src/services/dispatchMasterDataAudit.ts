import crypto from 'node:crypto';

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value instanceof Date ? value.toISOString() : value;
};

export const appendDispatchMasterDataAudit = async (tx: any, input: {
  subjectType: string;
  subjectId: string;
  eventType: string;
  payload: unknown;
  actorId: string;
}) => {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `${input.subjectType}:${input.subjectId}`);
  const previous = await tx.dispatchMasterDataAudit.findFirst({
    where: { subjectType: input.subjectType, subjectId: input.subjectId },
    orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
    select: { eventHash: true },
  });
  const recordedAt = new Date();
  const payload = stableValue(input.payload);
  const eventHash = crypto.createHash('sha256').update(JSON.stringify({
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    eventType: input.eventType,
    payload,
    actorId: input.actorId,
    recordedAt: recordedAt.toISOString(),
    previousHash: previous?.eventHash || null,
  })).digest('hex');
  return tx.dispatchMasterDataAudit.create({ data: {
    ...input,
    payload,
    recordedAt,
    previousHash: previous?.eventHash || null,
    eventHash,
  } });
};
