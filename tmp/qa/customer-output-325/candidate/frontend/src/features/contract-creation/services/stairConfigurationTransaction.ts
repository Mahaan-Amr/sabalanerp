export type StairCreateTransactionAction = 'stage' | 'finish';

export type StairTransactionPhase =
  | 'detect'
  | 'validate'
  | 'calculate'
  | 'build'
  | 'commit';

export type StairTransactionIssue = {
  code: string;
  message: string;
  focusTarget: string;
  phase: StairTransactionPhase;
  reference?: string;
};

export type StairDraftBuildResult<T> =
  | {
      ok: true;
      sessionItems: T[];
    }
  | {
      ok: false;
      issue: StairTransactionIssue;
    };

export type StairCreateTransactionOutcome<T> =
  | {
      status: 'staged' | 'committed';
      sessionItems: T[];
    }
  | {
      status: 'rejected';
      issue: StairTransactionIssue;
      preservedSessionItems: T[];
    };

export type StairTransactionDiagnosticContext = {
  action: StairCreateTransactionAction | 'edit-save' | 'discard';
  phase: StairTransactionPhase;
  mode: 'create' | 'edit';
  stairPart?: 'tread' | 'riser' | 'landing';
  parentRowId?: string;
  stairSessionId?: string;
  conflictCodes?: string[];
  inputHash?: string;
  resultHash?: string;
  stagedRowCount: number;
  layerCount?: number;
};

export const reportStairTransactionDiagnostic = (
  issue: Pick<
    StairTransactionIssue,
    'code' | 'phase' | 'focusTarget' | 'reference'
  >,
  context: StairTransactionDiagnosticContext
): void => {
  console.error('[stair-configuration-transaction]', {
    code: issue.code,
    phase: issue.phase,
    focusTarget: issue.focusTarget,
    reference: issue.reference,
    action: context.action,
    mode: context.mode,
    stairPart: context.stairPart,
    parentRowId: context.parentRowId,
    stairSessionId: context.stairSessionId,
    conflictCodes: context.conflictCodes,
    inputHash: context.inputHash,
    resultHash: context.resultHash,
    stagedRowCount: context.stagedRowCount,
    layerCount: context.layerCount
  });
};

export type ExecuteStairCreateTransactionInput<T> = {
  action: StairCreateTransactionAction;
  stagedItems: T[];
  activeDraftMeaningful: boolean;
  buildActiveDraft: () => StairDraftBuildResult<T>;
  onDiagnostic?: (
    issue: StairTransactionIssue,
    context: Pick<
      StairTransactionDiagnosticContext,
      'action' | 'phase' | 'mode' | 'stagedRowCount'
    >
  ) => void;
};

export const hasMeaningfulStairDraft = (
  draft: StairPartDraftV2
): boolean => {
  const operations = draft.operationPolicyInput;
  const hasEnteredValue = (value: unknown) =>
    value !== null &&
    value !== undefined &&
    String(value).trim() !== '';
  return Boolean(
    draft.stoneId ||
    draft.stoneProduct ||
    hasEnteredValue(draft.lengthValue) ||
    hasEnteredValue(draft.quantity) ||
    hasEnteredValue(draft.pricePerSquareMeter) ||
    hasEnteredValue(draft.standardLengthValue) ||
    hasEnteredValue(draft.numberOfLayersPerStair) ||
    (draft.layerConfigurations || []).length > 0 ||
    (draft.tools || []).length > 0 ||
    (operations?.tools || []).length > 0 ||
    (operations?.finishings || []).length > 0 ||
    draft.finishingEnabled ||
    String(draft.description || '').trim() ||
    String(draft.layerDescription || '').trim()
  );
};

export const shouldConfirmStairDraftDiscard = ({
  drafts,
  stagedRowCount
}: {
  drafts: readonly StairPartDraftV2[];
  stagedRowCount: number;
}): boolean =>
  stagedRowCount > 0 ||
  drafts.some(hasMeaningfulStairDraft);

const emptyFinishIssue = (): StairTransactionIssue => ({
  code: 'STAIR_FINISH_EMPTY',
  message: 'حداقل یک بخش پله را کامل کنید',
  focusTarget: 'stair-active-part',
  phase: 'detect'
});

const unexpectedIssue = (): StairTransactionIssue => ({
  code: 'STAIR_TRANSACTION_UNEXPECTED',
  message: 'ذخیره پیکربندی پله انجام نشد؛ اطلاعات واردشده حفظ شده است',
  focusTarget: 'stair-active-part',
  phase: 'build',
  reference: `STX-${Date.now().toString(36).toUpperCase()}`
});

export const executeStairCreateTransaction = <T>({
  action,
  stagedItems,
  activeDraftMeaningful,
  buildActiveDraft,
  onDiagnostic
}: ExecuteStairCreateTransactionInput<T>): StairCreateTransactionOutcome<T> => {
  const reject = (
    issue: StairTransactionIssue
  ): StairCreateTransactionOutcome<T> => {
    onDiagnostic?.(issue, {
      action,
      phase: issue.phase,
      mode: 'create',
      stagedRowCount: stagedItems.length
    });
    return {
      status: 'rejected',
      issue,
      preservedSessionItems: stagedItems
    };
  };

  if (action === 'finish' && !activeDraftMeaningful) {
    if (stagedItems.length === 0) {
      return reject(emptyFinishIssue());
    }
    return {
      status: 'committed',
      sessionItems: stagedItems
    };
  }

  try {
    const built = buildActiveDraft();
    if (!built.ok) {
      return reject(built.issue);
    }

    return {
      status: action === 'finish' ? 'committed' : 'staged',
      sessionItems: built.sessionItems
    };
  } catch {
    return reject(unexpectedIssue());
  }
};
import type { StairPartDraftV2 } from '../types/contract.types';
