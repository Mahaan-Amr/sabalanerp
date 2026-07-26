export const CONTRACT_RECOVERY_SCHEMA_VERSION = 2;
export const CONTRACT_RECOVERY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface ContractRecoveryScope {
  userId: string;
  draftId: string;
  schemaVersion: number;
  baseRevision: number;
}

export interface ContractRecoveryEnvelope<Payload = unknown> {
  scope: ContractRecoveryScope;
  sequence: number;
  updatedAt: number;
  payload: Payload;
}

export const getContractRecoveryStorageKey = (
  scope: ContractRecoveryScope
): string => [
  'contract-recovery',
  `v${scope.schemaVersion}`,
  scope.userId,
  scope.draftId,
  scope.baseRevision
].join(':');

export const createContractRecoveryEnvelope = <Payload>({
  scope,
  sequence,
  payload,
  now = Date.now()
}: {
  scope: ContractRecoveryScope;
  sequence: number;
  payload: Payload;
  now?: number;
}): ContractRecoveryEnvelope<Payload> => ({
  scope: { ...scope },
  sequence,
  updatedAt: now,
  payload
});

const sameScope = (
  left: ContractRecoveryScope,
  right: ContractRecoveryScope
): boolean => left.userId === right.userId &&
  left.draftId === right.draftId &&
  left.schemaVersion === right.schemaVersion &&
  left.baseRevision === right.baseRevision;

export const parseContractRecoveryEnvelope = <Payload>(
  raw: string | null,
  expectedScope: ContractRecoveryScope,
  now = Date.now()
): ContractRecoveryEnvelope<Payload> | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ContractRecoveryEnvelope<Payload>;
    if (!parsed.scope || !sameScope(parsed.scope, expectedScope)) return null;
    if (!Number.isInteger(parsed.sequence) || parsed.sequence < 0) return null;
    if (!Number.isFinite(parsed.updatedAt)) return null;
    if (now - parsed.updatedAt > CONTRACT_RECOVERY_TTL_MS) return null;
    if (!('payload' in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
};

export const selectNewestContractRecovery = <Payload>(
  local: ContractRecoveryEnvelope<Payload> | null,
  server: ContractRecoveryEnvelope<Payload> | null
): ContractRecoveryEnvelope<Payload> | null => {
  if (!local) return server;
  if (!server) return local;
  if (local.sequence !== server.sequence) {
    return local.sequence > server.sequence ? local : server;
  }
  return local.updatedAt >= server.updatedAt ? local : server;
};
