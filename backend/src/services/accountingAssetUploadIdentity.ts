import { createHash } from 'node:crypto';
export function assetUploadIdentity(actorId: string, assetId: string, requestKey: string): string {
  return `asset-upload-${createHash('sha256').update(JSON.stringify([actorId, assetId, requestKey])).digest('hex')}`;
}
type Upload = { bookId: string; sourceEntityId: string; sourceEntityType: string; uploadedBy: string;
  evidenceType: string; contentHash: string; sizeBytes: bigint; mimeType: string };
export function assertMatchingAssetUpload(prior: Upload, input: { bookId: string; assetId: string; actorId: string;
  evidenceType: string; contentHash: string; sizeBytes: bigint; mimeType: string }): void {
  if (prior.bookId !== input.bookId || prior.sourceEntityId !== input.assetId || prior.sourceEntityType !== 'FIXED_ASSET'
    || prior.uploadedBy !== input.actorId || prior.evidenceType !== input.evidenceType || prior.contentHash !== input.contentHash
    || prior.sizeBytes !== input.sizeBytes || prior.mimeType !== input.mimeType) {
    throw new Error('شناسه این درخواست قبلاً برای مدرک متفاوتی استفاده شده است.');
  }
}
