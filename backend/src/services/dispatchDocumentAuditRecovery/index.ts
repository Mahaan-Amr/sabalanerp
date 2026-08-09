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
  authority: DispatchRecoveryAuthority;
};

export type DispatchReplayIssueCode =
  | 'MISSING_EVIDENCE'
  | 'DUPLICATE_EVIDENCE'
  | 'BROKEN_EVIDENCE_LINK'
  | 'INTEGRITY_HASH_MISMATCH'
  | 'INCOMPLETE_AUDIT_METADATA'
  | 'AUDIT_CHAIN_BROKEN'
  | 'AUDIT_SOURCE_MISMATCH'
  | 'INVALID_FIXED_POINT'
  | 'QUANTITY_CONSERVATION_MISMATCH'
  | 'MONEY_CONSERVATION_MISMATCH';

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

export const validateDispatchLifecycleConservation = (input: {
  candidate: { status: string; dispositionAt: string | null; dispositionBy: string | null };
  lifecycle: { requiresPrintHandoff: boolean; hasPrintHandoff: boolean; requiresGuardExit: boolean; hasGuardExit: boolean; requiredAdjustmentIds: readonly string[]; actualAdjustmentIds: readonly string[] };
  quantityWitnesses: readonly { stage: 'ALLOCATION' | 'PRICED' | 'DOCUMENTED' | 'EXIT'; rowId: string; unit: string; value: string }[];
  moneyWitnesses: readonly { stage: 'PRICED' | 'DOCUMENTED'; currency: string; gross: string; discount: string; net: string }[];
  adjustmentWitnesses: readonly { id: string; currency: string; before: string; delta: string; after: string }[];
}) => {
  const issues: Array<{ code: DispatchReplayIssueCode; subjectId: string; detail: string }> = [];
  if (input.candidate.status !== 'ACCEPTED' || !input.candidate.dispositionAt || !input.candidate.dispositionBy) issues.push({ code: 'BROKEN_EVIDENCE_LINK', subjectId: 'CANDIDATE_DISPOSITION', detail: 'Issuance requires an accepted candidate disposition with actor/time.' });
  if (input.lifecycle.requiresPrintHandoff && !input.lifecycle.hasPrintHandoff) issues.push({ code: 'MISSING_EVIDENCE', subjectId: 'PRINT_HANDOFF', detail: 'Required print handoff is missing.' });
  if (input.lifecycle.requiresGuardExit && !input.lifecycle.hasGuardExit) issues.push({ code: 'MISSING_EVIDENCE', subjectId: 'GUARD_EXIT', detail: 'Required Guard exit is missing.' });
  for (const id of input.lifecycle.requiredAdjustmentIds) if (!input.lifecycle.actualAdjustmentIds.includes(id)) issues.push({ code: 'MISSING_EVIDENCE', subjectId: id, detail: 'Posted correction adjustment is missing.' });
  const quantities = new Map<string, Map<string, bigint>>();
  for (const witness of input.quantityWitnesses) {
    const atoms = parseFixed(witness.value, 3); const identity = `${witness.rowId}:${witness.unit}`; const stages = quantities.get(identity) ?? new Map<string, bigint>();
    if (atoms === null || !witness.rowId || !witness.unit || stages.has(witness.stage)) issues.push({ code: atoms === null ? 'INVALID_FIXED_POINT' : 'DUPLICATE_EVIDENCE', subjectId: identity, detail: 'Quantity witness is invalid or duplicated.' });
    else stages.set(witness.stage, atoms);
    quantities.set(identity, stages);
  }
  if (!quantities.size) issues.push({ code: 'MISSING_EVIDENCE', subjectId: 'QUANTITY_CONSERVATION', detail: 'Quantity witnesses are required.' });
  for (const [identity, stages] of quantities) {
    const required = input.lifecycle.requiresGuardExit ? ['ALLOCATION', 'PRICED', 'DOCUMENTED', 'EXIT'] : ['ALLOCATION', 'PRICED', 'DOCUMENTED']; const values = required.map(stage => stages.get(stage));
    if (values.some(value => value === undefined) || values.some(value => value !== values[0])) issues.push({ code: 'QUANTITY_CONSERVATION_MISMATCH', subjectId: identity, detail: 'Allocation, pricing, document, and exit quantities do not conserve.' });
  }
  const money = new Map<string, Map<string, [bigint, bigint, bigint]>>();
  for (const witness of input.moneyWitnesses) {
    const gross = parseFixed(witness.gross, 12); const discount = parseFixed(witness.discount, 12); const net = parseFixed(witness.net, 12);
    if (gross === null || discount === null || net === null || gross - discount !== net) { issues.push({ code: 'MONEY_CONSERVATION_MISMATCH', subjectId: witness.currency, detail: 'Gross-discount-net equation is invalid.' }); continue; }
    const stages = money.get(witness.currency) ?? new Map(); stages.set(witness.stage, [gross, discount, net]); money.set(witness.currency, stages);
  }
  if (!money.size) issues.push({ code: 'MISSING_EVIDENCE', subjectId: 'MONEY_CONSERVATION', detail: 'Money witnesses are required.' });
  for (const [currency, stages] of money) { const priced = stages.get('PRICED'); const documented = stages.get('DOCUMENTED'); if (!priced || !documented || priced.some((value, index) => value !== documented[index])) issues.push({ code: 'MONEY_CONSERVATION_MISMATCH', subjectId: currency, detail: 'Priced and documented money do not conserve.' }); }
  for (const witness of input.adjustmentWitnesses) { const before = parseFixed(witness.before, 12); const delta = parseFixed(witness.delta, 12); const after = parseFixed(witness.after, 12); if (before === null || delta === null || after === null || before + delta !== after) issues.push({ code: 'MONEY_CONSERVATION_MISMATCH', subjectId: witness.id, detail: 'Adjustment before+delta=after equation is invalid.' }); }
  for (const id of input.lifecycle.requiredAdjustmentIds) if (!input.adjustmentWitnesses.some(witness => witness.id === id)) issues.push({ code: 'MISSING_EVIDENCE', subjectId: id, detail: 'Adjustment money witness is missing.' });
  return issues;
};

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
  lifecycle: {
    requiresPrintHandoff: boolean;
    requiresGuardExit: boolean;
    requiredAdjustmentIds: readonly string[];
  };
  conservation: {
    quantityWitnesses: readonly { stage: 'ALLOCATION' | 'PRICED' | 'DOCUMENTED' | 'EXIT'; rowId: string; unit: string; value: string }[];
    moneyWitnesses: readonly { stage: 'PRICED' | 'DOCUMENTED'; currency: string; gross: string; discount: string; net: string }[];
    adjustmentWitnesses: readonly { id: string; currency: string; before: string; delta: string; after: string }[];
  };
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
  if (source.lifecycle.requiresPrintHandoff && !nodes.some(node => node.kind === 'PRINT_HANDOFF')) {
    issues.push({ code: 'MISSING_EVIDENCE', subjectId: 'PRINT_HANDOFF', detail: 'A completed/required print handoff is missing.' });
  }
  if (source.lifecycle.requiresGuardExit && !nodes.some(node => node.kind === 'GUARD_EXIT')) {
    issues.push({ code: 'MISSING_EVIDENCE', subjectId: 'GUARD_EXIT', detail: 'The waybill lifecycle requires Guard exit evidence.' });
  }
  for (const adjustmentId of source.lifecycle.requiredAdjustmentIds) {
    if (!nodes.some(node => node.kind === 'STATEMENT_ADJUSTMENT' && node.id === adjustmentId)) {
      issues.push({ code: 'MISSING_EVIDENCE', subjectId: adjustmentId, detail: 'A posted correction requires its immutable statement adjustment.' });
    }
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
  const quantityByIdentity = new Map<string, Map<string, bigint>>();
  if (!source.conservation.quantityWitnesses.length) issues.push({ code: 'MISSING_EVIDENCE', subjectId: 'QUANTITY_CONSERVATION', detail: 'Quantity conservation witnesses are required.' });
  for (const witness of source.conservation.quantityWitnesses) {
    const atoms = parseFixed(witness.value, 3);
    if (atoms === null || !witness.rowId || !witness.unit) {
      issues.push({ code: 'INVALID_FIXED_POINT', subjectId: witness.rowId, detail: 'Quantity conservation witness is invalid.' });
      continue;
    }
    const identity = `${witness.rowId}:${witness.unit}`;
    const stages = quantityByIdentity.get(identity) ?? new Map<string, bigint>();
    if (stages.has(witness.stage)) issues.push({ code: 'DUPLICATE_EVIDENCE', subjectId: identity, detail: `Duplicate ${witness.stage} quantity witness.` });
    stages.set(witness.stage, atoms);
    quantityByIdentity.set(identity, stages);
  }
  for (const [identity, stages] of quantityByIdentity) {
    const requiredStages = source.lifecycle.requiresGuardExit ? ['ALLOCATION', 'PRICED', 'DOCUMENTED', 'EXIT'] : ['ALLOCATION', 'PRICED', 'DOCUMENTED'];
    const values = requiredStages.map(stage => stages.get(stage));
    if (values.some(value => value === undefined) || values.some(value => value !== values[0])) {
      issues.push({ code: 'QUANTITY_CONSERVATION_MISMATCH', subjectId: identity, detail: 'Allocation, priced, documented, and required exit quantities do not conserve.' });
    }
  }
  const moneyByCurrency = new Map<string, Map<string, { gross: bigint; discount: bigint; net: bigint }>>();
  if (!source.conservation.moneyWitnesses.length) issues.push({ code: 'MISSING_EVIDENCE', subjectId: 'MONEY_CONSERVATION', detail: 'Money conservation witnesses are required.' });
  for (const witness of source.conservation.moneyWitnesses) {
    const gross = parseFixed(witness.gross, 12); const discount = parseFixed(witness.discount, 12); const net = parseFixed(witness.net, 12);
    if (gross === null || discount === null || net === null || gross - discount !== net) {
      issues.push({ code: 'MONEY_CONSERVATION_MISMATCH', subjectId: witness.currency, detail: 'Gross minus discount must equal net at every stage.' });
      continue;
    }
    const stages = moneyByCurrency.get(witness.currency) ?? new Map();
    stages.set(witness.stage, { gross, discount, net }); moneyByCurrency.set(witness.currency, stages);
  }
  for (const [currency, stages] of moneyByCurrency) {
    const priced = stages.get('PRICED'); const documented = stages.get('DOCUMENTED');
    if (!priced || !documented || priced.gross !== documented.gross || priced.discount !== documented.discount || priced.net !== documented.net) {
      issues.push({ code: 'MONEY_CONSERVATION_MISMATCH', subjectId: currency, detail: 'Priced and documented money do not conserve.' });
    }
  }
  for (const witness of source.conservation.adjustmentWitnesses) {
    const before = parseFixed(witness.before, 12); const delta = parseFixed(witness.delta, 12); const after = parseFixed(witness.after, 12);
    if (before === null || delta === null || after === null || before + delta !== after) {
      issues.push({ code: 'MONEY_CONSERVATION_MISMATCH', subjectId: witness.id, detail: 'Adjustment before plus delta must equal after.' });
    }
  }
  for (const adjustmentId of source.lifecycle.requiredAdjustmentIds) if (!source.conservation.adjustmentWitnesses.some(witness => witness.id === adjustmentId)) {
    issues.push({ code: 'MISSING_EVIDENCE', subjectId: adjustmentId, detail: 'Adjustment before/delta/after conservation witness is required.' });
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
    if (!audit.actorId || !audit.eventType || !validTime(audit.recordedAt) || !audit.correlationId || !audit.idempotencyKey
      || !audit.authority.effectiveAuthority || !audit.authority.workspace || !audit.authority.subjectType || !audit.authority.subjectId
      || !audit.authority.sessionId || !audit.authority.deviceId) {
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
    reportHash: dispatchRecoveryIntegrityHash({ nodes, audits: source.audits, lifecycle: source.lifecycle, conservation: source.conservation, issues }),
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

export type DispatchRecoveryAuthority = {
  effectiveAuthority: string;
  workspace: 'ACCOUNTING' | 'SYSTEM_RECOVERY';
  feature: string;
  permission: 'VIEW' | 'EDIT' | 'ADMIN';
  subjectType: string;
  subjectId: string;
  sessionId: string | null;
  deviceId: string | null;
  beforeHash: string | null;
  afterHash: string | null;
};

export type DispatchArtifactAuditEvent = {
  action: 'RECONCILIATION_COMPLETED' | 'INCIDENT_RECORDED' | 'RESTORATION_INTENT_RECORDED' | 'RESTORATION_COMPLETED' | 'RESTORATION_FAILED'
    | 'QUARANTINE_INTENT_RECORDED' | 'QUARANTINE_COMPLETED' | 'QUARANTINE_REJECTED'
    | 'CLEANUP_INTENT_RECORDED' | 'CLEANUP_COMPLETED' | 'CLEANUP_REJECTED';
  actorId: string;
  correlationId: string;
  idempotencyKey: string;
  occurredAt: string;
  storageKey?: string;
  artifactId?: string;
  reason?: string;
  authority: DispatchRecoveryAuthority;
  detail: Readonly<Record<string, unknown>>;
};

type AuditPort = { append(event: DispatchArtifactAuditEvent): Promise<void>; hasCompletedRestoration?(artifactId: string, idempotencyKey: string): Promise<boolean> };
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export const reconcileDispatchDocumentArtifacts = async (input: {
  actorId: string;
  correlationId: string;
  idempotencyKey: string;
  metadata: readonly DispatchArtifactMetadata[];
  storage: { listKeys(): Promise<readonly string[]>; read(key: string): Promise<Buffer | null> };
  audit: AuditPort;
  authority: DispatchRecoveryAuthority;
  now?: Date;
}) => {
  const occurredAt = (input.now ?? new Date()).toISOString();
  const artifacts: Array<{ artifactId: string; storageKey: string; status: 'HEALTHY' | 'MISSING' | 'CORRUPT'; actualByteLength: number | null; actualSha256: string | null }> = [];
  for (const item of [...input.metadata].sort((left, right) => left.id.localeCompare(right.id))) {
    const bytes = await input.storage.read(item.storageKey);
    const actualSha256 = bytes ? sha256(bytes) : null;
    const status = !bytes ? 'MISSING' as const : bytes.length !== item.byteLength || actualSha256 !== item.sha256 ? 'CORRUPT' as const : 'HEALTHY' as const;
    artifacts.push({ artifactId: item.id, storageKey: item.storageKey, status, actualByteLength: bytes?.length ?? null, actualSha256 });
  }
  const referenced = new Set(input.metadata.map(item => item.storageKey));
  const orphans = [] as Array<{ storageKey: string; status: 'ORPHAN_CANDIDATE'; observedByteLength: number; observedSha256: string; observedAt: string }>;
  for (const storageKey of (await input.storage.listKeys()).filter(key => !referenced.has(key)).sort()) {
    const bytes = await input.storage.read(storageKey);
    if (bytes) orphans.push({ storageKey, status: 'ORPHAN_CANDIDATE', observedByteLength: bytes.length, observedSha256: sha256(bytes), observedAt: occurredAt });
  }
  const unresolved = artifacts.filter(item => item.status !== 'HEALTHY');
  const reportHash = dispatchRecoveryIntegrityHash({ artifacts, orphans, observedAt: occurredAt });
  await input.audit.append({
    action: 'RECONCILIATION_COMPLETED', actorId: input.actorId, correlationId: input.correlationId,
    authority: input.authority,
    idempotencyKey: input.idempotencyKey, occurredAt,
    detail: { reportHash, observedAt: occurredAt, artifacts, orphans, artifactCount: artifacts.length, healthyCount: artifacts.length - unresolved.length, missingCount: artifacts.filter(item => item.status === 'MISSING').length, corruptCount: artifacts.filter(item => item.status === 'CORRUPT').length, orphanCandidateCount: orphans.length },
  });
  for (const item of unresolved) await input.audit.append({
    action: 'INCIDENT_RECORDED', actorId: input.actorId, correlationId: input.correlationId,
    authority: input.authority,
    idempotencyKey: `${input.idempotencyKey}:${item.artifactId}`, occurredAt, artifactId: item.artifactId, storageKey: item.storageKey,
    detail: { status: item.status, expectedByteLength: input.metadata.find(metadata => metadata.id === item.artifactId)!.byteLength, actualByteLength: item.actualByteLength, expectedSha256: input.metadata.find(metadata => metadata.id === item.artifactId)!.sha256, actualSha256: item.actualSha256 },
  });
  for (const orphan of orphans) await input.audit.append({
    action: 'INCIDENT_RECORDED', actorId: input.actorId, correlationId: input.correlationId,
    authority: input.authority,
    idempotencyKey: `${input.idempotencyKey}:orphan:${dispatchRecoveryIntegrityHash(orphan.storageKey)}`, occurredAt,
    storageKey: orphan.storageKey, detail: { status: orphan.status },
  });
  return {
    status: unresolved.length || orphans.length ? 'UNRESOLVED_INCIDENT' as const : 'VERIFIED' as const,
    artifacts, orphans,
    reportHash,
  };
};

export const restoreDispatchDocumentArtifact = async (input: {
  actorId: string;
  reason: string;
  correlationId: string;
  idempotencyKey: string;
  metadata: DispatchArtifactMetadata;
  encryptedBackup: { readOriginal(storageKey: string): Promise<{ bytes: Buffer; recoveryPackageId: string; encrypted: boolean } | null> };
  storage: { recoverInterruptedWrite(storageKey: string, completed: boolean): Promise<void>; stageOriginal(storageKey: string, bytes: Buffer): Promise<void>; commitStagedOriginal(storageKey: string): Promise<void>; markStagedOriginalCompleted(storageKey: string): Promise<void>; finalizeStagedOriginal(storageKey: string): Promise<void>; read(storageKey: string): Promise<Buffer | null>; restorePrevious(storageKey: string, bytes: Buffer | null): Promise<void> };
  audit: AuditPort;
  authority: DispatchRecoveryAuthority;
  now?: Date;
}) => {
  const occurredAt = (input.now ?? new Date()).toISOString();
  let previous: Buffer | null = null;
  let mutated = false;
  try {
    const backup = await input.encryptedBackup.readOriginal(input.metadata.storageKey);
    if (!backup?.encrypted || backup.bytes.length !== input.metadata.byteLength || sha256(backup.bytes) !== input.metadata.sha256) {
      throw new Error('Encrypted recovery does not contain the original verified artifact bytes.');
    }
    await input.storage.recoverInterruptedWrite(input.metadata.storageKey, await input.audit.hasCompletedRestoration?.(input.metadata.id, input.idempotencyKey) ?? false);
    previous = await input.storage.read(input.metadata.storageKey);
    await input.audit.append({ action: 'RESTORATION_INTENT_RECORDED', actorId: input.actorId, correlationId: input.correlationId,
      authority: input.authority, idempotencyKey: input.idempotencyKey, occurredAt, artifactId: input.metadata.id,
      storageKey: input.metadata.storageKey, reason: input.reason, detail: { expectedByteLength: input.metadata.byteLength, expectedSha256: input.metadata.sha256, recoveryPackageId: backup.recoveryPackageId } });
    mutated = true;
    await input.storage.stageOriginal(input.metadata.storageKey, backup.bytes);
    await input.storage.commitStagedOriginal(input.metadata.storageKey);
    const restored = await input.storage.read(input.metadata.storageKey);
    if (!restored || restored.length !== input.metadata.byteLength || sha256(restored) !== input.metadata.sha256) {
      throw new Error('Restored artifact failed post-write integrity verification.');
    }
    await input.audit.append({ action: 'RESTORATION_COMPLETED', actorId: input.actorId, correlationId: input.correlationId,
      authority: input.authority,
      idempotencyKey: input.idempotencyKey, occurredAt, artifactId: input.metadata.id, storageKey: input.metadata.storageKey,
      reason: input.reason, detail: { byteLength: restored.length, sha256: input.metadata.sha256, recoveryPackageId: backup.recoveryPackageId } });
    let cleanupWarning: string | null = null;
    try {
      await input.storage.markStagedOriginalCompleted(input.metadata.storageKey);
      await input.storage.finalizeStagedOriginal(input.metadata.storageKey);
    } catch (cleanupError) {
      cleanupWarning = cleanupError instanceof Error ? cleanupError.message : 'Restoration cleanup failed.';
      await input.audit.append({ action: 'INCIDENT_RECORDED', actorId: input.actorId, correlationId: input.correlationId,
        authority: input.authority, idempotencyKey: `${input.idempotencyKey}:cleanup-warning`, occurredAt, artifactId: input.metadata.id,
        storageKey: input.metadata.storageKey, reason: input.reason, detail: { code: 'RESTORATION_COMPLETED_CLEANUP_PENDING', cleanupWarning } }).catch(() => undefined);
    }
    return { status: 'RESTORED' as const, artifactId: input.metadata.id, byteLength: restored.length, sha256: input.metadata.sha256, cleanupWarning };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Artifact restoration failed.';
    const completionDurable = await input.audit.hasCompletedRestoration?.(input.metadata.id, input.idempotencyKey).catch(() => false) ?? false;
    if (completionDurable) {
      await input.storage.recoverInterruptedWrite(input.metadata.storageKey, true).catch(() => undefined);
      await input.audit.append({ action: 'INCIDENT_RECORDED', actorId: input.actorId, correlationId: input.correlationId,
        authority: input.authority, idempotencyKey: `${input.idempotencyKey}:ambiguous-completion`, occurredAt, artifactId: input.metadata.id,
        storageKey: input.metadata.storageKey, reason: input.reason, detail: { code: 'RESTORATION_COMPLETION_DURABLE_AFTER_AMBIGUOUS_RESPONSE', warning: message } }).catch(() => undefined);
      return { status: 'RESTORED' as const, artifactId: input.metadata.id, byteLength: input.metadata.byteLength, sha256: input.metadata.sha256, cleanupWarning: message };
    }
    let compensationError: string | null = null;
    if (mutated) try { await input.storage.restorePrevious(input.metadata.storageKey, previous); } catch (compensation) { compensationError = compensation instanceof Error ? compensation.message : 'Restore compensation failed.'; }
    await input.audit.append({ action: 'RESTORATION_FAILED', actorId: input.actorId, correlationId: input.correlationId,
      authority: input.authority,
      idempotencyKey: input.idempotencyKey, occurredAt, artifactId: input.metadata.id, storageKey: input.metadata.storageKey,
      reason: input.reason, detail: { error: message, compensationError } });
    return { status: 'UNRESOLVED_INCIDENT' as const, artifactId: input.metadata.id, reason: message, compensationError };
  }
};

export const quarantineDispatchDocumentOrphan = async (input: {
  storageKey: string;
  actorId: string;
  reason: string;
  correlationId: string;
  idempotencyKey: string;
  authority: DispatchRecoveryAuthority;
  repository: { isReferenced(storageKey: string): Promise<boolean>; readPersistedOrphanEvidence(storageKey: string): Promise<{ reportHash: string; observedAt: string; observedByteLength: number; observedSha256: string } | null> };
  storage: { read(storageKey: string): Promise<Buffer | null>; quarantine(storageKey: string): Promise<void>; restoreQuarantined(storageKey: string): Promise<void> };
  audit: AuditPort;
  now?: Date;
}) => {
  const occurredAt = (input.now ?? new Date()).toISOString();
  const orphanEvidence = await input.repository.readPersistedOrphanEvidence(input.storageKey);
  const current = await input.storage.read(input.storageKey);
  const stale = Boolean(orphanEvidence && (!current || current.length !== orphanEvidence.observedByteLength || sha256(current) !== orphanEvidence.observedSha256));
  if (await input.repository.isReferenced(input.storageKey) || !orphanEvidence || stale) {
    await input.audit.append({ action: 'QUARANTINE_REJECTED', actorId: input.actorId, correlationId: input.correlationId,
      authority: input.authority,
      idempotencyKey: input.idempotencyKey, occurredAt, storageKey: input.storageKey, reason: input.reason,
      detail: { code: stale ? 'ORPHAN_EVIDENCE_STALE_OR_KEY_REUSED' : orphanEvidence ? 'FILE_IS_REFERENCED' : 'PERSISTED_ORPHAN_EVIDENCE_MISSING' } });
    throw new Error(stale ? 'The orphan storage key changed or was reused after reconciliation.' : orphanEvidence ? 'A referenced dispatch artifact can never be quarantined.' : 'Persisted reconciliation does not prove this storage key is an orphan.');
  }
  await input.audit.append({ action: 'QUARANTINE_INTENT_RECORDED', actorId: input.actorId, correlationId: input.correlationId,
    authority: input.authority, idempotencyKey: input.idempotencyKey, occurredAt, storageKey: input.storageKey, reason: input.reason,
    detail: { reconciliationReportHash: orphanEvidence.reportHash, observedAt: orphanEvidence.observedAt } });
  await input.storage.quarantine(input.storageKey);
  try {
    await input.audit.append({ action: 'QUARANTINE_COMPLETED', actorId: input.actorId, correlationId: input.correlationId,
      authority: input.authority, idempotencyKey: input.idempotencyKey, occurredAt, storageKey: input.storageKey, reason: input.reason,
      detail: { quarantinedAt: occurredAt, reconciliationReportHash: orphanEvidence.reportHash, observedAt: orphanEvidence.observedAt } });
  } catch (error) {
    let compensationError: string | null = null;
    try { await input.storage.restoreQuarantined(input.storageKey); } catch (compensation) { compensationError = compensation instanceof Error ? compensation.message : 'Quarantine compensation failed.'; }
    await input.audit.append({ action: 'INCIDENT_RECORDED', actorId: input.actorId, correlationId: input.correlationId,
      authority: input.authority, idempotencyKey: `${input.idempotencyKey}:compensated`, occurredAt, storageKey: input.storageKey,
      reason: input.reason, detail: { code: compensationError ? 'QUARANTINE_AUDIT_AND_COMPENSATION_FAILED' : 'QUARANTINE_AUDIT_FAILED_AND_STORAGE_RESTORED', compensationError } });
    throw error;
  }
  return { status: 'QUARANTINED' as const, storageKey: input.storageKey, quarantinedAt: occurredAt };
};

export const DISPATCH_ORPHAN_MIN_SAFETY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const cleanupQuarantinedDispatchDocumentOrphan = async (input: {
  storageKey: string;
  actorId: string;
  reason: string;
  correlationId: string;
  idempotencyKey: string;
  now: Date;
  authority: DispatchRecoveryAuthority;
  repository: { isReferenced(storageKey: string): Promise<boolean>; readQuarantineEvidence(storageKey: string): Promise<{ quarantinedAt: string; reconciliationReportHash: string } | null> };
  storage: { stageCleanup(storageKey: string): Promise<void>; restoreStagedCleanup(storageKey: string): Promise<void>; finalizeCleanup(storageKey: string): Promise<void> };
  audit: AuditPort;
}) => {
  const occurredAt = input.now.toISOString();
  const referenced = await input.repository.isReferenced(input.storageKey);
  const quarantineEvidence = await input.repository.readQuarantineEvidence(input.storageKey);
  const elapsed = quarantineEvidence ? input.now.getTime() - new Date(quarantineEvidence.quarantinedAt).getTime() : Number.NaN;
  if (referenced || !quarantineEvidence || !Number.isFinite(elapsed) || elapsed < DISPATCH_ORPHAN_MIN_SAFETY_WINDOW_MS) {
    await input.audit.append({ action: 'CLEANUP_REJECTED', actorId: input.actorId, correlationId: input.correlationId,
      authority: input.authority,
      idempotencyKey: input.idempotencyKey, occurredAt, storageKey: input.storageKey, reason: input.reason,
      detail: { code: referenced ? 'FILE_IS_REFERENCED' : !quarantineEvidence ? 'QUARANTINE_EVIDENCE_MISSING' : 'SAFETY_WINDOW_ACTIVE', elapsed, safetyWindowMs: DISPATCH_ORPHAN_MIN_SAFETY_WINDOW_MS } });
    throw new Error(referenced ? 'A referenced dispatch artifact can never be removed.' : 'The orphan safety window has not elapsed.');
  }
  await input.audit.append({ action: 'CLEANUP_INTENT_RECORDED', actorId: input.actorId, correlationId: input.correlationId,
    authority: input.authority, idempotencyKey: input.idempotencyKey, occurredAt, storageKey: input.storageKey, reason: input.reason,
    detail: { quarantinedAt: quarantineEvidence.quarantinedAt, reconciliationReportHash: quarantineEvidence.reconciliationReportHash, safetyWindowMs: DISPATCH_ORPHAN_MIN_SAFETY_WINDOW_MS } });
  await input.storage.stageCleanup(input.storageKey);
  try {
    await input.audit.append({ action: 'CLEANUP_COMPLETED', actorId: input.actorId, correlationId: input.correlationId,
      authority: input.authority, idempotencyKey: input.idempotencyKey, occurredAt, storageKey: input.storageKey, reason: input.reason,
      detail: { quarantinedAt: quarantineEvidence.quarantinedAt, reconciliationReportHash: quarantineEvidence.reconciliationReportHash, safetyWindowMs: DISPATCH_ORPHAN_MIN_SAFETY_WINDOW_MS } });
  } catch (error) {
    let compensationError: string | null = null;
    try { await input.storage.restoreStagedCleanup(input.storageKey); } catch (compensation) { compensationError = compensation instanceof Error ? compensation.message : 'Cleanup compensation failed.'; }
    await input.audit.append({ action: 'INCIDENT_RECORDED', actorId: input.actorId, correlationId: input.correlationId,
      authority: input.authority, idempotencyKey: `${input.idempotencyKey}:compensated`, occurredAt, storageKey: input.storageKey,
      reason: input.reason, detail: { code: compensationError ? 'CLEANUP_AUDIT_AND_COMPENSATION_FAILED' : 'CLEANUP_AUDIT_FAILED_AND_STORAGE_RESTORED', compensationError } });
    throw error;
  }
  try {
    await input.storage.finalizeCleanup(input.storageKey);
  } catch (error) {
    await input.audit.append({ action: 'INCIDENT_RECORDED', actorId: input.actorId, correlationId: input.correlationId,
      authority: input.authority, idempotencyKey: `${input.idempotencyKey}:finalize-failed`, occurredAt, storageKey: input.storageKey,
      reason: input.reason, detail: { code: 'CLEANUP_FINALIZE_FAILED', error: error instanceof Error ? error.message : 'Cleanup finalize failed.' } });
    throw error;
  }
  return { status: 'REMOVED' as const, storageKey: input.storageKey, removedAt: occurredAt };
};

export * from './prisma';
export * from './operations';
