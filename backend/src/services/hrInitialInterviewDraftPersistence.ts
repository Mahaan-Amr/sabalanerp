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
