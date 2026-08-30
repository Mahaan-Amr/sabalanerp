import ResponderFixturePreview from '@/features/partner-sales/responder/ResponderFixturePreview';
import type { ResponderScenario } from '@/features/partner-sales/responder/fixturePorts';
import { PartnerResponderRuntime } from '@/features/partner-sales/workspaces/PartnerResponderRuntime';

const scenarios: readonly string[] = ['RESPONDER', 'PARTIAL', 'UNCERTAIN', 'PAUSED', 'REASSIGNED', 'EXPIRED', 'UNASSIGNED', 'MULTIPLE', 'REFRESH_DENIED'];

export default function PartnerResponderPage({ searchParams }: { searchParams: { fixture?: string } }) {
  if (process.env.NEXT_PUBLIC_ENABLE_PROTOTYPES === '1' && searchParams.fixture && scenarios.includes(searchParams.fixture)) {
    return <ResponderFixturePreview scenario={searchParams.fixture as ResponderScenario} />;
  }
  return <PartnerResponderRuntime />;
}
