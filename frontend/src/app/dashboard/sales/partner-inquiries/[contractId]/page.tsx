import { PartnerResponderRuntime } from '@/features/partner-sales/workspaces/PartnerResponderRuntime';
export default async function PartnerInquiryContractPage({ params }: { params: Promise<{ contractId: string }> }) {
  const { contractId } = await params;
  return <PartnerResponderRuntime contractId={contractId} />;
}
