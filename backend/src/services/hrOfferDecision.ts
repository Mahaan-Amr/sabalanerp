export const normalizePersianFullName = (value: unknown) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, " ")
    .trim()
    .replace(/\s+/g, " ");

export type OfflineOfferDecision = {
  decision: "ACCEPTED" | "DECLINED";
  communicationMethod: "PHONE" | "IN_PERSON" | "VIDEO_CALL" | "OTHER";
  communicatedAt: Date;
  offlineReason: string;
  declineCategory: string | null;
  note: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECLINE_CATEGORIES = ["COMPENSATION", "ROLE", "START_DATE", "PERSONAL", "OTHER"];

const tehranIsoDate = (value: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

export const validateOfflineOfferDecision = (input: any, now = new Date()): OfflineOfferDecision => {
  const decision = input?.decision;
  const communicationMethod = input?.communicationMethod;
  const communicatedOn = String(input?.communicatedOn || '').trim();
  const communicatedAt = new Date(`${communicatedOn}T12:00:00+03:30`);
  const offlineReason = String(input?.offlineReason || "").trim();
  const declineCategory = decision === "DECLINED" ? String(input?.declineCategory || "").trim() : null;
  const note = String(input?.note || "").trim();
  if (
    !["ACCEPTED", "DECLINED"].includes(decision) ||
    !["PHONE", "IN_PERSON", "VIDEO_CALL", "OTHER"].includes(
      communicationMethod,
    ) ||
    !offlineReason
  ) {
    throw new Error("تمام شواهد تصمیم آفلاین الزامی است.");
  }
  if (!ISO_DATE.test(communicatedOn) || Number.isNaN(communicatedAt.getTime()) || tehranIsoDate(communicatedAt) !== communicatedOn || communicatedOn > tehranIsoDate(now)) {
    throw new Error("تاریخ اعلام تصمیم باید یک تاریخ معتبر از امروز یا گذشته باشد.");
  }
  if (decision === "DECLINED" && !DECLINE_CATEGORIES.includes(declineCategory || "")) {
    throw new Error("انتخاب دسته‌بندی دلیل رد پیشنهاد الزامی است.");
  }
  return {
    decision,
    communicationMethod,
    communicatedAt,
    offlineReason,
    declineCategory,
    note,
  };
};
