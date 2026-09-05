import { DestinationDutyDetail } from '@/features/hr-duties/DestinationDutyDetail';

export default async function DutyDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <DestinationDutyDetail workspace="crm" dutyId={params.id} />;
}
