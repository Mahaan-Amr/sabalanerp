const hasPersianText = (value: string) => /[\u0600-\u06FF]/.test(value);
const containsTechnicalCode = (value: string) =>
  /\b[A-Z][A-Z0-9_]{2,}\b/.test(value);

export const userFacingError = (error: unknown, fallback: string) => {
  const candidate =
    (error as any)?.response?.data?.error ??
    (error as any)?.response?.data?.message ??
    (error as any)?.message;
  return typeof candidate === "string" &&
    hasPersianText(candidate) &&
    !containsTechnicalCode(candidate)
    ? candidate
    : fallback;
};
