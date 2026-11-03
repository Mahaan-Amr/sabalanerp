import type { InquiryBatchResult, PartnerCommand } from '@sabalanerp/partner-sales-contracts';

export type ResponseDraft = { selected: boolean; outcome: 'APPROVED' | 'REJECTED'; amount: string; note: string };
export type ResponseDrafts = Record<string, ResponseDraft>;
type Decision = Extract<PartnerCommand, { type: 'INQUIRY_DECIDE' }>['decisions'][number];

export function settleResponseDrafts(drafts: ResponseDrafts, batch: InquiryBatchResult): ResponseDrafts {
  const next = { ...drafts };
  for (const outcome of batch.outcomes) {
    if (outcome.ok) delete next[outcome.rowId];
    else if (next[outcome.rowId]) next[outcome.rowId] = { ...next[outcome.rowId], selected: false };
  }
  return next;
}

export function exactAmount(text: string): string | null {
  const normalized = text.trim().replace(/[۰-۹]/g, value => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(value)))
    .replace(/[٠-٩]/g, value => String('٠١٢٣٤٥٦٧٨٩'.indexOf(value))).replace(/٫/g, '.');
  // No floating-point conversion, separator guessing, rounding, or currency conversion.
  return normalized.length <= 80 && /^(0|[1-9]\d*)(\.\d+)?$/.test(normalized) ? normalized : null;
}

export function responseDecisions(rows: readonly { rowId: string; revision: number; currency: 'IRR' | 'IRT' }[], drafts: ResponseDrafts):
  { ok: true; decisions: Decision[] } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const decisions: Decision[] = [];
  for (const row of rows) {
    const draft = drafts[row.rowId];
    if (!draft?.selected) continue;
    const note = draft.note.trim();
    if (draft.outcome === 'REJECTED') {
      if (!/[\u0600-\u06ff]/.test(note)) errors[row.rowId] = 'دلیل رد را به فارسی بنویسید.';
      else decisions.push({ rowId: row.rowId, expectedRevision: row.revision, outcome: 'REJECTED', reason: note });
    } else {
      const amount = exactAmount(draft.amount);
      if (amount === null) errors[row.rowId] = 'قیمت هر واحد را با رقم و بدون جداکننده بنویسید.';
      else decisions.push({ rowId: row.rowId, expectedRevision: row.revision, outcome: 'APPROVED',
        wholesaleUnitPrice: { amount, currency: row.currency }, ...(note ? { note } : {}) });
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  if (!decisions.length) return { ok: false, errors: { selection: 'حداقل یک ردیف را انتخاب کنید.' } };
  return { ok: true, decisions };
}
