import axios from "axios";

const rawBase =
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === "production" ? "/api" : "http://localhost:5000");
const baseURL = `${rawBase.endsWith("/api") ? rawBase : `${rawBase}/api`}/hr-hiring`;

const internal = axios.create({ baseURL });
internal.interceptors.request.use((config) => {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const applicant = axios.create({ baseURL });
applicant.interceptors.request.use((config) => {
  const token =
    typeof window !== "undefined"
      ? sessionStorage.getItem("hrApplicantSession")
      : null;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const hiringAPI = {
  list: (params?: Record<string, string>) =>
    internal.get("/applications", { params }),
  archive: (id: string, reason: string) =>
    internal.post(`/applications/${id}/archive`, { reason }),
  restore: (id: string, reason: string) =>
    internal.post(`/applications/${id}/restore`, { reason }),
  getDeletionPreview: (id: string) =>
    internal.get(`/applications/${id}/deletion-preview`),
  permanentlyDelete: (id: string, data: any) =>
    internal.post(`/applications/${id}/permanent-delete`, data),
  get: (id: string) => internal.get(`/applications/${id}`),
  getOverview: (id: string, returnTo?: string) =>
    internal.get(`/applications/${id}/overview`, { params: returnTo ? { returnTo } : undefined }),
  getFullInformation: (id: string) =>
    internal.get(`/applications/${id}/full-information`),
  getClosureSummary: (id: string) =>
    internal.get(`/applications/${id}/closure-summary`),
  myAuthorities: () => internal.get("/me/authorities"),
  workItemSummary: () => internal.get("/work-items/summary"),
  workItems: (params?: Record<string, string>) =>
    internal.get("/work-items", { params }),
  workItemUsers: () => internal.get("/work-items/users"),
  createWorkItem: (data: any) => internal.post("/work-items", data),
  updateWorkItem: (id: string, data: any) =>
    internal.patch(`/work-items/${id}`, data),
  create: (data: any) => internal.post("/applications", data),
  invite: (id: string) => internal.post(`/applications/${id}/invitations`),
  refreshInvitationDelivery: (id: string, invitationId: string) =>
    internal.post(
      `/applications/${id}/invitations/${invitationId}/delivery/refresh`,
    ),
  recordDecision: (id: string, kind: string, data: any) =>
    internal.post(`/applications/${id}/decisions/${kind}`, data),
  getInitialInterview: (id: string) => internal.get(`/applications/${id}/initial-interview`),
  saveInitialInterviewDraft: (id: string, payload: Record<string, unknown>, expectedVersion: number) =>
    internal.put(`/applications/${id}/initial-interview/draft`, { payload, expectedVersion }),
  preIdentityTemplates: () => internal.get("/pre-identity/templates"),
  createPreIdentityTemplate: (data: any) =>
    internal.post("/pre-identity/templates", data),
  applyPreIdentityTemplate: (id: string, templateId: string) =>
    internal.post(`/applications/${id}/pre-identity/apply-template`, {
      templateId,
    }),
  addPreIdentityItem: (id: string, data: any) =>
    internal.post(`/applications/${id}/pre-identity/items`, data),
  finalizePreIdentity: (id: string) =>
    internal.post(`/applications/${id}/pre-identity/finalize`),
  recordPreIdentityResult: (id: string, itemId: string, data: FormData) =>
    internal.put(
      `/applications/${id}/pre-identity/items/${itemId}/result`,
      data,
    ),
  correctPreIdentityItem: (id: string, itemId: string, reason: string) =>
    internal.post(`/applications/${id}/pre-identity/items/${itemId}/correct`, {
      reason,
    }),
  downloadPreIdentityEvidence: (id: string, itemId: string) =>
    internal.get(
      `/applications/${id}/pre-identity/items/${itemId}/evidence/download`,
      { responseType: "blob" },
    ),
  resolvePreIdentityNegative: (id: string, itemId: string, data: any) =>
    internal.post(
      `/applications/${id}/pre-identity/items/${itemId}/resolve`,
      data,
    ),
  releasePreIdentity: (id: string) =>
    internal.post(`/applications/${id}/pre-identity/release`),
  decideAssessment: (id: string, data: any) =>
    internal.post(`/applications/${id}/assessments/decision`, data),
  createFormalAssessmentPlan: (id: string, data: any) =>
    internal.post(`/applications/${id}/formal-assessment-plans`, data),
  recordFormalAssessmentResult: (id: string, kind: string, data: any) =>
    internal.post(`/applications/${id}/formal-assessments/${kind}/result`, data),
  uploadFormalAssessmentEvidence: (id: string, kind: string, files: File[]) => {
    const data = new FormData();
    files.forEach((file) => data.append("files", file));
    return internal.post(`/applications/${id}/formal-assessments/${kind}/evidence`, data);
  },
  finallyReject: (id: string, data: any) =>
    internal.post(`/applications/${id}/final-rejection`, data),
  reactivateDisposition: (id: string, reason: string) =>
    internal.post(`/applications/${id}/disposition/reactivate`, { reason }),
  authorizeReopening: (id: string, reason: string) =>
    internal.post(`/applications/${id}/reopen/authorize`, { reason }),
  executeReopening: (id: string, data: any) =>
    internal.post(`/applications/${id}/reopen/execute`, data),
  addCollateralRequirement: (id: string, data: any) =>
    internal.post(`/applications/${id}/collateral-requirements`, data),
  returnForm: (id: string, data: any) =>
    internal.post(`/applications/${id}/form/return`, data),
  retryCorrectionNotification: (id: string) =>
    internal.post(`/applications/${id}/form/correction/retry`),
  uploadDocument: (id: string, data: FormData) =>
    internal.post(`/applications/${id}/documents`, data),
  downloadDocument: (id: string, documentId: string) =>
    internal.get(`/applications/${id}/documents/${documentId}/download`, {
      responseType: "blob",
    }),
  setIdentityCheck: (id: string, field: string, data: any) =>
    internal.put(`/applications/${id}/identity-checks/${field}`, data),
  approveIdentity: (id: string) =>
    internal.post(`/applications/${id}/identity/approve`),
  createCompensation: (id: string, data: any) =>
    internal.post(`/applications/${id}/compensation`, data),
  prepareCompensation: (id: string, snapshotId: string, data: any) =>
    internal.put(
      `/applications/${id}/compensation/${snapshotId}/prepare`,
      data,
    ),
  approveCompensationHr: (id: string, snapshotId: string) =>
    internal.post(`/applications/${id}/compensation/${snapshotId}/hr-approve`),
  approveCompensationFinance: (id: string, snapshotId: string) =>
    internal.post(
      `/applications/${id}/compensation/${snapshotId}/finance-approve`,
    ),
  retryOfferNotification: (id: string, snapshotId: string) =>
    internal.post(
      `/applications/${id}/compensation/${snapshotId}/notification/retry`,
    ),
  recordOfflineOfferDecision: (id: string, snapshotId: string, data: any) =>
    internal.post(
      `/applications/${id}/compensation/${snapshotId}/offline-decision`,
      data,
    ),
  addCollateral: (id: string, data: FormData) =>
    internal.post(`/applications/${id}/collateral`, data),
  reviewCollateral: (id: string, itemId: string, data: any) =>
    internal.put(`/applications/${id}/collateral/${itemId}/review`, data),
  returnCollateral: (id: string, itemId: string, data: any) =>
    internal.put(`/applications/${id}/collateral/${itemId}/return`, data),
  confirmCollateralReturn: (id: string, itemId: string) =>
    internal.post(`/applications/${id}/collateral/${itemId}/return-confirm`),
  approveCollateral: (id: string) =>
    internal.post(`/applications/${id}/collateral/approve`),
  collateralTemplates: (params?: Record<string, string>) =>
    internal.get("/collateral-templates", { params }),
  createCollateralTemplate: (data: any) =>
    internal.post("/collateral-templates", data),
  setCollateralTemplateActive: (id: string, isActive: boolean) =>
    internal.patch(`/collateral-templates/${id}/active`, { isActive }),
  applyCollateralTemplate: (id: string, templateId: string) =>
    internal.post(`/applications/${id}/collateral/apply-template`, {
      templateId,
    }),
  addAssessment: (id: string, data: FormData) =>
    internal.post(`/applications/${id}/assessments`, data),
  completeAssessments: (id: string) =>
    internal.post(`/applications/${id}/assessments/complete`),
  reviseAssessment: (id: string, assessmentId: string, resultJson: any) =>
    internal.post(`/applications/${id}/assessments/${assessmentId}/revise`, {
      resultJson,
    }),
  voidAssessment: (id: string, assessmentId: string, reason: string) =>
    internal.post(`/applications/${id}/assessments/${assessmentId}/void`, {
      reason,
    }),
  acknowledgeAssessmentReview: (id: string) =>
    internal.post(`/applications/${id}/assessments/review-acknowledge`),
  downloadAssessment: (id: string, assessmentId: string) =>
    internal.get(`/applications/${id}/assessments/${assessmentId}/download`, {
      responseType: "blob",
    }),
  downloadCollateral: (id: string, itemId: string) =>
    internal.get(`/applications/${id}/collateral/${itemId}/download`, {
      responseType: "blob",
    }),
  downloadCollateralReturnEvidence: (id: string, itemId: string) =>
    internal.get(
      `/applications/${id}/collateral/${itemId}/return-evidence/download`,
      { responseType: "blob" },
    ),
  convert: (id: string, data: any) =>
    internal.post(`/applications/${id}/convert`, data),
  uploadContract: (id: string, data: FormData) =>
    internal.post(`/applications/${id}/contracts`, data),
  downloadContract: (id: string, contractId: string) =>
    internal.get(`/applications/${id}/contracts/${contractId}/download`, {
      responseType: "blob",
    }),
  approveContract: (id: string, contractId: string) =>
    internal.post(`/applications/${id}/contracts/${contractId}/approve`),
  submitContract: (id: string, contractId: string) =>
    internal.post(`/applications/${id}/contracts/${contractId}/submit`),
  returnContract: (id: string, contractId: string, reason: string) =>
    internal.post(`/applications/${id}/contracts/${contractId}/return`, {
      reason,
    }),
  setPayroll: (id: string, data: any) =>
    internal.post(`/applications/${id}/payroll-participation`, data),
  setInsurance: (id: string, data: any) =>
    internal.put(`/applications/${id}/insurance`, data),
  addOnboardingTask: (id: string, data: any) =>
    internal.post(`/applications/${id}/onboarding-tasks`, data),
  updateOnboardingTask: (id: string, taskId: string, data: any) =>
    internal.put(`/applications/${id}/onboarding-tasks/${taskId}`, data),
  activate: (id: string) => internal.post(`/applications/${id}/activate`),
  close: (id: string, data: any) =>
    internal.post(`/applications/${id}/close`, data),
  authorities: () => internal.get("/authorities"),
  authorityUsers: () => internal.get("/authorities/users"),
  setAuthority: (data: any) => internal.post("/authorities", data),
  revokeAuthority: (id: string, reason: string) =>
    internal.post(`/authorities/${id}/revoke`, { reason }),
};

export const applicantHiringAPI = {
  verify: (mobile: string, otp: string) =>
    axios.post(`${baseURL}/public/invitations/verify`, { mobile, otp }),
  get: () => applicant.get("/public/application"),
  getClosedState: () => applicant.get("/public/application/closed-state"),
  saveDraft: (data: any) => applicant.put("/public/application/draft", data),
  submit: (data: any) => applicant.post("/public/application/submit", data),
  acceptCompensation: (fullName: string) =>
    applicant.post("/public/application/compensation/accept", {
      fullName,
      accepted: true,
    }),
  declineCompensation: (category: string, note: string) =>
    applicant.post("/public/application/compensation/decline", {
      category,
      note,
    }),
  submitFormalAssessmentResult: (kind: string, result: Record<string, unknown>) =>
    applicant.post(`/public/application/formal-assessments/${kind}/result`, { result }),
  uploadFormalAssessmentEvidence: (kind: string, files: File[]) => {
    const data = new FormData();
    files.forEach((file) => data.append("files", file));
    return applicant.post(`/public/application/formal-assessments/${kind}/evidence`, data);
  },
};

export const hiringError = (error: any) =>
  error?.response?.data?.error || error?.message || "عملیات ناموفق بود.";
