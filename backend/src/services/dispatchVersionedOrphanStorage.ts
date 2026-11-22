import path from 'node:path';
import { createHash } from 'node:crypto';
import { VersionedFilePublication, type VersionedFileRootScope } from './versionedFilePublication';
import { parseDispatchQuarantineFileReceipt, type DispatchQuarantineFileReceipt } from './dispatchQuarantineFileReceipt';

type Roots = { artifacts: string; quarantine: string; cleanup: string; state: string };
type Phase = 'quarantine' | 'cleanup';
type MoveResult = Awaited<ReturnType<VersionedFilePublication['move']>>;
type Intent = { format: 'sabalan-dispatch-file-intent/v1'; operationId: string; storageKey: string; phase: Phase;
  sourceVersionSha256: string; destinationVersionSha256: string | null };
type Receipt = { format: 'sabalan-dispatch-file-result/v1'; intent: Intent; move: MoveResult };
const fail = (code = 'DISPATCH_FILE_OPERATION_UNRESOLVED'): never => { throw Object.assign(new Error(code), { code }); };
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const encode = (value: unknown) => Buffer.from(JSON.stringify(value) + '\n');
const exact = (value: any, keys: string[]) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));

/** Private orphan lifecycle port. Each instance binds one durable command;
 * actual interrupted outcomes stay unresolved until an original-owner closure
 * procedure establishes their disposition. Elapsed time never authorizes retry.
 * Removing a live staged copy is not certification of physical erasure. */
export async function createVersionedDispatchOrphanStorage(input: {
  publication: VersionedFilePublication; roots: Roots; operationId: string;
}) {
  if (!(input.publication instanceof VersionedFilePublication) || !sha(input.operationId)) fail('DISPATCH_FILE_SCOPE_INVALID');
  const { publication, operationId } = input;
  const roots = { ...input.roots };
  const names = ['artifacts', 'quarantine', 'cleanup', 'state'] as const;
  for (const name of names) {
    if (typeof roots[name] !== 'string' || !path.isAbsolute(roots[name]) || path.resolve(roots[name]) !== roots[name]) fail('DISPATCH_FILE_SCOPE_INVALID');
    for (const other of names) {
      if (other === name) continue;
      const relative = path.relative(roots[name], roots[other]);
      if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) fail('DISPATCH_FILE_SCOPE_INVALID');
    }
  }
  const files = {} as Record<typeof names[number], VersionedFileRootScope>;
  for (const name of names) files[name] = await publication.bindRoot(roots[name]);
  const ports = (phase: Phase) => phase === 'quarantine'
    ? [files.artifacts, files.quarantine] as const : [files.quarantine, files.cleanup] as const;
  const recordKey = (phase: Phase, storageKey: string, kind: string, scope = operationId) =>
    scope + '/' + createHash('sha256').update(storageKey).digest('hex') + '/' + phase + '-' + kind + '.json';
  const readRecord = async (phase: Phase, key: string, kind: string, scope = operationId): Promise<any | null> => {
    const selected = recordKey(phase, key, kind, scope), { head, bytes } = await files.state.readSettled(selected, 8192);
    if (head === null) return null;
    if (head.operation !== 'PUT') return fail();
    if (bytes === null) return fail();
    if (bytes.length > 8192) fail();
    let value: unknown;
    try { value = JSON.parse(bytes.toString('utf8')); } catch { return fail(); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
    return value;
  };
  const writeRecord = (phase: Phase, key: string, kind: string, value: unknown) =>
    files.state.publishIfCurrent(recordKey(phase, key, kind), encode(value), null);
  const selection = async (key: string): Promise<{ versionSha256: string } | null> => {
    const value = await readRecord('quarantine', key, 'selection');
    if (value === null) return null;
    if (!exact(value, ['format', 'operationId', 'storageKey', 'versionSha256'])
      || value.format !== 'sabalan-dispatch-file-selection/v1' || value.operationId !== operationId
      || value.storageKey !== key || !sha(value.versionSha256)) return fail();
    return value;
  };
  const receipt = async (phase: Phase, key: string, scope = operationId): Promise<Receipt | null> => {
    const value = await readRecord(phase, key, 'result', scope);
    if (!value) return null;
    if (!exact(value, ['format', 'intent', 'move']) || value.format !== 'sabalan-dispatch-file-result/v1'
      || !exact(value.intent, ['format', 'operationId', 'storageKey', 'phase', 'sourceVersionSha256', 'destinationVersionSha256'])
      || value.intent.format !== 'sabalan-dispatch-file-intent/v1' || value.intent.operationId !== scope
      || value.intent.storageKey !== key || value.intent.phase !== phase || !sha(value.intent.sourceVersionSha256)
      || (value.intent.destinationVersionSha256 !== null && !sha(value.intent.destinationVersionSha256))
      || !exact(value.move, ['sourceVersionSha256', 'destinationVersionSha256', 'receiptSha256'])
      || !Object.values(value.move).every(sha)) fail();
    const intent = await readRecord(phase, key, 'intent', scope);
    if (JSON.stringify(intent) !== JSON.stringify(value.intent)) fail();
    return value;
  };
  const verifyMove = async (source: VersionedFileRootScope, destination: VersionedFileRootScope,
    key: string, result: MoveResult) => {
    const from = await source.inspect(key), to = await destination.inspect(key);
    if (from?.operation !== 'DELETE' || from.versionSha256 !== result.sourceVersionSha256
      || to?.operation !== 'PUT' || to.versionSha256 !== result.destinationVersionSha256) fail();
  };
  const relocate = async (phase: Phase, key: string, expectedSource?: string): Promise<MoveResult> => {
    const [source, destination] = ports(phase);
    if (await readRecord(phase, key, 'undo') || await readRecord(phase, key, 'finalized')) fail();
    const done = await receipt(phase, key);
    if (done) {
      if (expectedSource !== undefined && done.intent.sourceVersionSha256 !== expectedSource) return fail();
      await verifyMove(source, destination, key, done.move); return done.move;
    }
    if (await readRecord(phase, key, 'intent')) fail();
    const from = await source.inspect(key), to = await destination.inspect(key);
    if (from?.operation !== 'PUT' || to?.operation === 'PUT') return fail('DISPATCH_FILE_MOVE_SELECTION_INVALID');
    const checked = phase === 'quarantine' ? await selection(key) : null;
    if (phase === 'quarantine' && !checked) return fail();
    const intent: Intent = { format: 'sabalan-dispatch-file-intent/v1', operationId, storageKey: key, phase,
      sourceVersionSha256: checked?.versionSha256 ?? expectedSource ?? from.versionSha256, destinationVersionSha256: to?.versionSha256 ?? null };
    await writeRecord(phase, key, 'intent', intent);
    const move = await source.moveTo(destination, key, key, intent.sourceVersionSha256, intent.destinationVersionSha256);
    await writeRecord(phase, key, 'result', { format: 'sabalan-dispatch-file-result/v1', intent, move } satisfies Receipt);
    return move;
  };
  const undo = async (phase: Phase, key: string) => {
    if (await readRecord(phase, key, 'undo') || await readRecord(phase, key, 'finalized')) fail();
    const done = await receipt(phase, key); if (!done) return fail();
    const [source, destination] = ports(phase);
    // Both source and destination generations are checked under the actual
    // pair claims. A later delete remains a distinct, protected generation.
    const move = await destination.moveTo(source, key, key, done.move.destinationVersionSha256, done.move.sourceVersionSha256);
    await writeRecord(phase, key, 'undo', { format: 'sabalan-dispatch-file-undo/v1', resultReceiptSha256: done.move.receiptSha256, move });
  };
  return {
    async read(key: string): Promise<Buffer | null> {
      const checked = await selection(key), head = await files.artifacts.inspect(key);
      if (checked && head?.versionSha256 !== checked.versionSha256) return fail('FILE_VERSION_MOVE_SOURCE_CHANGED');
      if (!head || head.operation !== 'PUT') return null;
      const bytes = await files.artifacts.readVersion(key, head.versionSha256);
      if (!bytes) return fail();
      if (!checked) await writeRecord('quarantine', key, 'selection', { format: 'sabalan-dispatch-file-selection/v1',
        operationId, storageKey: key, versionSha256: head.versionSha256 });
      return bytes;
    },
    async quarantine(key: string): Promise<DispatchQuarantineFileReceipt> {
      const move = await relocate('quarantine', key);
      return Object.freeze({ format: 'sabalan-dispatch-quarantine/v1', operationId,
        versionSha256: move.destinationVersionSha256, moveReceiptSha256: move.receiptSha256 });
    },
    restoreQuarantined: (key: string) => undo('quarantine', key),
    async stageCleanup(key: string, evidence?: DispatchQuarantineFileReceipt | null): Promise<void> {
      const authorized = parseDispatchQuarantineFileReceipt(evidence);
      if (!authorized) return fail('DISPATCH_QUARANTINE_VERSION_REQUIRED');
      const original = await receipt('quarantine', key, authorized.operationId);
      if (!original || original.move.destinationVersionSha256 !== authorized.versionSha256
        || original.move.receiptSha256 !== authorized.moveReceiptSha256) return fail('DISPATCH_QUARANTINE_VERSION_REQUIRED');
      await relocate('cleanup', key, authorized.versionSha256);
    },
    restoreStagedCleanup: (key: string) => undo('cleanup', key),
    async finalizeCleanup(key: string): Promise<void> {
      const done = await receipt('cleanup', key); if (!done || await readRecord('cleanup', key, 'undo')) return fail();
      const finalized = await readRecord('cleanup', key, 'finalized');
      if (finalized) {
        if (!exact(finalized, ['format', 'resultReceiptSha256', 'deletedVersionSha256'])
          || finalized.format !== 'sabalan-dispatch-file-finalized/v1'
          || finalized.resultReceiptSha256 !== done.move.receiptSha256 || !sha(finalized.deletedVersionSha256)) fail();
        const current = await files.cleanup.inspect(key), source = await files.quarantine.inspect(key);
        if (current?.operation !== 'DELETE' || current.versionSha256 !== finalized.deletedVersionSha256
          || source?.versionSha256 !== done.move.sourceVersionSha256) fail();
        return;
      }
      await verifyMove(files.quarantine, files.cleanup, key, done.move);
      const deletedVersionSha256 = await files.cleanup.removeUpload(key, done.move.destinationVersionSha256);
      await writeRecord('cleanup', key, 'finalized', { format: 'sabalan-dispatch-file-finalized/v1',
        resultReceiptSha256: done.move.receiptSha256, deletedVersionSha256 });
    },
  };
}
