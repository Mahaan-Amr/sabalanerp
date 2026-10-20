import { createHash } from 'node:crypto';
export type RealtimeTarget = Readonly<{ runtimeId: string; nonceSha256: string; releaseId: string; imageIdentity: string }>;
export type RealtimeSource = Readonly<{ kind: 'NOTIFICATION'; sourceId: string; notificationId: string; userId: string }>
  | Readonly<{ kind: 'HR_PERSONNEL_INVALIDATION'; sourceId: string; notificationId: null; userId: null }>;
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function realtimeBatchId(source: RealtimeSource) {
  if (!source.sourceId || source.sourceId.length > 256
    || (source.kind === 'NOTIFICATION' && (!source.notificationId || !source.userId))) throw Error('REALTIME_SOURCE_ID_INVALID');
  return sha(['sabalan-realtime-command/v2', source.kind, source.sourceId, source.notificationId, source.userId]);
}
export function canonicalRealtimeTargets(input: readonly RealtimeTarget[]) {
  if (!input.length || input.length > 1024) throw Error('REALTIME_TARGET_CENSUS_UNPROVEN');
  const sorted = input.map(value => {
    if (!/^[a-f0-9]{64}$/.test(value.runtimeId) || !/^[a-f0-9]{64}$/.test(value.nonceSha256)
      || !/^[A-Za-z0-9_-]{8,128}$/.test(value.releaseId) || !/^sha256:[a-f0-9]{64}$/.test(value.imageIdentity)) throw Error('REALTIME_TARGET_IDENTITY_INVALID');
    return Object.freeze({ runtimeId: value.runtimeId, nonceSha256: value.nonceSha256, releaseId: value.releaseId, imageIdentity: value.imageIdentity });
  }).sort((a, b) => a.runtimeId < b.runtimeId ? -1 : a.runtimeId > b.runtimeId ? 1 : 0);
  if (new Set(sorted.map(value => value.runtimeId)).size !== sorted.length) throw Error('REALTIME_TARGET_CENSUS_DUPLICATE');
  return Object.freeze({ targets: Object.freeze(sorted), sha256: sha(sorted) });
}
export function realtimeCommandId(batchId: string, target: RealtimeTarget) {
  if (!/^[a-f0-9]{64}$/.test(batchId)) throw Error('REALTIME_BATCH_ID_INVALID');
  return sha(['sabalan-realtime-target/v2', batchId, target.runtimeId, target.nonceSha256]);
}
