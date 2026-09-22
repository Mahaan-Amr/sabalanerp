import type { CrossWorkspaceDuty } from './crossWorkspaceDutyApi';

export const destinationDutyHref = (
  workspace: string,
  duty: Pick<CrossWorkspaceDuty, 'id' | 'status' | 'sourceActionCode' | 'destinationHref'>,
) => {
  const workspacePrefix = `/dashboard/${workspace}/`;
  if (
    duty.status === 'OPEN'
    && ['SALES_EDIT_CONTRACT_CORRECTION', 'PARTNER_PRICE_REVIEW', 'PARTNER_PRICE_RESULT'].includes(duty.sourceActionCode)
    && duty.destinationHref?.startsWith(workspacePrefix)
  ) {
    return duty.destinationHref;
  }
  return `/dashboard/${workspace}/duties/${duty.id}`;
};
