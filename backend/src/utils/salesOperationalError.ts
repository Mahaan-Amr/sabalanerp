type UnexpectedSalesErrorOptions = {
  code: string;
  failedAction: string;
  trackingId: string;
  preserveInput?: boolean;
};

export const unexpectedSalesErrorResponse = ({
  code,
  failedAction,
  trackingId,
  preserveInput = false,
}: UnexpectedSalesErrorOptions) => ({
  success: false as const,
  code,
  error: preserveInput
    ? `${failedAction} انجام نشد. اطلاعات واردشده حفظ شده است؛ دوباره تلاش کنید. کد پیگیری: ${trackingId}`
    : `${failedAction} انجام نشد؛ دوباره تلاش کنید. کد پیگیری: ${trackingId}`,
  trackingId,
});
