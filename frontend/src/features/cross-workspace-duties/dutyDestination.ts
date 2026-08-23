import type { CrossWorkspaceDuty } from './crossWorkspaceDutyApi';

export const destinationDutyHref = (
  workspace: string,
  duty: Pick<CrossWorkspaceDuty, 'id' | 'status' | 'sourceActionCode' | 'destinationHref'>,
) => {
  const workspacePrefix = `/dashboard/${workspace}/`;
  if (
    duty.status === 'OPEN'
    && duty.sourceActionCode === 'SALES_EDIT_CONTRACT_CORRECTION'
    && duty.destinationHref?.startsWith(workspacePrefix)
  ) {
    return duty.destinationHref;
  }
  return `/dashboard/${workspace}/duties/${duty.id}`;
};
