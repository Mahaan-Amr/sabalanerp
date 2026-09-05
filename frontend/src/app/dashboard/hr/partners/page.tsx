import { notFound } from 'next/navigation';
import ManagementFixturePreview from '@/features/partner-sales/management/ManagementFixturePreview';

// Identity-only entry. Production binding is supplied by the shared shell owner in issue 334.
export default function HrPartnerIdentityPage({ searchParams }: { searchParams: { fixture?: string } }) {
  if (process.env.NEXT_PUBLIC_ENABLE_PROTOTYPES !== '1' || searchParams.fixture !== 'HR') notFound();
  return <ManagementFixturePreview persona="HR" />;
}
