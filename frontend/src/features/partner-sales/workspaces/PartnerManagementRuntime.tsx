'use client';

import { ErpPresentationProvider } from '@/components/erp';
import { ManagementWorkspace } from '../management/ManagementWorkspace';
import { createPartnerManagementHttpPort } from '../management/partnerManagementHttpPort';
import { createPartnerWorkspaceHttpPort } from './partnerWorkspaceHttpPort';
import { createPartnerRuntimeCommandPort } from './partnerRuntimeCommandPort';

const queries = createPartnerWorkspaceHttpPort();
const commands = createPartnerRuntimeCommandPort();
const management = createPartnerManagementHttpPort();

export function PartnerManagementRuntime() {
  return <ErpPresentationProvider scope="workspace"><ManagementWorkspace queryPort={queries} commandPort={commands} managementPort={management} /></ErpPresentationProvider>;
}
