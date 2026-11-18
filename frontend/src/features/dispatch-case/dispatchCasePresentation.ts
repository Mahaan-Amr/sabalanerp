import { biometricAttemptEventLabel } from "../biometric/dispatchConfirmationPresentation";

type PresentedField = { label: string; value: string };

const persianDigits = (value: string | number) =>
  String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]);

const statusLabels: Record<string, string> = {
  WAITING_AT_GATE: "در انتظار پذیرش گارد",
  AVAILABLE_FOR_LOADING: "آماده تخصیص بار",
  RESERVED_FOR_LOADING: "برای بارگیری رزرو شده",
  LOADING_FINALIZED: "بارگیری نهایی شده",
  EXIT_RECORDED: "خروج از مجموعه ثبت شده",
  CLOSED_WITHOUT_LOADING: "بدون بارگیری بسته شده",
  VOIDED: "باطل شده",
  PENDING: "در انتظار بررسی",
  ACCEPTED: "تأیید شده",
  REJECTED: "رد شده",
  RETURNED: "برای اصلاح بازگردانده شده",
  WITHDRAWN: "پس گرفته شده",
  STALE_REQUIRES_SUCCESSOR: "نیازمند نسخه جایگزین",
  EVIDENCE_CONFLICT: "دارای مغایرت در شواهد",
  ISSUED: "صادر شده",
  ACTIVE: "فعال",
  CONFIRMED: "تأیید شده",
  FAILED: "ناموفق",
  CANCELLED: "لغو شده",
  EXPIRED: "منقضی شده",
  REGISTERED: "ثبت شده",
  APPROVED: "تأیید شده",
  POSTED: "نهایی شده",
  DRAFT: "پیش‌نویس",
};

const eventLabels: Record<string, string> = {
  ADMITTED: "ورود راننده ثبت شد",
  PERSONAL_PICKUP_SELECTED: "راننده شخصی برای بارگیری انتخاب شد",
  MADE_AVAILABLE_FOR_LOADING: "راننده برای بارگیری آماده شد",
  RESERVED_FOR_LOADING: "بارگیری برای راننده رزرو شد",
  RESERVATION_RELEASED: "رزرو بارگیری آزاد شد",
  LOADING_FINALIZED: "بارگیری نهایی شد",
  FINALIZED_LOADING_CANCELLED: "بارگیری نهایی‌شده پیش از خروج لغو شد",
  CANDIDATE_WITHDRAWN: "درخواست صدور اسناد خروج پس گرفته شد",
  ACCEPT: "حسابداری درخواست صدور اسناد خروج را پذیرفت",
  REJECT: "حسابداری درخواست صدور اسناد خروج را رد کرد",
  RETURN: "حسابداری درخواست صدور اسناد خروج را برای اصلاح برگرداند",
  CANDIDATE_RETURNED: "درخواست صدور اسناد خروج برای اصلاح بازگردانده شد",
  CANDIDATE_ACCEPTED_FOR_ISSUANCE: "درخواست صدور اسناد خروج تأیید شد",
  VOID_WAYBILL: "حواله خروج باطل شد",
  REPLACE_WAYBILL: "حواله خروج جایگزین شد",
  WAYBILL_REPLACED: "حواله خروج جایگزین شد",
  DOCUMENT_BUNDLE_REPLACED: "مجموعه اسناد خروج جایگزین شد",
  DOCUMENT_BUNDLE_VOIDED: "مجموعه اسناد خروج باطل شد",
  PRIMARY_BUNDLE_ISSUED: "مجموعه اسناد خروج صادر شد",
  PRICED_ALLOCATION_RECORDED: "قیمت‌گذاری بار تخصیص‌یافته ثبت شد",
  PRICING_EVIDENCE_CONFLICT: "مغایرت در مستندات قیمت‌گذاری ثبت شد",
  PRICING_STALE_REQUIRES_SUCCESSOR: "قیمت‌گذاری دیگر معتبر نیست و باید جایگزین شود",
  RESERVATION_RELEASED_FOR_DEPARTURE: "رزرو بارگیری برای خروج راننده آزاد شد",
  RESERVATION_RELEASED_FOR_VOID: "رزرو بارگیری به علت ابطال نوبت آزاد شد",
  RETURNED_TO_GATE_WAITING: "راننده به صف انتظار گارد برگشت",
  CLOSED_WITHOUT_LOADING: "نوبت راننده بدون بارگیری بسته شد",
  VOIDED: "نوبت راننده باطل شد",
  REVOKED_FOR_WAYBILL_VOID: "مجوز خروج به علت ابطال حواله لغو شد",
  REVOKED_FOR_WAYBILL_REPLACEMENT: "مجوز خروج به علت جایگزینی حواله لغو شد",
  MANUAL_EXIT_PENDING_APPROVALS: "خروج ثبت‌شده روی برگه دستی در انتظار تأیید است",
  MANUAL_EXIT_SPOILED: "برگه ثبت دستی خروج باطل شد",
  MANUAL_EXIT_CONFLICT: "در ثبت دستی خروج مغایرت شناسایی شد",
  CORRECTION_DRAFT_CREATED: "پیش‌نویس اصلاح پرونده ارسال ایجاد شد",
  CORRECTION_POSTED: "اصلاح پرونده ارسال نهایی شد",
  PAPER_EXIT_REGISTERED_PENDING_APPROVALS: "خروج با برگه دستی ثبت شد و در انتظار تأیید است",
  PAPER_EXIT_SPOILED: "برگه ثبت دستی خروج باطل شد",
  INTERNAL_BIOMETRIC_FALLBACK: "تأیید راننده داخلی با روش جایگزین ثبت شد",
  EXTERNAL_BIOMETRIC_FALLBACK: "تأیید راننده بیرونی با روش جایگزین ثبت شد",
  PHYSICAL_EXIT_RECORDED: "خروج فیزیکی از مجموعه ثبت شد",
  MANUAL_OUTAGE_EXIT_REGISTERED: "خروج زمان قطعی سامانه ثبت شد",
  ALLOCATION_FINALIZED: "تخصیص بار نهایی شد",
  CANDIDATE_CREATED: "پرونده اسناد خروج ایجاد شد",
  WAYBILL_ISSUED: "حواله خروج صادر شد",
  WAYBILL_VOIDED: "حواله خروج باطل شد",
  CONFIRMATION_STARTED: "فرایند تأیید راننده آغاز شد",
  BIOMETRIC_ATTEMPT_RECORDED: "نتیجه بررسی اثر انگشت ثبت شد",
  GUARD_APPROVED: "گارد خروج را تأیید کرد",
  EXIT_AUTHORIZATION_ISSUED: "مجوز خروج صادر شد",
  EXIT_AUTHORIZATION_REVOKED: "مجوز خروج لغو شد",
  EXIT_AUTHORIZATION_CONSUMED: "مجوز خروج استفاده شد",
  EXIT_AUTHORIZATION_EXPIRED: "مهلت مجوز خروج پایان یافت",
};

export const dispatchStatusLabel = (status?: string | null) =>
  status ? statusLabels[status] || "وضعیت در سامانه ثبت شده" : "بدون وضعیت";

export const dispatchStationLabel = (station?: string | null) =>
  ({
    GUARD: "گارد",
    LOGISTICS: "لجستیک",
    ACCOUNTING: "حسابداری",
    SYSTEM: "سامانه",
    RECOVERY: "بازیابی و اصلاح",
    AUDIT: "کنترل سوابق",
  })[station || ""] || "سامانه";

export const dispatchActionLabel = (action?: string | null) =>
  ({
    COMPLETE: "فرایند ارسال تکمیل شده است",
    REVIEW_CURRENT_STATION: "پرونده در ایستگاه جاری نیازمند بررسی است",
    GUARD_REVIEW: "پرونده در انتظار بررسی گارد است",
    LAST_SUCCESS_UNAVAILABLE: "نمای زنده در دسترس نیست",
  })[action || ""] || "وضعیت پرونده آماده بررسی است";

export const dispatchRecoveryLabel = (recovery?: string | null) =>
  ({
    FOLLOW_REPLACEMENT: "نسخه جایگزین پرونده را دنبال کنید",
    RETRY_WHEN_ONLINE: "پس از برقراری ارتباط دوباره تلاش کنید",
    RETRY_AT_GUARD: "بررسی را در ایستگاه گارد دوباره انجام دهید",
  })[recovery || ""] || "برای ادامه، وضعیت پرونده را دوباره بررسی کنید";

export const dispatchEventLabel = (eventType?: string | null, detail?: Record<string, any>) => {
  if (detail?.method === "PERSONAL_PICKUP_ACCOUNTING") {
    if (eventType === "CONFIRMATION_STARTED") return "درخواست مجوز خروج راننده شخصی ثبت شد";
    if (eventType === "CONFIRMATION_CONFIRMED") return "مجوز خروج راننده شخصی صادر شد";
  }
  if (eventType === "BIOMETRIC_ATTEMPT_RECORDED") {
    const result = detail?.result ?? detail;
    if (result?.match || result?.captureQuality || result?.liveness || result?.errorCategory)
      return biometricAttemptEventLabel(result);
  }
  if (!eventType) return "رویداد ثبت‌شده";
  if (eventLabels[eventType]) return eventLabels[eventType];
  const [command, , invoiceId] = eventType.split(":", 3);
  if (command === "VOID_WAYBILL_AND_INVOICE")
    return invoiceId ? "حواله خروج و فاکتور فروش باطل شدند" : eventLabels.VOID_WAYBILL;
  if (command === "VOID_WAYBILL" || command === "REPLACE_WAYBILL")
    return eventLabels[command];
  if (eventType.startsWith("CANDIDATE_"))
    return `پرونده اسناد خروج ${dispatchStatusLabel(eventType.slice("CANDIDATE_".length))}`;
  if (eventType.startsWith("CONFIRMATION_"))
    return `تأیید راننده ${dispatchStatusLabel(eventType.slice("CONFIRMATION_".length))}`;
  if (eventType.startsWith("MANUAL_EXIT_"))
    return `خروج زمان قطعی سامانه ${dispatchStatusLabel(eventType.slice("MANUAL_EXIT_".length))}`;
  if (eventType.startsWith("CORRECTION_"))
    return `اصلاح پرونده ${dispatchStatusLabel(eventType.slice("CORRECTION_".length))}`;
  return "یک رویداد سیستمی ثبت شد";
};

export const dispatchCaseReference = (loadingNumber?: string | null) => {
  if (!loadingNumber) return "بدون شماره بارگیری";
  if (
    /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(loadingNumber) ||
    /^(legacy|candidate|loading)[-_]/i.test(loadingNumber)
  )
    return "شماره بارگیری ثبت‌شده";
  if (/[\u0600-\u06FF]/.test(loadingNumber))
    return `شماره بارگیری ${persianDigits(loadingNumber)}`;
  const match = /^L-(\d{4})(\d{2})(\d{2})-(\d+)$/.exec(loadingNumber);
  if (!match) return "شماره بارگیری ثبت‌شده";
  const [, year, month, day, sequence] = match;
  const date = new Date(
    `${year}-${month}-${day}T12:00:00.000Z`,
  ).toLocaleDateString("fa-IR-u-ca-persian");
  return `بارگیری شماره ${persianDigits(Number(sequence))} · ${date}`;
};

const valueLabel = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "ثبت نشده";
  if (typeof value === "boolean") return value ? "بله" : "خیر";
  if (typeof value === "number") return persianDigits(value);
  if (typeof value === "string") {
    const methodLabels: Record<string, string> = {
      EXTERNAL_BIOMETRIC: "اثر انگشت راننده بیرونی",
      EXTERNAL_FALLBACK: "روش جایگزین راننده بیرونی",
      INTERNAL_BIOMETRIC: "اثر انگشت راننده داخلی",
      EXTERNAL_OTP_GUARD: "رمز یک‌بارمصرف با تأیید گارد",
      INTERNAL_FALLBACK: "روش جایگزین راننده داخلی",
      BIOMETRIC: "اثر انگشت",
      OTP: "رمز یک‌بارمصرف",
    };
    if (methodLabels[value]) return methodLabels[value];
    if (statusLabels[value]) return statusLabels[value];
    if (/^\d{4}-\d{2}-\d{2}T/.test(value))
      return new Date(value).toLocaleString("fa-IR");
    return persianDigits(value);
  }
  return persianDigits(JSON.stringify(value));
};

const summaryFields: Record<string, string> = {
  fromStatus: "وضعیت قبلی",
  toStatus: "وضعیت جدید",
  reason: "دلیل",
  revisionNumber: "شماره ویرایش",
  number: "شماره حواله",
  method: "روش تأیید",
  sequence: "نوبت بررسی",
  validUntil: "اعتبار تا",
  effectiveAt: "زمان اثرگذاری",
  paperNumber: "شماره برگه دستی",
};

const technicalFields: Record<string, string> = {
  snapshotSchemaVersion: "نسخه ساختار ثبت",
  integrityHash: "کد صحت داده",
  aggregateType: "نوع رکورد داخلی",
  loadingId: "شناسه داخلی بارگیری",
  workstationId: "شناسه دستگاه",
  state: "وضعیت داخلی",
  result: "نتیجه فنی بررسی",
};

export const evidenceDetailPresentation = (
  detail: Record<string, unknown> = {},
) => {
  const summary: PresentedField[] = [];
  const technical: PresentedField[] = [];
  for (const [key, value] of Object.entries(detail)) {
    if (
      summaryFields[key] &&
      value !== null &&
      value !== undefined &&
      value !== ""
    )
      summary.push({ label: summaryFields[key], value: valueLabel(value) });
    else if (key === "fromStatus" || key === "toStatus")
      summary.push({ label: summaryFields[key], value: valueLabel(value) });
    else if (technicalFields[key])
      technical.push({ label: technicalFields[key], value: valueLabel(value) });
  }
  return { summary, technical };
};

export const dispatchDriverName = (name?: string | null) =>
  name === "Redacted"
    ? "نام راننده برای این دسترسی پنهان است"
    : name || "راننده";
