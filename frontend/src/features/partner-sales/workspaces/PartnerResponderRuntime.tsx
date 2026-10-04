'use client';

import { createPartnerInquiryHttpPorts } from '../inquiries/partnerInquiryHttpPorts';
import { ResponderWorkspace } from '../responder/ResponderWorkspace';
import { createPartnerWorkspaceHttpPort } from './partnerWorkspaceHttpPort';

const queries = createPartnerWorkspaceHttpPort();
const { commands, queries: inquiryQueries } = createPartnerInquiryHttpPorts();

export function PartnerResponderRuntime() {
  return <ResponderWorkspace queryPort={queries} inquiryQueryPort={inquiryQueries} commandPort={commands} />;
}
