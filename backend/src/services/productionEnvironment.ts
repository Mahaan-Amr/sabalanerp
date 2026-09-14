import { isSupportedHiringInvitationTemplate } from './hiringSmsTemplate';
import { validatePerformanceVaultEnvironment } from './personnelPerformancePayloadStore';
import { validatePerformanceExportKeyEnvironment } from './personnelPerformanceDisclosureStore';
export const validateProductionEnvironment = (environment: NodeJS.ProcessEnv = process.env) => {
  if (environment.NODE_ENV !== "production") return;

  const jwtSecret = environment.JWT_SECRET || "";
  const hasWeakJwtSecret =
    jwtSecret.length < 32 || jwtSecret.includes("your-super-secret");
  const requiredVars = [
    "DATABASE_URL",
    "JWT_SECRET",
    "FRONTEND_URL",
    "PUBLIC_APP_URL",
    "WEB_PUSH_VAPID_SUBJECT",
    "WEB_PUSH_VAPID_PUBLIC_KEY",
    "WEB_PUSH_VAPID_PRIVATE_KEY",
    "SMS_IR_API_KEY",
    "SMS_IR_HIRING_INVITATION_TEMPLATE_ID",
    "SMS_IR_HIRING_INVITATION_TEMPLATE_PARAMETERS",
    "SMS_IR_HIRING_CORRECTION_TEMPLATE_ID",
    "SMS_IR_HIRING_CORRECTION_TEMPLATE_PARAMETERS",
    "SMS_IR_HIRING_OFFER_TEMPLATE_ID",
    "SMS_IR_HIRING_OFFER_TEMPLATE_PARAMETERS",
    "SMS_IR_DISPATCH_CONFIRM_OTP_TEMPLATE_ID",
    "SMS_IR_DISPATCH_EXIT_TEMPLATE_ID",
    "SMS_IR_DISPATCH_EXIT_MANUAL_RETRY_TEMPLATE_ID",
    "PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_ID",
    "PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_BASE64",
    "PERFORMANCE_PROMOTION_ATTESTATION_KEY_ID",
    "PERFORMANCE_PROMOTION_ATTESTATION_KEY_BASE64",
    "PERFORMANCE_MEASUREMENT_ATTESTATION_KEY_ID",
    "PERFORMANCE_MEASUREMENT_ATTESTATION_PUBLIC_KEY_BASE64",
    "PERFORMANCE_RELEASE_COMMIT",
    "PERFORMANCE_RELEASE_SOURCE_HASH",
    "PERFORMANCE_RELEASE_SCHEMA_HASH",
    "PERFORMANCE_RELEASE_POLICY_HASH",
    "PERFORMANCE_RELEASE_INFRASTRUCTURE_HASH",
    "PERFORMANCE_RELEASE_BACKEND_IMAGE",
    "PERFORMANCE_RELEASE_FRONTEND_IMAGE",
    "PERFORMANCE_RELEASE_INQUIRY_IMAGE",
    "PERFORMANCE_RUNTIME_INFRASTRUCTURE_HASH",
    "DEPLOYMENT_BACKEND_IMAGE",
    "DEPLOYMENT_FRONTEND_IMAGE",
    "DEPLOYMENT_INQUIRY_IMAGE",
    "PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_ID",
    "PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_BASE64",
  ];
  const missingVars = requiredVars.filter((key) => !process.env[key]);
  const hiringTemplateId =
    environment.SMS_IR_HIRING_INVITATION_TEMPLATE_ID || "";
  const hasInvalidHiringTemplate =
    !isSupportedHiringInvitationTemplate(hiringTemplateId) ||
    environment.SMS_IR_HIRING_CORRECTION_TEMPLATE_ID !== "763918" ||
    environment.SMS_IR_HIRING_OFFER_TEMPLATE_ID !== "894291";
  const hiringTemplateParameters = (
    environment.SMS_IR_HIRING_INVITATION_TEMPLATE_PARAMETERS || ""
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const hasInvalidHiringTemplateParameters =
    hiringTemplateParameters.length !== 1 ||
    hiringTemplateParameters[0] !== "CODE";
  const correctionTemplateParameters = (environment.SMS_IR_HIRING_CORRECTION_TEMPLATE_PARAMETERS || '').split(',').map((value) => value.trim()).filter(Boolean);
  const offerTemplateParameters = (environment.SMS_IR_HIRING_OFFER_TEMPLATE_PARAMETERS || '').split(',').map((value) => value.trim()).filter(Boolean);
  const hasInvalidHiringCorrectionParameters = correctionTemplateParameters.join(',') !== 'DETAILS,CODE';
  const hasInvalidHiringOfferParameters = offerTemplateParameters.join(',') !== 'CODE';
  const hasInvalidSmsEnvironment =
    environment.SMS_IR_ENVIRONMENT !== "production";
  const dispatchTemplateIds = [
    environment.SMS_IR_DISPATCH_CONFIRM_OTP_TEMPLATE_ID || "",
    environment.SMS_IR_DISPATCH_EXIT_TEMPLATE_ID || "",
    environment.SMS_IR_DISPATCH_EXIT_MANUAL_RETRY_TEMPLATE_ID || "",
  ];
  const hasInvalidDispatchTemplates =
    dispatchTemplateIds.some((value) => !/^\d+$/.test(value) || Number(value) <= 0) ||
    new Set(dispatchTemplateIds).size !== dispatchTemplateIds.length;
  let hasInvalidPublicAppUrl = false;
  try {
    const publicAppUrl = new URL(environment.PUBLIC_APP_URL || "");
    hasInvalidPublicAppUrl = publicAppUrl.protocol !== "https:";
  } catch {
    hasInvalidPublicAppUrl = true;
  }
  let hasInvalidPerformanceVault = false;
  try {
    validatePerformanceVaultEnvironment(environment);
    validatePerformanceExportKeyEnvironment(environment);
  } catch {
    hasInvalidPerformanceVault = true;
  }

  if (
    missingVars.length > 0 ||
    hasWeakJwtSecret ||
    hasInvalidHiringTemplate ||
    hasInvalidHiringTemplateParameters ||
    hasInvalidHiringCorrectionParameters ||
    hasInvalidHiringOfferParameters ||
    hasInvalidSmsEnvironment ||
    hasInvalidDispatchTemplates ||
    hasInvalidPublicAppUrl ||
    hasInvalidPerformanceVault
  ) {
    const details = [
      missingVars.length > 0 ? `Missing vars: ${missingVars.join(", ")}` : "",
      hasWeakJwtSecret
        ? "JWT_SECRET must be at least 32 chars and not a placeholder."
        : "",
      hasInvalidHiringTemplate
        ? "Hiring SMS templates require invitation=343660 (legacy configuration alias 343360), correction=763918, offer=894291."
        : "",
      hasInvalidHiringTemplateParameters
        ? "SMS_IR_HIRING_INVITATION_TEMPLATE_PARAMETERS must be exactly CODE."
        : "",
      hasInvalidHiringCorrectionParameters
        ? "SMS_IR_HIRING_CORRECTION_TEMPLATE_PARAMETERS must be exactly DETAILS,CODE."
        : "",
      hasInvalidHiringOfferParameters
        ? "SMS_IR_HIRING_OFFER_TEMPLATE_PARAMETERS must be exactly CODE."
        : "",
      hasInvalidSmsEnvironment ? "SMS_IR_ENVIRONMENT must be production." : "",
      hasInvalidDispatchTemplates
        ? "Dispatch SMS template IDs must be distinct approved positive numeric values."
        : "",
      hasInvalidPublicAppUrl
        ? "PUBLIC_APP_URL must be a valid HTTPS origin used for the fixed applicant entry page."
        : "",
      hasInvalidPerformanceVault
        ? "Personnel performance encryption key id and exact 32-byte base64 key must be production-ready."
        : "",
    ].filter(Boolean);
    throw new Error(`Invalid production environment. ${details.join(" ")}`);
  }
};
