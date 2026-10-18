import { VersionedFilePublication } from './versionedFilePublication';

export type VersionedStagedHiringFile = Readonly<{
  format: 'sabalan-hr-file-stage/v1'; storageName: string; operationId: string;
  originalVersionSha256: string; stagedVersionSha256: string;
  sourceDeletedVersionSha256: string; moveReceiptSha256: string;
}>;

const fail = (): never => { throw Object.assign(new Error('HR_FILE_STAGE_RECEIPT_INVALID'), { code: 'HR_FILE_STAGE_RECEIPT_INVALID' }); };
const sha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const segment = (value: string) => {
  if (typeof value !== 'string' || !/^[^\\/\u0000-\u001f:]{1,255}$/.test(value)
    || value === '.' || value === '..' || value.startsWith('.sabalan-file-')) fail();
  return value;
};
const stagedKey = (storageName: string, operationId: string) => `.deletion-trash/${segment(operationId)}/${segment(storageName)}`;
const assertReceipt = (value: VersionedStagedHiringFile) => {
  const keys = ['format', 'storageName', 'operationId', 'originalVersionSha256', 'stagedVersionSha256',
    'sourceDeletedVersionSha256', 'moveReceiptSha256'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.format !== 'sabalan-hr-file-stage/v1'
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))
    || ![value.originalVersionSha256, value.stagedVersionSha256, value.sourceDeletedVersionSha256, value.moveReceiptSha256].every(sha256)) fail();
  segment(value.storageName); segment(value.operationId);
};

/** Explicit private HR storage adapter. The domain/controller must persist its
 * planned operation before stage, await every actual outcome, retain uncertain
 * receipts and prove actor/native closure before recovery. There is no batch
 * rollback, expired-lease takeover, route activation or erasure certification.
 * Persist these version receipts with cleanup rows before relying on recovery;
 * legacy absolute-path cleanup records cannot be interpreted as these records. */
export function createVersionedHiringFileTransaction(root: string, publication: VersionedFilePublication) {
  if (!(publication instanceof VersionedFilePublication) || !publication.ownsRoot(root)) {
    throw new Error('FILE_VERSION_STORAGE_ROOT_MISMATCH');
  }
  return {
    async stage(storageName: string, operationId: string, originalVersionSha256: string): Promise<VersionedStagedHiringFile> {
      segment(storageName); segment(operationId);
      if (!sha256(originalVersionSha256)) fail();
      const result = await publication.move(storageName, stagedKey(storageName, operationId), originalVersionSha256, null);
      return Object.freeze({ format: 'sabalan-hr-file-stage/v1', storageName, operationId, originalVersionSha256,
        stagedVersionSha256: result.destinationVersionSha256, sourceDeletedVersionSha256: result.sourceVersionSha256,
        moveReceiptSha256: result.receiptSha256 });
    },
    async restore(receipt: VersionedStagedHiringFile) {
      assertReceipt(receipt);
      return publication.move(stagedKey(receipt.storageName, receipt.operationId), receipt.storageName,
        receipt.stagedVersionSha256, receipt.sourceDeletedVersionSha256);
    },
    async commit(receipt: VersionedStagedHiringFile) {
      assertReceipt(receipt);
      const deletedVersionSha256 = await publication.removeUpload(stagedKey(receipt.storageName, receipt.operationId), receipt.stagedVersionSha256);
      // A durable tombstone removes only the current staged copy. Immutable
      // histories, other keys/roots and independent backups require their own
      // complete retained-copy inventory and verified physical erasure owner.
      return { status: 'LIVE_REMOVED_RETAINED_COPIES_PENDING' as const, physicalErasure: 'UNPROVEN' as const,
        deletedVersionSha256 };
    },
  };
}
