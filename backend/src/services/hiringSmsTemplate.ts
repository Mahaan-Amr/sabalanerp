export const APPROVED_HIRING_INVITATION_TEMPLATE_ID = '343660';
const PREVIOUS_HIRING_INVITATION_TEMPLATE_ID = '343360';

// Keep the deployment environment compatible with the previous immutable image.
// The old configuration is an explicit alias, never an outgoing provider template.
export const isSupportedHiringInvitationTemplate = (value: string) =>
  value === APPROVED_HIRING_INVITATION_TEMPLATE_ID || value === PREVIOUS_HIRING_INVITATION_TEMPLATE_ID;

export const resolveHiringInvitationTemplate = (value?: string) => {
  const configured = value || APPROVED_HIRING_INVITATION_TEMPLATE_ID;
  if (!isSupportedHiringInvitationTemplate(configured)) {
    throw new Error('Unsupported hiring invitation SMS template configuration.');
  }
  return Number(APPROVED_HIRING_INVITATION_TEMPLATE_ID);
};
