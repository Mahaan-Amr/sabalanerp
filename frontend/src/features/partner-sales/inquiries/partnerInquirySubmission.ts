import { canonicalHash, PartnerCommandSchema, PartnerErrorSchema, type PartnerCommand, type PartnerCommandPort } from '@sabalanerp/partner-sales-contracts';

export type PartnerInquirySubmitCommand = Extract<PartnerCommand, { type: 'INQUIRY_SUBMIT' }>;
export type PartnerConfiguredInquiryRows = PartnerInquirySubmitCommand['rows'];
export interface PartnerInquirySubmissionState {
  phase: 'editing' | 'submitting' | 'uncertain' | 'submitted';
  message?: string;
}
export interface PartnerInquiryRecovery {
  pending: () => PartnerInquirySubmitCommand | null;
  savePending: (command: PartnerInquirySubmitCommand) => Promise<void>;
  clearPending: () => Promise<void>;
}

export function createPartnerInquirySubmission({ commands, actorId, inquiryId, recovery }: {
  commands: PartnerCommandPort; actorId: string; inquiryId: string; recovery: PartnerInquiryRecovery;
}) {
  let state: PartnerInquirySubmissionState = { phase: recovery.pending() ? 'uncertain' : 'editing' };
  let flight: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: PartnerInquirySubmissionState) => { state = next; listeners.forEach(listener => listener()); };
  const uncertain = () => publish({ phase: 'uncertain', message: 'نتیجه ارسال مشخص نیست؛ همان درخواست را دوباره بررسی کنید.' });
  const execute = async (command: PartnerInquirySubmitCommand) => {
    publish({ phase: 'submitting' });
    try {
      const parsed = PartnerCommandSchema.parse(command);
      if (parsed.type !== 'INQUIRY_SUBMIT' || parsed.partnerSellerId !== actorId
        || parsed.idempotency.actorId !== actorId || parsed.idempotency.targetId !== inquiryId
        || parsed.idempotency.payloadHash !== await canonicalHash({ schemaVersion: 1, type: 'INQUIRY_SUBMIT', partnerSellerId: actorId, rows: parsed.rows })) {
        uncertain(); return;
      }
      command = parsed;
      const response = await commands.execute(command);
      if (!response.ok) {
        const error = PartnerErrorSchema.parse(response.error);
        await recovery.clearPending();
        publish({ phase: 'editing', message: error.message }); return;
      }
      if (response.value.commandId !== command.commandId) { uncertain(); return; }
      await recovery.clearPending();
      publish({ phase: 'submitted' });
    } catch { uncertain(); }
  };
  const run = (operation: () => Promise<void>) => {
    if (flight) return flight;
    flight = Promise.resolve().then(operation).finally(() => { flight = null; }); return flight;
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    submit: (rows: PartnerConfiguredInquiryRows) => run(async () => {
      if (recovery.pending()) { uncertain(); return; }
      publish({ phase: 'submitting' });
      try {
        const intent = { schemaVersion: 1, type: 'INQUIRY_SUBMIT', partnerSellerId: actorId, rows: structuredClone(rows) };
        const payloadHash = await canonicalHash(intent);
        // Stable row references and exact intent give reloads the same replay
        // scope; a changed configuration or explicit successor is a new intent.
        const command = PartnerCommandSchema.parse({ ...intent, commandId: payloadHash, correlationId: payloadHash,
          idempotency: { actorId, operation: 'INQUIRY_SUBMIT', targetId: inquiryId, key: payloadHash, payloadHash },
        }) as PartnerInquirySubmitCommand;
        await recovery.savePending(command); await execute(command);
      } catch {
        if (recovery.pending()) uncertain();
        else publish({ phase: 'editing', message: 'ارسال انجام نشد؛ مشخصات محصول و ذخیره امن پیش‌نویس را بررسی کنید.' });
      }
    }),
    retry: () => run(async () => { const pending = recovery.pending(); if (pending) await execute(pending); }),
  };
}
