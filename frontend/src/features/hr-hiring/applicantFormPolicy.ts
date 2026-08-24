export type ApplicantFieldError = { field: string; message: string };

export const EDUCATION_LEVEL_OPTIONS = [
  { value: "PRIMARY", label: "ابتدایی" },
  { value: "LOWER_SECONDARY", label: "متوسطه اول" },
  { value: "DIPLOMA", label: "دیپلم" },
  { value: "ASSOCIATE", label: "کاردانی" },
  { value: "BACHELOR", label: "کارشناسی" },
  { value: "MASTER", label: "کارشناسی ارشد" },
  { value: "DOCTORATE", label: "دکتری" },
  { value: "SEMINARY", label: "حوزوی" },
  { value: "OTHER", label: "سایر" },
] as const;

const legacyEducation = new Map<string, string>([
  ["ابتدایی", "PRIMARY"],
  ["متوسطه اول", "LOWER_SECONDARY"],
  ["دیپلم", "DIPLOMA"],
  ["کاردانی", "ASSOCIATE"],
  ["کارشناسی", "BACHELOR"],
  ["کارشناسی ارشد", "MASTER"],
  ["دکتری", "DOCTORATE"],
  ["حوزوی", "SEMINARY"],
  ["سایر", "OTHER"],
]);

const standardEducation = new Set<string>(EDUCATION_LEVEL_OPTIONS.map(({ value }) => value));

export const normalizeLegacyEducation = (value: unknown, existingOther: unknown = "") => {
  const raw = String(value ?? "").trim();
  const other = String(existingOther ?? "").trim();
  if (!raw) return { educationLevel: "", educationLevelOther: other };
  if (standardEducation.has(raw)) return { educationLevel: raw, educationLevelOther: raw === "OTHER" ? other : "" };
  const mapped = legacyEducation.get(raw);
  if (mapped) return { educationLevel: mapped, educationLevelOther: mapped === "OTHER" ? other : "" };
  return { educationLevel: "OTHER", educationLevelOther: other || raw };
};

export const currentJalaliYear = (now = new Date()) => Number(new Intl.DateTimeFormat("en-US-u-ca-persian", {
  year: "numeric",
  timeZone: "Asia/Tehran",
}).formatToParts(now).find((part) => part.type === "year")?.value);

const personalRequiredFields: Array<[string, string]> = [
  ["firstName", "نام الزامی است."],
  ["lastName", "نام خانوادگی الزامی است."],
  ["alias", "نام مستعار یا پاسخ «ندارم» الزامی است."],
  ["birthDate", "تاریخ تولد الزامی است."],
  ["birthPlace", "محل تولد الزامی است."],
  ["militaryStatus", "وضعیت نظام وظیفه الزامی است."],
  ["fatherName", "نام پدر الزامی است."],
  ["fatherOccupation", "شغل یا وضعیت پدر الزامی است."],
  ["maritalStatus", "وضعیت تأهل الزامی است."],
];
const contactRequiredFields: Array<[string, string]> = [
  ["address", "نشانی محل سکونت الزامی است."], ["postalCode", "کد پستی الزامی است."],
  ["mobile", "شماره همراه الزامی است."], ["homePhone", "تلفن منزل یا پاسخ «ندارم» الزامی است."],
  ["socialMedia", "شبکه اجتماعی یا پاسخ «ندارم» الزامی است."],
];
const educationRequiredFields: Array<[string, string]> = [
  ["educationLevel", "آخرین مقطع تکمیل‌شده الزامی است."], ["fieldOfStudy", "رشته تحصیلی الزامی است."],
  ["graduationYear", "سال اخذ مدرک الزامی است."], ["hasSocialSecurityHistory", "وضعیت سابقه بیمه الزامی است."],
];

const empty = (value: unknown) => value === undefined || value === null || String(value).trim() === "";

export const isValidIranianNationalCode = (value: unknown) => {
  const code = String(value ?? "");
  if (!/^\d{10}$/.test(code) || /^(\d)\1{9}$/.test(code)) return false;
  const sum = code
    .slice(0, 9)
    .split("")
    .reduce((total, digit, index) => total + Number(digit) * (10 - index), 0);
  const remainder = sum % 11;
  return Number(code[9]) === (remainder < 2 ? remainder : 11 - remainder);
};

export const nationalCodeValidationError = (value: unknown) => {
  const code = String(value ?? "");
  if (!/^\d{10}$/.test(code)) return "کد ملی باید دقیقاً ۱۰ رقم باشد.";
  if (!isValidIranianNationalCode(code)) return "کد ملی معتبر نیست.";
  return undefined;
};

export const nationalCodeCorrectionValidationError = (value: unknown) =>
  /^\d{10}$/.test(String(value ?? "")) ? undefined : "کد ملی باید دقیقاً ۱۰ رقم باشد.";

const repeaters: Array<{ key: string; label: string; fields: string[] }> = [
  { key: "workHistory", label: "سابقه کاری", fields: ["organization", "duration", "lastPosition", "lastSalaryBenefits"] },
  { key: "skills", label: "مهارت", fields: ["name", "familiarity", "proficiency"] },
  { key: "languages", label: "زبان خارجی", fields: ["name", "level", "proficiency"] },
];

export const applicantFormErrors = (data: Record<string, any>, jalaliYear = currentJalaliYear()): ApplicantFieldError[] => {
  const errors: ApplicantFieldError[] = [];
  for (const [field, message] of personalRequiredFields) {
    if (empty(data?.[field])) errors.push({ field, message });
  }
  if (data?.maritalStatus === "MARRIED") {
    if (empty(data.childrenCount)) errors.push({ field: "childrenCount", message: "تعداد فرزندان الزامی است." });
    if (empty(data.spouseOccupation)) errors.push({ field: "spouseOccupation", message: "شغل همسر الزامی است." });
  }
  if (data?.identityKind === "FOREIGN") {
    if (empty(data.foreignIdentityType)) errors.push({ field: "foreignIdentityType", message: "نوع مدرک هویتی الزامی است." });
    if (empty(data.foreignIdentityNumber)) errors.push({ field: "foreignIdentityNumber", message: "شماره مدرک هویتی الزامی است." });
  } else if (empty(data?.nationalCode)) {
    errors.push({ field: "nationalCode", message: "کد ملی الزامی است." });
  } else {
    const nationalCodeError = nationalCodeValidationError(data.nationalCode);
    if (nationalCodeError) errors.push({ field: "nationalCode", message: nationalCodeError });
  }
  for (const [field, message] of contactRequiredFields) if (empty(data?.[field])) errors.push({ field, message });
  if (!empty(data?.postalCode) && !/^\d{10}$/.test(String(data.postalCode))) {
    errors.push({ field: "postalCode", message: "کد پستی باید دقیقاً ۱۰ رقم باشد." });
  }
  if (!empty(data?.mobile) && !/^09\d{9}$/.test(String(data.mobile))) {
    errors.push({ field: "mobile", message: "شماره همراه باید دقیقاً ۱۱ رقم باشد و با 09 شروع شود." });
  }
  for (const [field, message] of educationRequiredFields) if (empty(data?.[field])) errors.push({ field, message });
  if (!empty(data?.educationLevel) && !standardEducation.has(String(data.educationLevel))) {
    errors.push({ field: "educationLevel", message: "یک مقطع تحصیلی معتبر انتخاب کنید." });
  }
  if (data?.educationLevel === "OTHER" && empty(data?.educationLevelOther)) {
    errors.push({ field: "educationLevelOther", message: "عنوان مقطع برای گزینه سایر الزامی است." });
  }
  if (!empty(data?.graduationYear)) {
    const year = String(data.graduationYear);
    if (!/^\d{4}$/.test(year) || Number(year) < 1300 || Number(year) > jalaliYear) {
      errors.push({ field: "graduationYear", message: `سال اخذ مدرک باید بین ۱۳۰۰ تا ${jalaliYear.toLocaleString("fa-IR", { useGrouping: false })} باشد.` });
    }
  }
  for (const repeater of repeaters) {
    const rows = Array.isArray(data?.[repeater.key]) ? data[repeater.key] : [];
    rows.forEach((row: Record<string, unknown>, index: number) => {
      const populated = repeater.fields.filter((field) => !empty(row?.[field]));
      if (!populated.length || populated.length === repeater.fields.length) return;
      const firstMissing = repeater.fields.find((field) => empty(row?.[field])) || repeater.fields[0];
      errors.push({
        field: `${repeater.key}.${index}.${firstMissing}`,
        message: `ردیف ${repeater.label} ${index + 1} نیمه‌کاره است؛ آن را کامل یا حذف کنید.`,
      });
    });
  }
  return errors;
};
