export type CandidateCorrectionField = {
  fieldKey: string;
  label: string;
  explanation: string;
};

const candidateFieldLabels: Record<string, string> = {
  firstName: "نام",
  lastName: "نام خانوادگی",
  birthDate: "تاریخ تولد",
  birthPlace: "محل تولد",
  fatherName: "نام پدر",
  nationalCode: "کد ملی",
  foreignIdentity: "اطلاعات هویتی اتباع",
  militaryStatus: "وضعیت نظام وظیفه",
  address: "نشانی",
  postalCode: "کد پستی",
  mobile: "شماره همراه",
  educationLevel: "سطح تحصیلات",
  maritalStatus: "وضعیت تأهل",
  birthCertificateExplanations: "توضیحات شناسنامه",
};

export const normalizeCandidateCorrectionRequest = (input: unknown) => {
  const fields = (input as { fields?: unknown })?.fields;
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error("حداقل یک فیلد برای اصلاح انتخاب کنید.");
  }

  const seen = new Set<string>();
  return fields.map((item) => {
    const fieldKey = String((item as any)?.fieldKey || "").trim();
    const explanation = String((item as any)?.explanation || "").trim();
    const label = candidateFieldLabels[fieldKey];
    if (!label || seen.has(fieldKey)) {
      throw new Error("فیلد اصلاحی نامعتبر یا تکراری است.");
    }
    if (!explanation || !/[\u0600-\u06ff]/.test(explanation)) {
      throw new Error(`توضیح فارسی برای ${label} الزامی است.`);
    }
    seen.add(fieldKey);
    return { fieldKey, label, explanation };
  });
};

export const buildCandidateCorrectionMessage = (
  fields: CandidateCorrectionField[],
  includesReplacementOtp: boolean,
) => {
  const details = fields
    .map((field) => `${field.label}: ${field.explanation}`)
    .join("؛ ");
  const access = includesReplacementOtp
    ? "کد ورود جدید در همین پیام درج شده است."
    : "با همان کد ورود قبلی وارد فرم شوید.";
  return `درخواست اصلاح فرم استخدام: ${details}. ${access}`;
};
