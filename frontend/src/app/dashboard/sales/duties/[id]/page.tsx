import { DestinationDutyDetail } from '@/features/hr-duties/DestinationDutyDetail';

export default function DutyDetailPage({ params }: { params: { id: string } }) {
  return <DestinationDutyDetail workspace="sales" dutyId={params.id} />;
}
