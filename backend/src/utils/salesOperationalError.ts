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
    ? `${failedAction} انجام نشد. اطلاعات واردشده حفظ شده است؛ وضعیت فعلی را بررسی کنید و فقط اگر عملیات انجام نشده بود دوباره تلاش کنید. کد پیگیری: ${trackingId}`
    : `${failedAction} انجام نشد؛ وضعیت فعلی را بررسی کنید و فقط اگر عملیات انجام نشده بود دوباره تلاش کنید. کد پیگیری: ${trackingId}`,
  trackingId,
});

const KNOWN_SALES_ERRORS: Record<string, string> = {
  'Contract not found': 'قرارداد پیدا نشد؛ به فهرست قراردادها برگردید و قرارداد دیگری را انتخاب کنید.',
  'User not found': 'کاربر مرتبط پیدا نشد؛ صفحه را تازه‌سازی و کاربر را دوباره انتخاب کنید.',
  'Access denied': 'اجازه انجام این عملیات را ندارید؛ به صفحه قبل برگردید.',
  'Contract cannot be modified in current status': 'وضعیت فعلی قرارداد اجازه ویرایش نمی‌دهد؛ وضعیت قرارداد را بررسی کنید.',
  'Contract cannot be modified after accounting financial approval': 'قرارداد پس از تأیید مالی از این مسیر قابل‌ویرایش نیست؛ مسیر درخواست اصلاح را باز کنید.',
  'Contract cannot be approved in current status': 'قرارداد در وضعیت فعلی قابل‌تأیید نیست؛ وضعیت قرارداد را بررسی کنید.',
  'Contract cannot be rejected in current status': 'قرارداد در وضعیت فعلی قابل‌رد نیست؛ وضعیت قرارداد را بررسی کنید.',
  'Contract is inactive': 'قرارداد غیرفعال و فقط‌خواندنی است؛ قرارداد فعال را انتخاب کنید.',
  'Inactive contracts are read-only': 'قرارداد غیرفعال و فقط‌خواندنی است؛ قرارداد فعال را انتخاب کنید.',
  'Check number is required for check payments': 'برای پرداخت چکی، شماره چک را وارد کنید.',
  'Cash type is required for cash payments': 'برای پرداخت نقدی، نوع وجه را انتخاب کنید.',
  'CRM potential project not found': 'پروژه انتخاب‌شده پیدا نشد؛ پروژه را دوباره از فهرست انتخاب کنید.',
  'CRM potential project customer does not match contract customer': 'مشتری پروژه با مشتری قرارداد یکسان نیست؛ پروژه یا مشتری قرارداد را اصلاح کنید.',
  'CRM potential project is already linked to a sales contract': 'این پروژه قبلاً به یک قرارداد فروش متصل شده است؛ قرارداد متصل را از صفحه پروژه باز کنید.',
};

export const salesBusinessErrorMessage = (message: unknown, fallback: string): string =>
  typeof message === 'string' && KNOWN_SALES_ERRORS[message]
    ? KNOWN_SALES_ERRORS[message]
    : typeof message === 'string'
      && message.length <= 500
      && /[\u0600-\u06ff]/.test(message)
      && !/[A-Za-z{}[\]<>]|پشتیبانی|تماس بگیرید|خطای سرور|پایگاه داده/i.test(message)
        ? message
        : fallback;

export const ensureSalesErrorTracking = (
  payload: unknown,
  status: number,
  requestTrackingId: unknown,
  createTrackingId: () => string,
) => {
  if (status < 500 || !payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const body = payload as Record<string, unknown>;
  if (body.success !== false) return payload;
  const existing = typeof body.trackingId === 'string' && /^[A-Za-z0-9._:-]{1,64}$/.test(body.trackingId)
    ? body.trackingId
    : '';
  const requested = typeof requestTrackingId === 'string' && /^[A-Za-z0-9._:-]{1,64}$/.test(requestTrackingId)
    ? requestTrackingId
    : '';
  return { ...body, trackingId: existing || requested || createTrackingId() };
};
