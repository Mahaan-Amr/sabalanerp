import { createHash } from 'node:crypto';

const canonicalize = (value: unknown): unknown => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Audit evidence contains a non-finite number.');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, canonicalize(item)]));
  throw new Error('Audit evidence contains an unsupported value.');
};

export const dispatchRecoveryIntegrityHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');

export type DispatchEvidenceKind =
  | 'APPROVED_PRICING_VERSION'
  | 'FINALIZED_ALLOCATION_REVISION'
  | 'PRICED_ALLOCATION_EVENT'
  | 'ACCOUNTING_CANDIDATE_DECISION'
  | 'WAYBILL_ARTIFACT'
  | 'STATEMENT_ARTIFACT'
  | 'PRINT_HANDOFF'
  | 'GUARD_EXIT'
  | 'STATEMENT_ADJUSTMENT';

export type DispatchEvidenceNode = {
  kind: DispatchEvidenceKind;
  id: string;
  parents: readonly string[];
  evidence: unknown;
  integrityHash: string;
  actorId: string;
  serverTime: string;
  effectiveTime: string | null;
  reason: string | null;
  correlationId: string;
  idempotencyKey: string;
  quantities: readonly { rowId: string; unit: string; value: string }[];
  amounts: readonly { currency: string; value: string }[];
};

export type DispatchEvidenceAudit = {
  aggregateId: string;
  eventType: string;
  actorId: string;
  recordedAt: string;
  reason: string | null;
  correlationId: string;
  idempotencyKey: string;
  sourceHash: string;
  previousHash: string | null;
  eventHash: string;
};

export type DispatchReplayIssueCode =
  | 'MISSING_EVIDENCE'
  | 'DUPLICATE_EVIDENCE'
  | 'BROKEN_EVIDENCE_LINK'
  | 'INTEGRITY_HASH_MISMATCH'
  | 'INCOMPLETE_AUDIT_METADATA'
  | 'AUDIT_CHAIN_BROKEN'
  | 'AUDIT_SOURCE_MISMATCH'
  | 'INVALID_FIXED_POINT';

const parseFixed = (value: string, scale: number): bigint | null => {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || (match[3] ?? '').length > scale) return null;
  const atoms = BigInt(match[2]) * 10n ** BigInt(scale) + BigInt((match[3] ?? '').padEnd(scale, '0') || '0');
  return match[1] ? -atoms : atoms;
};
const fixed = (atoms: bigint, scale: number) => {
  const sign = atoms < 0n ? '-' : '';
  const absolute = atoms < 0n ? -atoms : atoms;
  const base = 10n ** BigInt(scale);
  return `${sign}${absolute / base}.${String(absolute % base).padStart(scale, '0')}`;
};
const validTime = (value: string) => Boolean(value && !Number.isNaN(Date.parse(value)));

const REQUIRED_KINDS: readonly DispatchEvidenceKind[] = [
  'APPROVED_PRICING_VERSION', 'FINALIZED_ALLOCATION_REVISION', 'PRICED_ALLOCATION_EVENT',
  'ACCOUNTING_CANDIDATE_DECISION', 'WAYBILL_ARTIFACT', 'STATEMENT_ARTIFACT',
];
const REQUIRED_PARENT_KINDS: Partial<Record<DispatchEvidenceKind, readonly DispatchEvidenceKind[]>> = {
  FINALIZED_ALLOCATION_REVISION: ['APPROVED_PRICING_VERSION'],
  PRICED_ALLOCATION_EVENT: ['FINALIZED_ALLOCATION_REVISION', 'APPROVED_PRICING_VERSION'],
  ACCOUNTING_CANDIDATE_DECISION: ['FINALIZED_ALLOCATION_REVISION', 'PRICED_ALLOCATION_EVENT'],
  WAYBILL_ARTIFACT: ['ACCOUNTING_CANDIDATE_DECISION'],
  STATEMENT_ARTIFACT: ['ACCOUNTING_CANDIDATE_DECISION'],
  PRINT_HANDOFF: ['WAYBILL_ARTIFACT', 'STATEMENT_ARTIFACT'],
  GUARD_EXIT: ['ACCOUNTING_CANDIDATE_DECISION'],
  STATEMENT_ADJUSTMENT: ['GUARD_EXIT', 'STATEMENT_ARTIFACT'],
};

export const replayDispatchDocumentEvidence = (source: {
  nodes: readonly DispatchEvidenceNode[];
  audits: readonly DispatchEvidenceAudit[];
}) => {
  const issues: Array<{ code: DispatchReplayIssueCode; subjectId: string; detail: string }> = [];
  const nodes = [...source.nodes];
  const byId = new Map<string, DispatchEvidenceNode>();
  for (const node of nodes) {
    if (!node.id || byId.has(node.id)) issues.push({ code: 'DUPLICATE_EVIDENCE', subjectId: node.id, detail: 'Evidence identity is empty or duplicated.' });
    else byId.set(node.id, node);
  }
  for (const kind of REQUIRED_KINDS) {
    if (!nodes.some(node => node.kind === kind)) issues.push({ code: 'MISSING_EVIDENCE', subjectId: kind, detail: `${kind} is required.` });
  }
  const quantityTotals = new Map<string, bigint>();
  const amountTotals = new Map<string, bigint>();
  for (const node of nodes) {
    if (dispatchRecoveryIntegrityHash(node.evidence) !== node.integrityHash) {
      issues.push({ code: 'INTEGRITY_HASH_MISMATCH', subjectId: node.id, detail: 'Canonical evidence hash changed.' });
    }
    if (node.parents.some(parent => !byId.has(parent))) {
      issues.push({ code: 'BROKEN_EVIDENCE_LINK', subjectId: node.id, detail: 'A parent evidence identity is missing.' });
    }
    const parentKinds = new Set(node.parents.map(parent => byId.get(parent)?.kind).filter(Boolean));
    if (REQUIRED_PARENT_KINDS[node.kind]?.some(kind => !parentKinds.has(kind))) {
      issues.push({ code: 'BROKEN_EVIDENCE_LINK', subjectId: node.id, detail: 'The evidence transition has the wrong parent kind.' });
    }
    if (!node.actorId || !validTime(node.serverTime) || !node.correlationId || !node.idempotencyKey
      || (node.effectiveTime !== null && !validTime(node.effectiveTime))) {
      issues.push({ code: 'INCOMPLETE_AUDIT_METADATA', subjectId: node.id, detail: 'Actor, time, correlation, or idempotency evidence is incomplete.' });
    }
    for (const quantity of node.quantities) {
      const atoms = parseFixed(quantity.value, 3);
      if (atoms === null || !quantity.rowId || !quantity.unit) issues.push({ code: 'INVALID_FIXED_POINT', subjectId: node.id, detail: 'Quantity evidence is invalid.' });
      else quantityTotals.set(`${quantity.rowId}:${quantity.unit}`, (quantityTotals.get(`${quantity.rowId}:${quantity.unit}`) ?? 0n) + atoms);
    }
    for (const amount of node.amounts) {
      const atoms = parseFixed(amount.value, 12);
      if (atoms === null || !amount.currency) issues.push({ code: 'INVALID_FIXED_POINT', subjectId: node.id, detail: 'Amount evidence is invalid.' });
      else amountTotals.set(amount.currency, (amountTotals.get(amount.currency) ?? 0n) + atoms);
    }
  }
  const previousByAggregate = new Map<string, string>();
  for (const audit of source.audits) {
    const expectedHash = dispatchRecoveryIntegrityHash({ ...audit, eventHash: undefined });
    const previousHash = previousByAggregate.get(audit.aggregateId) ?? null;
    if (audit.previousHash !== previousHash || audit.eventHash !== expectedHash) {
      issues.push({ code: 'AUDIT_CHAIN_BROKEN', subjectId: audit.aggregateId, detail: 'Audit predecessor or event hash changed.' });
    }
    const evidence = byId.get(audit.aggregateId);
    if (!evidence || evidence.integrityHash !== audit.sourceHash) {
      issues.push({ code: 'AUDIT_SOURCE_MISMATCH', subjectId: audit.aggregateId, detail: 'Audit source hash does not identify replay evidence.' });
    }
    if (!audit.actorId || !audit.eventType || !validTime(audit.recordedAt) || !audit.correlationId || !audit.idempotencyKey) {
      issues.push({ code: 'INCOMPLETE_AUDIT_METADATA', subjectId: audit.aggregateId, detail: 'Audit metadata is incomplete.' });
    }
    previousByAggregate.set(audit.aggregateId, audit.eventHash);
  }
  for (const node of nodes) {
    if (!source.audits.some(audit => audit.aggregateId === node.id && audit.sourceHash === node.integrityHash)) {
      issues.push({ code: 'MISSING_EVIDENCE', subjectId: node.id, detail: 'No hash-bound audit event records this evidence.' });
    }
  }
  return {
    status: issues.length ? 'UNRESOLVED_INCIDENT' as const : 'VERIFIED' as const,
    issues,
    evidenceCount: nodes.length,
    auditCount: source.audits.length,
    quantityTotals: [...quantityTotals.entries()].sort().map(([identity, atoms]) => {
      const separator = identity.lastIndexOf(':');
      return { rowId: identity.slice(0, separator), unit: identity.slice(separator + 1), value: fixed(atoms, 3) };
    }),
    amountTotals: [...amountTotals.entries()].sort().map(([currency, atoms]) => ({ currency, value: fixed(atoms, 12) })),
    reportHash: dispatchRecoveryIntegrityHash({ nodes, audits: source.audits, issues }),
  };
};

export type DispatchArtifactMetadata = {
  id: string;
  waybillId: string;
  storageKey: string;
  byteLength: number;
  sha256: string;
  sourceIntegrityHash: string;
};

export type DispatchArtifactAuditEvent = {
  action: 'RECONCILIATION_COMPLETED' | 'INCIDENT_RECORDED' | 'RESTORATION_COMPLETED' | 'RESTORATION_FAILED'
    | 'QUARANTINE_COMPLETED' | 'QUARANTINE_REJECTED' | 'CLEANUP_COMPLETED' | 'CLEANUP_REJECTED';
  actorId: string;
  correlationId: string;
  idempotencyKey: string;
  occurredAt: string;
  storageKey?: string;
  artifactId?: string;
  reason?: string;
  detail: Readonly<Record<string, unknown>>;
};

type AuditPort = { append(event: DispatchArtifactAuditEvent): Promise<void> };
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export const reconcileDispatchDocumentArtifacts = async (input: {
  actorId: string;
  correlationId: string;
  idempotencyKey: string;
  metadata: readonly DispatchArtifactMetadata[];
  storage: { listKeys(): Promise<readonly string[]>; read(key: string): Promise<Buffer | null> };
  audit: AuditPort;
  now?: Date;
}) => {
  const artifacts: Array<{ artifactId: string; storageKey: string; status: 'HEALTHY' | 'MISSING' | 'CORRUPT'; actualByteLength: number | null; actualSha256: string | null }> = [];
  for (const item of [...input.metadata].sort((left, right) => left.id.localeCompare(right.id))) {
    const bytes = await input.storage.read(item.storageKey);
    const actualSha256 = bytes ? sha256(bytes) : null;
    const status = !bytes ? 'MISSING' as const : bytes.length !== item.byteLength || actualSha256 !== item.sha256 ? 'CORRUPT' as const : 'HEALTHY' as const;
    artifacts.push({ artifactId: item.id, storageKey: item.storageKey, status, actualByteLength: bytes?.length ?? null, actualSha256 });
  }
  const referenced = new Set(input.metadata.map(item => item.storageKey));
  const orphans = (await input.storage.listKeys()).filter(key => !referenced.has(key)).sort()
    .map(storageKey => ({ storageKey, status: 'ORPHAN_CANDIDATE' as const }));
  const occurredAt = (input.now ?? new Date()).toISOString();
  const unresolved = artifacts.filter(item => item.status !== 'HEALTHY');
  await input.audit.append({
    action: 'RECONCILIATION_COMPLETED', actorId: input.actorId, correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey, occurredAt,
    detail: { artifactCount: artifacts.length, healthyCount: artifacts.length - unresolved.length, missingCount: artifacts.filter(item => item.status === 'MISSING').length, corruptCount: artifacts.filter(item => item.status === 'CORRUPT').length, orphanCandidateCount: orphans.length },
  });
  for (const item of unresolved) await input.audit.append({
    action: 'INCIDENT_RECORDED', actorId: input.actorId, correlationId: input.correlationId,
    idempotencyKey: `${input.idempotencyKey}:${item.artifactId}`, occurredAt, artifactId: item.artifactId, storageKey: item.storageKey,
    detail: { status: item.status, expectedByteLength: input.metadata.find(metadata => metadata.id === item.artifactId)!.byteLength, actualByteLength: item.actualByteLength, expectedSha256: input.metadata.find(metadata => metadata.id === item.artifactId)!.sha256, actualSha256: item.actualSha256 },
  });
  for (const orphan of orphans) await input.audit.append({
    action: 'INCIDENT_RECORDED', actorId: input.actorId, correlationId: input.correlationId,
    idempotencyKey: `${input.idempotencyKey}:orphan:${dispatchRecoveryIntegrityHash(orphan.storageKey)}`, occurredAt,
    storageKey: orphan.storageKey, detail: { status: orphan.status },
  });
  return {
    status: unresolved.length || orphans.length ? 'UNRESOLVED_INCIDENT' as const : 'VERIFIED' as const,
    artifacts, orphans,
    reportHash: dispatchRecoveryIntegrityHash({ artifacts, orphans }),
  };
};

export const restoreDispatchDocumentArtifact = async (input: {
  actorId: string;
  reason: string;
  correlationId: string;
  idempotencyKey: string;
  metadata: DispatchArtifactMetadata;
  encryptedBackup: { readOriginal(storageKey: string): Promise<{ bytes: Buffer; recoveryPackageId: string; encrypted: boolean } | null> };
  storage: { writeOriginal(storageKey: string, bytes: Buffer): Promise<void>; read(storageKey: string): Promise<Buffer | null> };
  audit: AuditPort;
  now?: Date;
}) => {
  const occurredAt = (input.now ?? new Date()).toISOString();
  try {
    const backup = await input.encryptedBackup.readOriginal(input.metadata.storageKey);
    if (!backup?.encrypted || backup.bytes.length !== input.metadata.byteLength || sha256(backup.bytes) !== input.metadata.sha256) {
      throw new Error('Encrypted recovery does not contain the original verified artifact bytes.');
    }
    await input.storage.writeOriginal(input.metadata.storageKey, backup.bytes);
    const restored = await input.storage.read(input.metadata.storageKey);
    if (!restored || restored.length !== input.metadata.byteLength || sha256(restored) !== input.metadata.sha256) {
      throw new Error('Restored artifact failed post-write integrity verification.');
    }
    await input.audit.append({ action: 'RESTORATION_COMPLETED', actorId: input.actorId, correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey, occurredAt, artifactId: input.metadata.id, storageKey: input.metadata.storageKey,
      reason: input.reason, detail: { byteLength: restored.length, sha256: input.metadata.sha256, recoveryPackageId: backup.recoveryPackageId } });
    return { status: 'RESTORED' as const, artifactId: input.metadata.id, byteLength: restored.length, sha256: input.metadata.sha256 };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Artifact restoration failed.';
    await input.audit.append({ action: 'RESTORATION_FAILED', actorId: input.actorId, correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey, occurredAt, artifactId: input.metadata.id, storageKey: input.metadata.storageKey,
      reason: input.reason, detail: { error: message } });
    return { status: 'UNRESOLVED_INCIDENT' as const, artifactId: input.metadata.id, reason: message };
  }
};

export const quarantineDispatchDocumentOrphan = async (input: {
  storageKey: string;
  actorId: string;
  reason: string;
  correlationId: string;
  idempotencyKey: string;
  repository: { isReferenced(storageKey: string): Promise<boolean> };
  storage: { quarantine(storageKey: string): Promise<void> };
  audit: AuditPort;
  now?: Date;
}) => {
  const occurredAt = (input.now ?? new Date()).toISOString();
  if (await input.repository.isReferenced(input.storageKey)) {
    await input.audit.append({ action: 'QUARANTINE_REJECTED', actorId: input.actorId, correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey, occurredAt, storageKey: input.storageKey, reason: input.reason,
      detail: { code: 'FILE_IS_REFERENCED' } });
    throw new Error('A referenced dispatch artifact can never be quarantined.');
  }
  await input.storage.quarantine(input.storageKey);
  await input.audit.append({ action: 'QUARANTINE_COMPLETED', actorId: input.actorId, correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey, occurredAt, storageKey: input.storageKey, reason: input.reason, detail: {} });
  return { status: 'QUARANTINED' as const, storageKey: input.storageKey, quarantinedAt: occurredAt };
};

export const cleanupQuarantinedDispatchDocumentOrphan = async (input: {
  storageKey: string;
  quarantinedAt: string;
  actorId: string;
  reason: string;
  correlationId: string;
  idempotencyKey: string;
  now: Date;
  safetyWindowMs: number;
  repository: { isReferenced(storageKey: string): Promise<boolean> };
  storage: { removeQuarantined(storageKey: string): Promise<void> };
  audit: AuditPort;
}) => {
  const occurredAt = input.now.toISOString();
  const referenced = await input.repository.isReferenced(input.storageKey);
  const elapsed = input.now.getTime() - new Date(input.quarantinedAt).getTime();
  if (referenced || !Number.isFinite(elapsed) || elapsed < input.safetyWindowMs) {
    await input.audit.append({ action: 'CLEANUP_REJECTED', actorId: input.actorId, correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey, occurredAt, storageKey: input.storageKey, reason: input.reason,
      detail: { code: referenced ? 'FILE_IS_REFERENCED' : 'SAFETY_WINDOW_ACTIVE', elapsed, safetyWindowMs: input.safetyWindowMs } });
    throw new Error(referenced ? 'A referenced dispatch artifact can never be removed.' : 'The orphan safety window has not elapsed.');
  }
  await input.storage.removeQuarantined(input.storageKey);
  await input.audit.append({ action: 'CLEANUP_COMPLETED', actorId: input.actorId, correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey, occurredAt, storageKey: input.storageKey, reason: input.reason,
    detail: { quarantinedAt: input.quarantinedAt, safetyWindowMs: input.safetyWindowMs } });
  return { status: 'REMOVED' as const, storageKey: input.storageKey, removedAt: occurredAt };
};

export * from './prisma';
