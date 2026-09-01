import { fromIsoDate } from "@/features/hr/hrUi";

export const applicantBirthDateDisplay = (value?: string | null) =>
  value ? fromIsoDate(value) : "—";
