import {
  canonicalHash, CaseDraftIntentSchema, PartnerCaseViewSchema, PartnerCommandSchema,
  PartnerErrorSchema, type PartnerCaseView, type PartnerCommand, type PartnerCommandPort,
} from '@sabalanerp/partner-sales-contracts';

export type PartnerSubmitCommand = Extract<PartnerCommand, { type: 'CASE_SUBMIT' }>;
export type PartnerDraftIntent = PartnerSubmitCommand['intent'];

/** Adapter to the existing creator-private recovery lease. savePending MUST
 * durably checkpoint under that lease before returning; it must reject an old
 * writer. The server Case transaction consumes the same recovery revision and
 * clears server recovery atomically. This is not a second persistence protocol.
 */
export interface PartnerSubmissionRecovery {
  pending: () => PartnerSubmitCommand | null;
  savePending: (command: PartnerSubmitCommand) => Promise<void>;
  clearPending: () => Promise<void>;
  finalizeCommitted: (view: PartnerCaseView) => Promise<void>;
}

export interface PartnerSubmissionState {
  phase: 'editing' | 'submitting' | 'uncertain' | 'created';
  message?: string;
  case?: PartnerCaseView;
  cleanupPending?: boolean;
}

export function createPartnerCaseSubmission({ actorId, commands, recovery }: {
  actorId: string;
  commands: PartnerCommandPort;
  recovery: PartnerSubmissionRecovery;
}) {
  let state: PartnerSubmissionState = { phase: recovery.pending() ? 'uncertain' : 'editing' };
  let flight: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: PartnerSubmissionState) => {
    state = next;
    listeners.forEach(listener => listener());
  };
  const uncertain = () => publish({ phase: 'uncertain', message: 'نتیجه ثبت هنوز مشخص نیست. برای بررسی همان درخواست، دوباره تلاش کنید؛ اطلاعات شما حفظ شده است.' });

  const finalize = async (view: PartnerCaseView) => {
    // Committed truth must survive a failed browser cleanup or detail load.
    publish({ phase: 'created', case: view, cleanupPending: true });
    try {
      await recovery.finalizeCommitted(view);
      publish({ phase: 'created', case: view, cleanupPending: false });
    } catch {
      publish({ phase: 'created', case: view, cleanupPending: true, message: 'پرونده ثبت شده است؛ پاک‌سازی بازیابی این مرورگر نیاز به تلاش دوباره دارد.' });
    }
  };

  const execute = async (command: PartnerSubmitCommand) => {
    publish({ phase: 'submitting' });
    try {
      const parsed = PartnerCommandSchema.parse(command);
      if (parsed.type !== 'CASE_SUBMIT' || parsed.idempotency.actorId !== actorId
        || parsed.idempotency.targetId !== parsed.intent.recoveryId
        || parsed.idempotency.payloadHash !== await canonicalHash({ schemaVersion: 1, type: 'CASE_SUBMIT', intent: parsed.intent })) {
        uncertain(); return;
      }
      command = parsed;
      const result = await commands.execute(command);
      if (!result.ok) {
        const error = PartnerErrorSchema.parse(result.error);
        await recovery.clearPending();
        publish({ phase: 'editing', message: error.message });
        return;
      }
      const view = PartnerCaseViewSchema.safeParse(result.value.case);
      if (result.value.commandId !== command.commandId || !view.success) {
        uncertain();
        return;
      }
      await finalize(view.data);
    } catch {
      uncertain();
    }
  };

  const run = (operation: () => Promise<void>) => {
    if (flight) return flight;
    // Set the lock before yielding to hashing, checkpointing, or transport.
    flight = Promise.resolve().then(operation).finally(() => { flight = null; });
    return flight;
  };

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    submit: (intent: PartnerDraftIntent) => run(async () => {
      if (state.phase === 'created') return;
      if (recovery.pending()) { uncertain(); return; }
      const parsed = CaseDraftIntentSchema.safeParse(intent);
      if (!parsed.success) { publish({ phase: 'editing', message: 'اطلاعات پرونده کامل نیست؛ محصول، مشتری، پرداخت و تحویل را بررسی کنید.' }); return; }
      publish({ phase: 'submitting' });
      try {
        const payloadHash = await canonicalHash({ schemaVersion: 1, type: 'CASE_SUBMIT', intent: parsed.data });
        const identity = crypto.randomUUID();
        const command = PartnerCommandSchema.parse({
          schemaVersion: 1, type: 'CASE_SUBMIT', commandId: identity, correlationId: identity,
          idempotency: { actorId, operation: 'CASE_SUBMIT', targetId: parsed.data.recoveryId, key: identity, payloadHash },
          intent: parsed.data,
        }) as PartnerSubmitCommand;
        await recovery.savePending(command);
        await execute(command);
      } catch {
        if (recovery.pending()) uncertain();
        else publish({ phase: 'editing', message: 'ذخیره امن پیش‌نویس انجام نشد. اطلاعات حفظ شده است؛ اتصال و اختیار ویرایش را بررسی کنید.' });
      }
    }),
    retry: () => run(async () => {
      if (state.phase === 'created') {
        if (state.cleanupPending && state.case) await finalize(state.case);
        return;
      }
      const command = recovery.pending();
      if (command) await execute(command);
    }),
  };
}
