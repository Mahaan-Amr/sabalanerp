import { promises as fs } from 'node:fs';
import { resolveArchiveReadPath, sha256ArchiveFile } from './accountingArchiveStorage';

type ArchiveScanMetadata = { malwareScanStatus: string | null; malwareScanAt: Date | null };

export function canReadArchiveScanEvidence({ malwareScanStatus, malwareScanAt }: ArchiveScanMetadata) {
  return (malwareScanStatus === 'CLEAN' && malwareScanAt !== null)
    || (malwareScanStatus === null && malwareScanAt === null);
}

type Proof = ArchiveScanMetadata & { id: string; bookId: string; sourceEntityType: string; sourceEntityId: string;
  evidenceType: string;
  storageKey: string; sizeBytes: bigint; contentHash: string };
export async function assertAssetEvidenceFiles(input: { proofs: Proof[]; proofIds: string[]; sourceId: string;
  assetId: string; bookId: string; evidenceType: string; applicationRoot?: string }) {
  if (!input.proofIds.includes(input.sourceId) || new Set(input.proofIds).size !== input.proofIds.length) {
    throw new Error('مدارک باید به منبع همین رویداد مرتبط و بدون تکرار باشند.');
  }
  if (input.proofs.length !== input.proofIds.length || input.proofs.some(item => !input.proofIds.includes(item.id))) {
    throw new Error('مدرک موردنیاز دارایی پیدا نشد.');
  }
  for (const item of input.proofs) {
    if (item.bookId !== input.bookId || item.sourceEntityType !== 'FIXED_ASSET'
      || item.sourceEntityId !== input.assetId || item.evidenceType !== input.evidenceType
      || !canReadArchiveScanEvidence(item)) {
      throw new Error('مدرک معتبر و بررسی‌شدهٔ همین دارایی لازم است.');
    }
    const filePath = await resolveArchiveReadPath(item.storageKey, input.applicationRoot);
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || BigInt(stat.size) !== item.sizeBytes) throw new Error('تمامیت فایل مدرک دارایی تأیید نشد.');
    const digest = await sha256ArchiveFile(filePath);
    if (digest !== item.contentHash) throw new Error('تمامیت فایل مدرک دارایی تأیید نشد.');
  }
}
