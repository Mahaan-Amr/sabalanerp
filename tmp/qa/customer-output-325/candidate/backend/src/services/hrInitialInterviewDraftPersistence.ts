export const initialInterviewDraftSaveError = (error: unknown) => {
  const publicStatus = Number((error as { statusCode?: number })?.statusCode || 0);
  if (publicStatus === 409) return error;

  if ((error as { code?: string })?.code === 'P2034') {
    return Object.assign(
      new Error('پیش‌نویس هم‌زمان تغییر کرده است. نسخه جدید سرور را بارگذاری کنید.'),
      {
        statusCode: 409,
        isOperational: true,
        cause: error,
      },
    );
  }

  return Object.assign(
    new Error('ذخیره پیش‌نویس مصاحبه انجام نشد. دوباره تلاش کنید.'),
    {
      statusCode: 500,
      isOperational: true,
      cause: error,
    },
  );
};

const draftRecord = (value: unknown): Record<string, unknown> | null => (
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

export const initialInterviewCriteriaSnapshotUnavailableError = () => Object.assign(
  new Error('نسخه معیارهای این مصاحبه قابل بازیابی نیست. اطلاعات حفظ شده است؛ با پشتیبانی تماس بگیرید.'),
  {
    statusCode: 409,
    isOperational: true,
    code: 'HR_INTERVIEW_CRITERIA_SNAPSHOT_UNAVAILABLE',
  },
);

export const withFrozenInitialInterviewCriteria = (
  payload: unknown,
  criteriaTemplateVersion: number,
  criteriaSnapshot: unknown,
): Record<string, unknown> => {
  const data = draftRecord(payload);
  if (
    !data
    || !Number.isInteger(criteriaTemplateVersion)
    || criteriaTemplateVersion < 1
    || !Array.isArray(criteriaSnapshot)
    || criteriaSnapshot.length === 0
  ) {
    throw initialInterviewCriteriaSnapshotUnavailableError();
  }
  return {
    ...data,
    criteriaTemplateVersion,
    criteriaSnapshot,
  };
};

export const mergeInitialInterviewDraftWithFrozenCriteria = (
  currentPayload: unknown,
  incomingPayload: unknown,
  criteriaTemplateVersion: number,
  criteriaSnapshot: unknown,
): Record<string, unknown> => {
  const current = draftRecord(currentPayload);
  const incoming = draftRecord(incomingPayload);
  if (!current || !incoming) throw initialInterviewCriteriaSnapshotUnavailableError();
  const {
    criteriaTemplateVersion: _ignoredVersion,
    criteriaSnapshot: _ignoredSnapshot,
    ...mutablePayload
  } = incoming;
  return withFrozenInitialInterviewCriteria(
    { ...current, ...mutablePayload },
    criteriaTemplateVersion,
    criteriaSnapshot,
  );
};
