export const CONTRACT_SUBMISSION_DIAGNOSTIC_STORAGE_KEY =
  'sabalan-last-contract-submit-diagnostic';

const DIAGNOSTIC_TTL_MS = 24 * 60 * 60 * 1000;

export interface ContractSubmissionDiagnostic {
  readonly occurredAt: number;
  readonly httpStatus?: number;
  readonly errorCode?: string;
  readonly causeCode?: string;
  readonly errorPath?: string;
  readonly productRowId?: string;
  readonly trackingId?: string;
}

const safeString = (value: unknown, maximumLength = 180): string | undefined =>
  typeof value === 'string' && value.trim()
    ? value.trim().slice(0, maximumLength)
    : undefined;

export const buildContractSubmissionDiagnostic = (
  error: any,
  now = Date.now()
): ContractSubmissionDiagnostic => {
  const data = error?.response?.data;
  const firstDetail = Array.isArray(data?.details) ? data.details[0] : undefined;
  const status = Number(error?.response?.status);
  return {
    occurredAt: now,
    ...(Number.isSafeInteger(status) ? { httpStatus: status } : {}),
    ...(safeString(data?.code) ? { errorCode: safeString(data.code) } : {}),
    ...(safeString(firstDetail?.causeCode)
      ? { causeCode: safeString(firstDetail.causeCode) }
      : {}),
    ...(safeString(firstDetail?.path)
      ? { errorPath: safeString(firstDetail.path) }
      : {}),
    ...(safeString(firstDetail?.productRowId)
      ? { productRowId: safeString(firstDetail.productRowId) }
      : {}),
    ...(safeString(data?.trackingId)
      ? { trackingId: safeString(data.trackingId) }
      : {})
  };
};

export const storeContractSubmissionDiagnostic = (
  error: any,
  storage: Pick<Storage, 'setItem'> | null =
    typeof window === 'undefined' ? null : window.sessionStorage
): void => {
  if (!storage) return;
  storage.setItem(
    CONTRACT_SUBMISSION_DIAGNOSTIC_STORAGE_KEY,
    JSON.stringify(buildContractSubmissionDiagnostic(error))
  );
};

export const readContractSubmissionDiagnostic = (
  storage: Pick<Storage, 'getItem' | 'removeItem'> | null =
    typeof window === 'undefined' ? null : window.sessionStorage,
  now = Date.now()
): ContractSubmissionDiagnostic | null => {
  if (!storage) return null;
  const raw = storage.getItem(CONTRACT_SUBMISSION_DIAGNOSTIC_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ContractSubmissionDiagnostic;
    if (
      !Number.isFinite(parsed.occurredAt) ||
      now - parsed.occurredAt > DIAGNOSTIC_TTL_MS
    ) {
      storage.removeItem(CONTRACT_SUBMISSION_DIAGNOSTIC_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    storage.removeItem(CONTRACT_SUBMISSION_DIAGNOSTIC_STORAGE_KEY);
    return null;
  }
};

export const clearContractSubmissionDiagnostic = (
  storage: Pick<Storage, 'removeItem'> | null =
    typeof window === 'undefined' ? null : window.sessionStorage
): void => {
  storage?.removeItem(CONTRACT_SUBMISSION_DIAGNOSTIC_STORAGE_KEY);
};
