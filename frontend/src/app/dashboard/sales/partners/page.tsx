import ManagementFixturePreview from '@/features/partner-sales/management/ManagementFixturePreview';
import type { ManagementPersona } from '@/features/partner-sales/management/fixturePorts';
import { PartnerManagementRuntime } from '@/features/partner-sales/workspaces/PartnerManagementRuntime';

const personas: readonly string[] = ['HR', 'SALES', 'ACCOUNTING', 'CRM', 'ADMIN', 'MANAGER', 'PARTNER', 'EXPIRED'];

export default async function PartnerManagementPage(props: { searchParams: Promise<{ fixture?: string }> }) {
  const searchParams = await props.searchParams;
  if (process.env.NEXT_PUBLIC_ENABLE_PROTOTYPES === '1' && searchParams.fixture && personas.includes(searchParams.fixture)) {
    return <ManagementFixturePreview persona={searchParams.fixture as ManagementPersona} />;
  }
  return <PartnerManagementRuntime />;
}
