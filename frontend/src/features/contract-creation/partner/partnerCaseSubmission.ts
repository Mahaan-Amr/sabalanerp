import {
  canonicalHash, CaseDraftIntentSchema, PartnerCaseViewSchema, PartnerCommandSchema,
  PartnerErrorSchema, isPartnerCaseEditableState, type PartnerCaseView, type PartnerCommand, type PartnerCommandPort,
} from '@sabalanerp/partner-sales-contracts';

export type PartnerSubmitCommand = Extract<PartnerCommand, { type: 'CASE_SUBMIT' }>;
export type PartnerDraftCommand = Extract<PartnerCommand, { type: 'CASE_SUBMIT' | 'CASE_DRAFT_REVISE' }>;
export type PartnerDraftIntent = PartnerSubmitCommand['intent'];

/** Adapter to the existing creator-private recovery lease. savePending MUST
 * durably checkpoint under that lease before returning; it must reject an old
 * writer. The server Case transaction consumes the same recovery revision and
 * clears server recovery atomically. This is not a second persistence protocol.
 */
export interface PartnerSubmissionRecovery {
  pending: () => PartnerDraftCommand | null;
  savePending: (command: PartnerDraftCommand) => Promise<void>;
  clearPending: () => Promise<void>;
  finalizeCommitted: (view: PartnerCaseView) => Promise<void>;
  prepareEditLease: () => Promise<Extract<PartnerDraftCommand, { type: 'CASE_DRAFT_REVISE' }>['editLease']>;
}

export interface PartnerSubmissionState {
  phase: 'editing' | 'submitting' | 'uncertain' | 'created';
  message?: string;
  case?: PartnerCaseView;
  cleanupPending?: boolean;
}

export function createPartnerCaseSubmission({ actorId, commands, recovery, initialCase }: {
  actorId: string;
  commands: PartnerCommandPort;
  recovery: PartnerSubmissionRecovery;
  initialCase?: PartnerCaseView;
}) {
  let state: PartnerSubmissionState = recovery.pending() ? { phase: 'uncertain' }
    : initialCase ? { phase: 'created', case: initialCase } : { phase: 'editing' };
  let flight: Promise<void> | null = null;
  let cleanupInitialSave = false;
  const listeners = new Set<() => void>();
  const publish = (next: PartnerSubmissionState) => {
    state = next;
    listeners.forEach(listener => listener());
  };
  const uncertain = () => publish({ phase: 'uncertain', message: 'نتیجه ثبت هنوز مشخص نیست. برای بررسی همان درخواست، دوباره تلاش کنید؛ اطلاعات شما حفظ شده است.' });

  const finalize = async (view: PartnerCaseView, initialSave: boolean) => {
    // Committed truth must survive a failed browser cleanup or detail load.
    cleanupInitialSave = initialSave;
    publish({ phase: 'created', case: view, cleanupPending: true });
    try {
      if (initialSave) await recovery.finalizeCommitted(view);
      else await recovery.clearPending();
      cleanupInitialSave = false;
      publish({ phase: 'created', case: view, cleanupPending: false });
    } catch {
      publish({ phase: 'created', case: view, cleanupPending: true, message: 'پرونده ثبت شده است؛ پاک‌سازی بازیابی این مرورگر نیاز به تلاش دوباره دارد.' });
    }
  };

  const execute = async (command: PartnerDraftCommand) => {
    publish({ phase: 'submitting' });
    try {
      const parsed = PartnerCommandSchema.parse(command);
      if ((parsed.type !== 'CASE_SUBMIT' && parsed.type !== 'CASE_DRAFT_REVISE') || parsed.idempotency.actorId !== actorId) {
        uncertain(); return;
      }
      if ((parsed.type === 'CASE_SUBMIT' && parsed.idempotency.targetId !== parsed.intent.recoveryId)
        || (parsed.type === 'CASE_DRAFT_REVISE' && parsed.idempotency.targetId !== parsed.expected.caseId)
        || parsed.idempotency.payloadHash !== await canonicalHash({ schemaVersion: 1, type: parsed.type, intent: parsed.intent })) {
        uncertain(); return;
      }
      command = parsed as PartnerDraftCommand;
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
      await finalize(view.data, command.type === 'CASE_SUBMIT');
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
      if (recovery.pending()) { uncertain(); return; }
      const parsed = CaseDraftIntentSchema.safeParse(intent);
      if (!parsed.success) { publish({ phase: 'editing', message: 'اطلاعات پرونده کامل نیست؛ محصول، مشتری، پرداخت و تحویل را بررسی کنید.' }); return; }
      const savedCase = state.phase === 'created' ? state.case : undefined;
      publish({ phase: 'submitting' });
      try {
        const revising = Boolean(savedCase);
        if (savedCase && !isPartnerCaseEditableState(savedCase.state)) {
          publish({ phase: 'created', case: savedCase, message: 'این پرونده دیگر در وضعیت پیش‌نویس قابل ویرایش نیست.' }); return;
        }
        const type = revising ? 'CASE_DRAFT_REVISE' as const : 'CASE_SUBMIT' as const;
        const editLease = savedCase ? await recovery.prepareEditLease() : undefined;
        const payloadHash = await canonicalHash({ schemaVersion: 1, type, intent: parsed.data });
        const identity = crypto.randomUUID();
        const command = PartnerCommandSchema.parse({
          schemaVersion: 1, type, commandId: identity, correlationId: identity,
          ...(savedCase ? { expected: savedCase.owner, expectedState: savedCase.state } : {}),
          ...(editLease ? { editLease } : {}),
          idempotency: { actorId, operation: type,
            targetId: savedCase ? savedCase.owner.caseId : parsed.data.recoveryId, key: identity, payloadHash },
          intent: parsed.data,
        }) as PartnerDraftCommand;
        await recovery.savePending(command);
        await execute(command);
      } catch {
        if (recovery.pending()) uncertain();
        else publish({ phase: 'editing', message: 'ذخیره امن پیش‌نویس انجام نشد. اطلاعات حفظ شده است؛ اتصال و اختیار ویرایش را بررسی کنید.' });
      }
    }),
    retry: () => run(async () => {
      if (state.phase === 'created') {
        if (state.cleanupPending && state.case) await finalize(state.case, cleanupInitialSave);
        return;
      }
      const command = recovery.pending();
      if (command) await execute(command);
    }),
  };
}
