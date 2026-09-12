'use client';

import { ManagementWorkspace } from '../management/ManagementWorkspace';
import { createPartnerManagementHttpPort } from '../management/partnerManagementHttpPort';
import { createPartnerWorkspaceHttpPort } from './partnerWorkspaceHttpPort';
import { createPartnerRuntimeCommandPort } from './partnerRuntimeCommandPort';
import { PartnerActivationPanel } from '../activation/PartnerActivationPanel';
import { useAuth } from '@/contexts/AuthContext';

const queries = createPartnerWorkspaceHttpPort();
const commands = createPartnerRuntimeCommandPort();
const management = createPartnerManagementHttpPort();

export function PartnerManagementRuntime() {
  const { user } = useAuth();
  return <div className="space-y-6">{user?.role === 'ADMIN' && <PartnerActivationPanel />}
    <ManagementWorkspace queryPort={queries} commandPort={commands} managementPort={management} /></div>;
}
