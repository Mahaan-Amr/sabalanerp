import { WHOLESALE_MANDATORY_DEFAULT_PERCENTAGE } from '@sabalanerp/partner-sales-contracts';
import type { InquiryBatchResult, PartnerCommand } from '@sabalanerp/partner-sales-contracts';

export type ResponseDraft = { outcome: 'APPROVED' | 'REJECTED'; amount: string; note: string;
  mandatoryEnabled?: boolean; mandatoryPercentage?: string };
export type ResponseDrafts = Record<string, ResponseDraft>;
type Decision = Extract<PartnerCommand, { type: 'INQUIRY_DECIDE' }>['decisions'][number];

export function settleResponseDrafts(drafts: ResponseDrafts, batch: InquiryBatchResult): ResponseDrafts {
  const next = { ...drafts };
  for (const outcome of batch.outcomes) {
    if (outcome.ok) delete next[outcome.rowId];
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
    if (!draft) continue;
    const note = draft.note.trim();
    if (draft.outcome === 'REJECTED') {
      if (!/[\u0600-\u06ff]/.test(note)) errors[row.rowId] = 'دلیل رد را به فارسی بنویسید.';
      else decisions.push({ rowId: row.rowId, expectedRevision: row.revision, outcome: 'REJECTED', reason: note });
    } else {
      const amount = exactAmount(draft.amount);
      const percentage = exactAmount(draft.mandatoryPercentage ?? WHOLESALE_MANDATORY_DEFAULT_PERCENTAGE);
      if (percentage === null || Number(percentage) > 100) errors[row.rowId] = 'درصد حکمی باید بین صفر و صد باشد.';
      else if (amount === null || !/[1-9]/.test(amount)) errors[row.rowId] = 'قیمت هر واحد باید عددی مثبت باشد.';
      else decisions.push({ rowId: row.rowId, expectedRevision: row.revision, outcome: 'APPROVED',
        wholesaleUnitPrice: { amount, currency: row.currency },
        ...(draft.mandatoryEnabled !== undefined ? { wholesaleMandatory: { enabled: draft.mandatoryEnabled, percentage: percentage! } } : {}) });
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  if (!decisions.length) return { ok: false, errors: { selection: 'پاسخ قیمت حداقل یک ردیف را وارد کنید.' } };
  return { ok: true, decisions };
}
