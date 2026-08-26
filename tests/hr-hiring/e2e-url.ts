export const hrHiringE2eUrl = (path: string) =>
  `${process.env.HR_HIRING_E2E_BASE_URL || "http://127.0.0.1:3100"}${path}`;
