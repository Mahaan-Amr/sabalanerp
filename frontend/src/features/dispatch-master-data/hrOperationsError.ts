import {
  getOperationalErrorMessage,
  isSafeOperationalBusinessText,
  type OperationalErrorOptions,
} from "@/lib/operationalError";

export const hrOperationsError = (
  error: unknown,
  options: OperationalErrorOptions,
): string => {
  const candidate = error as {
    response?: { status?: number; data?: Record<string, unknown> };
  };
  if (candidate?.response?.status === 403) {
    const data = candidate.response.data || {};
    if (
      [data.error, data.message].some(
        (value) =>
          typeof value === "string" && isSafeOperationalBusinessText(value),
      )
    )
      return getOperationalErrorMessage(error, options);
    return getOperationalErrorMessage(
      {
        ...candidate,
        response: {
          ...candidate.response,
          data: {
            ...candidate.response.data,
            error:
              "مجوز لازم برای این اقدام فعال نیست. از مدیر منابع انسانی بخواهید دسترسی همین اقدام را بررسی کند.",
            message:
              "مجوز لازم برای این اقدام فعال نیست. از مدیر منابع انسانی بخواهید دسترسی همین اقدام را بررسی کند.",
          },
        },
      },
      options,
    );
  }
  return getOperationalErrorMessage(error, options);
};
