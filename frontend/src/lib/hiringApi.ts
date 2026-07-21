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
  get: (id: string) => internal.get(`/applications/${id}`),
  myAuthorities: () => internal.get("/me/authorities"),
  create: (data: any) => internal.post("/applications", data),
  invite: (id: string) => internal.post(`/applications/${id}/invitations`),
  returnForm: (id: string, data: any) =>
    internal.post(`/applications/${id}/form/return`, data),
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
  collateralTemplates: () => internal.get("/collateral-templates"),
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
  setAuthority: (data: any) => internal.post("/authorities", data),
};

export const applicantHiringAPI = {
  verify: (mobile: string, otp: string) =>
    axios.post(`${baseURL}/public/invitations/verify`, { mobile, otp }),
  get: () => applicant.get("/public/application"),
  saveDraft: (data: any) => applicant.put("/public/application/draft", data),
  submit: (data: any) => applicant.post("/public/application/submit", data),
  acceptCompensation: (fullName: string) =>
    applicant.post("/public/application/compensation/accept", { fullName }),
};

export const hiringError = (error: any) =>
  error?.response?.data?.error || error?.message || "عملیات ناموفق بود.";
