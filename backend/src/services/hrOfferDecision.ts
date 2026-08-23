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
  confirmedCandidateInformation: string;
  note: string;
};

const COMPLETE_ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export const validateOfflineOfferDecision = (input: any): OfflineOfferDecision => {
  const decision = input?.decision;
  const communicationMethod = input?.communicationMethod;
  const communicatedAtInput = String(input?.communicatedAt || '').trim();
  const communicatedAt = new Date(communicatedAtInput);
  const offlineReason = String(input?.offlineReason || "").trim();
  const confirmedCandidateInformation = String(
    input?.confirmedCandidateInformation || "",
  ).trim();
  const note = String(input?.note || "").trim();
  if (
    !["ACCEPTED", "DECLINED"].includes(decision) ||
    !["PHONE", "IN_PERSON", "VIDEO_CALL", "OTHER"].includes(
      communicationMethod,
    ) ||
    !COMPLETE_ISO_TIMESTAMP.test(communicatedAtInput) ||
    Number.isNaN(communicatedAt.getTime()) ||
    !offlineReason ||
    !confirmedCandidateInformation ||
    !note
  ) {
    throw new Error("تمام شواهد تصمیم آفلاین الزامی است.");
  }
  return {
    decision,
    communicationMethod,
    communicatedAt,
    offlineReason,
    confirmedCandidateInformation,
    note,
  };
};
