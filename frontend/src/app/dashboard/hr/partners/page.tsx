import ManagementFixturePreview from '@/features/partner-sales/management/ManagementFixturePreview';
import { PartnerManagementRuntime } from '@/features/partner-sales/workspaces/PartnerManagementRuntime';

export default function HrPartnerIdentityPage({ searchParams }: { searchParams: { fixture?: string } }) {
  if (process.env.NEXT_PUBLIC_ENABLE_PROTOTYPES === '1' && searchParams.fixture === 'HR') {
    return <ManagementFixturePreview persona="HR" />;
  }
  return <PartnerManagementRuntime />;
}
