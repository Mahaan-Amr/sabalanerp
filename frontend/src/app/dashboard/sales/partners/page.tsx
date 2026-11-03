import { notFound } from 'next/navigation';
import ManagementFixturePreview from '@/features/partner-sales/management/ManagementFixturePreview';
import type { ManagementPersona } from '@/features/partner-sales/management/fixturePorts';

const personas: readonly string[] = ['HR', 'SALES', 'ACCOUNTING', 'CRM', 'ADMIN', 'MANAGER', 'PARTNER', 'EXPIRED'];

// Issue 331 module preview only. Issue 334 owns authenticated runtime and shell registration.
export default function PartnerManagementPage({ searchParams }: { searchParams: { fixture?: string } }) {
  if (process.env.NEXT_PUBLIC_ENABLE_PROTOTYPES !== '1' || !searchParams.fixture || !personas.includes(searchParams.fixture)) notFound();
  return <ManagementFixturePreview persona={searchParams.fixture as ManagementPersona} />;
}
