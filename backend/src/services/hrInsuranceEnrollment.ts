const operationalStatuses = new Set([
  "NOT_STARTED",
  "IN_PROGRESS",
  "ACTIVE",
  "EXEMPT",
]);

export interface InsuranceEnrollmentCommand {
  registrationPath?: string;
  status?: string;
  effectiveDate?: string | null;
  dueDate?: string | null;
  communicationMethod?: string | null;
  communicatedAt?: string | null;
  note?: string | null;
}

export const normalizeInsuranceEnrollmentCommand = (
  input: InsuranceEnrollmentCommand,
) => {
  const registrationPath = input.registrationPath || "COMPANY";
  if (!new Set(["COMPANY", "INDEPENDENT_REQUEST"]).has(registrationPath))
    throw new Error("روش ثبت بیمه نامعتبر است.");

  if (registrationPath === "INDEPENDENT_REQUEST") {
    if (!String(input.communicationMethod || "").trim() || !input.communicatedAt)
      throw new Error("روش و زمان اعلام درخواست ثبت مستقل الزامی است.");
    return {
      registrationPath,
      status: "EXEMPT",
      effectiveDate: null,
      dueDate: null,
      communicationMethod: String(input.communicationMethod).trim(),
      communicatedAt: input.communicatedAt,
      note: String(input.note || "").trim() || null,
    };
  }

  const status = input.status || "NOT_STARTED";
  if (!operationalStatuses.has(status))
    throw new Error("وضعیت بیمه نامعتبر است.");
  if (status === "ACTIVE" && !input.effectiveDate)
    throw new Error("تاریخ شروع پوشش بیمه فعال الزامی است.");
  return {
    registrationPath,
    status,
    effectiveDate: input.effectiveDate || null,
    dueDate: input.dueDate || null,
    communicationMethod: null,
    communicatedAt: null,
    note: String(input.note || "").trim() || null,
  };
};
