export const normalizeAssessmentDigits = (value: unknown) =>
  String(value ?? "")
    .trim()
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[٫,٬]/g, ".");

export const parseLocalizedAssessmentScore = (
  value: unknown,
): { value?: number; error?: string } => {
  const normalized = normalizeAssessmentDigits(value);
  if (!normalized) return { error: "وارد کردن امتیاز الزامی است." };
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return { error: "امتیاز باید یک عدد معتبر باشد." };
  }
  const decimalPart = normalized.split(".")[1] || "";
  if (decimalPart.length > 2) {
    return { error: "امتیاز حداکثر می‌تواند دو رقم اعشار داشته باشد." };
  }
  const score = Number(normalized);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    return { error: "امتیاز باید بین ۰ تا ۱۰۰ باشد." };
  }
  return { value: score };
};
