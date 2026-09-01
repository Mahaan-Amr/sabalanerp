'use client';

import React, { createContext, useContext } from 'react';
import { ErpInlineState, ErpLoading } from '@/components/erp';
import { PartnerInquiryWorkspace, type PartnerInquiryWorkspaceProps } from '../../partner-sales/inquiries/PartnerInquiryWorkspace';
import { PartnerContractWizard, type PartnerContractWizardProps } from './PartnerContractWizard';

export type PartnerCreationChannel =
  | { kind: 'loading' }
  | { kind: 'blocked'; message: string }
  | { kind: 'inquiry'; props: PartnerInquiryWorkspaceProps }
  | { kind: 'wizard'; props: PartnerContractWizardProps };

// The central authenticated shell supplies this binding before enabling a
// Partner persona. Absence preserves the existing internal-Sales entry during
// the module rollout. A present Partner binding never falls through to Sales.
const Channel = createContext<PartnerCreationChannel | null>(null);
export const PartnerCreationChannelProvider = Channel.Provider;

export function PartnerCreationBoundary({ children }: { children: React.ReactNode }) {
  const channel = useContext(Channel);
  if (!channel) return <>{children}</>;
  if (channel.kind === 'loading') return <ErpLoading />;
  if (channel.kind === 'blocked') return <ErpInlineState kind="permission" title={channel.message} />;
  if (channel.kind === 'inquiry') return <PartnerInquiryWorkspace {...channel.props} />;
  return <PartnerContractWizard {...channel.props} />;
}
