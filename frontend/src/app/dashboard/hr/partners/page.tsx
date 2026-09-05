import ManagementFixturePreview from '@/features/partner-sales/management/ManagementFixturePreview';
import { PartnerManagementRuntime } from '@/features/partner-sales/workspaces/PartnerManagementRuntime';

export default async function HrPartnerIdentityPage(props: { searchParams: Promise<{ fixture?: string }> }) {
  const searchParams = await props.searchParams;
  if (process.env.NEXT_PUBLIC_ENABLE_PROTOTYPES === '1' && searchParams.fixture === 'HR') {
    return <ManagementFixturePreview persona="HR" />;
  }
  return <PartnerManagementRuntime />;
}
