import ResponderFixturePreview from '@/features/partner-sales/responder/ResponderFixturePreview';
import type { ResponderScenario } from '@/features/partner-sales/responder/fixturePorts';
import { PartnerInquiryRouteRuntime } from '@/features/partner-sales/inquiries/PartnerInquiryRouteRuntime';

const scenarios: readonly string[] = ['RESPONDER', 'PARTIAL', 'UNCERTAIN', 'PAUSED', 'REASSIGNED', 'EXPIRED', 'UNASSIGNED', 'MULTIPLE', 'REFRESH_DENIED'];

export default async function PartnerResponderPage(props: { searchParams: Promise<{ fixture?: string }> }) {
  const searchParams = await props.searchParams;
  if (process.env.NEXT_PUBLIC_ENABLE_PROTOTYPES === '1' && searchParams.fixture && scenarios.includes(searchParams.fixture)) {
    return <ResponderFixturePreview scenario={searchParams.fixture as ResponderScenario} />;
  }
  return <PartnerInquiryRouteRuntime />;
}
