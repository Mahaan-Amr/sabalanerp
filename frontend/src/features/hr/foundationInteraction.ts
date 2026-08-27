const dependencyLabels: Record<string, string> = {
  assignments: "تخصیص‌ها",
  applications: "پرونده‌های جذب",
  recruitmentRequests: "درخواست‌های جذب",
  subordinatePositions: "جایگاه‌های زیرمجموعه",
  evaluationEligibility: "صلاحیت‌های ارزیابی",
  capacityChanges: "تغییرات ظرفیت",
  childUnits: "واحدهای زیرمجموعه",
  positions: "جایگاه‌ها",
  historicalAssignments: "تخصیص‌های تاریخی",
  historicalStructureChanges: "تغییرات تاریخی ساختار",
};

export const foundationDependencyLabel = (kind: string) => dependencyLabels[kind] || "وابستگی سازمانی";

export const isFoundationDeleteCredentialError = (cause: unknown) => {
  const response = (cause as { response?: { status?: number; data?: { error?: unknown } } })?.response;
  return response?.status === 403 && String(response.data?.error || "").includes("رمز عبور");
};

export const personnelAssignmentHref = (personnelId: string, positionId: string) => {
  const params = new URLSearchParams({
    focus: personnelId,
    origin: `/dashboard/hr/structure/positions/${positionId}`,
  });
  return `/dashboard/hr/personnel?${params.toString()}`;
};
