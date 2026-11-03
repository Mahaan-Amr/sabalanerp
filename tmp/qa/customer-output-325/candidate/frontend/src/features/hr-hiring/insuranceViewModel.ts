export type InsuranceFormState = {
  registrationPath: string;
  status: string;
  effectiveDate: string;
  communicationMethod: string | null;
  communicatedAt: string | null;
};

export const insuranceSubmissionBlocker = (form: InsuranceFormState) => {
  if (form.registrationPath === "INDEPENDENT_REQUEST") {
    return String(form.communicationMethod ?? "").trim() && form.communicatedAt
      ? null
      : "communication-required";
  }
  if (form.status === "ACTIVE" && !form.effectiveDate) {
    return "effective-date-required";
  }
  return null;
};
