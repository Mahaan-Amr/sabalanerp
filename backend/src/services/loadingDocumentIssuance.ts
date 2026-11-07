import { createHash } from 'node:crypto';

export type LoadingDocumentPart = {
  candidateId: string;
  revisionId: string;
  state: 'PENDING' | 'RECONSTRUCT' | 'COMPLETE' | 'BLOCKED';
  legacy?: boolean;
  reason?: string;
};

export class LoadingDocumentIssuanceError extends Error {}

export function classifyLoadingDocumentPart(revision: {
  id: string;
  sealedAt: Date | null;
  candidate: null | { id: string; status: string; waybills: Array<{ status: string; documentArtifacts: Array<{ kind: string }>;
    legacyReconstruction?: unknown }> };
}, permittedPath: boolean, legacy = false): LoadingDocumentPart {
  const candidate = revision.candidate;
  const active = candidate?.waybills.filter(waybill => waybill.status === 'ISSUED' || waybill.status === 'EXIT_RECORDED') || [];
  const current = active[0];
  const waybillCount = current?.documentArtifacts.filter(item => item.kind === 'WAYBILL').length || 0;
  const complete = revision.sealedAt && candidate?.status === 'ACCEPTED' && active.length === 1 && current &&
    (legacy ? ((waybillCount === 1 && !current.legacyReconstruction) || (waybillCount === 0 && Boolean(current.legacyReconstruction)))
      : waybillCount === 1 && current.documentArtifacts.filter(item => item.kind === 'STATEMENT').length === 1);
  const state = !permittedPath && !legacy ? 'BLOCKED' : complete ? 'COMPLETE'
    : candidate?.status === 'PENDING' && active.length === 0 && revision.sealedAt ? 'PENDING'
    : legacy && candidate?.status === 'ACCEPTED' && revision.sealedAt && active.length === 1 && waybillCount === 0 && !current?.legacyReconstruction ? 'RECONSTRUCT' : 'BLOCKED';
  return { candidateId: candidate?.id || '', revisionId: revision.id, state, legacy,
    reason: candidate?.status === 'ACCEPTED' && !complete
      ? 'بارنامه قبلی فایل‌های کامل ندارد و به تعیین‌تکلیف اسناد موجود نیاز دارد.'
      : !permittedPath ? 'مسیر صدور فایل اسناد برای این تخصیص فعال نیست؛ ابتدا وضعیت گذار اسناد باید بررسی شود.'
      : 'تخصیص یا بررسی حسابداری یکی از راننده‌ها آماده صدور نیست.' };
}

/** Each command owns its own durable idempotency record. A retry re-reads the
 * authoritative state and never repeats work already committed. */
export async function issueLoadingDocuments(input: {
  loadingId: string;
  parts: LoadingDocumentPart[];
  invoicePredecessorId: string | null;
  issueWaybill(candidateId: string, idempotencyKey: string): Promise<void>;
  reconstructWaybill?(candidateId: string): Promise<void>;
  issueInvoice(idempotencyKey: string): Promise<void>;
}) {
  if (!input.parts.length) throw new LoadingDocumentIssuanceError('تخصیص نهایی رانندگان برای این بارگیری پیدا نشد.');
  const blocked = input.parts.find(part => part.state === 'BLOCKED');
  if (blocked) throw new LoadingDocumentIssuanceError(blocked.reason || 'اسناد بارگیری آماده صدور نیستند؛ وضعیت هر راننده را بررسی کنید.');
  if (new Set(input.parts.map(part => part.candidateId)).size !== input.parts.length ||
      new Set(input.parts.map(part => part.revisionId)).size !== input.parts.length) {
    throw new LoadingDocumentIssuanceError('تخصیص تکراری در بارگیری وجود دارد.');
  }
  const parts = [...input.parts].sort((a, b) => a.revisionId.localeCompare(b.revisionId));
  for (const part of parts) {
    if (part.state === 'PENDING') await input.issueWaybill(part.candidateId, `loading-document:${part.revisionId}`);
    if (part.legacy && (part.state === 'PENDING' || part.state === 'RECONSTRUCT')) {
      if (!input.reconstructWaybill) throw new LoadingDocumentIssuanceError('بازسازی بارنامه قدیمی در دسترس نیست.');
      await input.reconstructWaybill(part.candidateId);
    }
  }
  const identity = createHash('sha256').update(JSON.stringify({ loadingId: input.loadingId,
    revisions: parts.map(part => part.revisionId), predecessor: input.invoicePredecessorId })).digest('hex');
  await input.issueInvoice(`loading-document:${identity}`);
}
