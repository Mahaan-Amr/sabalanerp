'use client';

import { createPartnerInquiryHttpPorts } from '../inquiries/partnerInquiryHttpPorts';
import { ResponderWorkspace } from '../responder/ResponderWorkspace';
import { createPartnerWorkspaceHttpPort } from './partnerWorkspaceHttpPort';
import { ResponderContractWorkspace } from '../responder/ResponderContractWorkspace';

const queries = createPartnerWorkspaceHttpPort();
const { commands, queries: inquiryQueries } = createPartnerInquiryHttpPorts();

export function PartnerResponderRuntime({ contractId }: { contractId?: string }) {
  if (contractId) return <ResponderContractWorkspace contractId={contractId} queryPort={queries} inquiryQueryPort={inquiryQueries} commandPort={commands} />;
  return <ResponderWorkspace queryPort={queries} inquiryQueryPort={inquiryQueries} commandPort={commands} />;
}
