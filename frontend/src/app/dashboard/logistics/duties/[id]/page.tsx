import { LogisticsWorkspace } from '@/features/logistics/LogisticsWorkspace';
import { DestinationDutyDetail } from '@/features/hr-duties/DestinationDutyDetail';

export default async function DutyDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  return <LogisticsWorkspace><DestinationDutyDetail workspace="logistics" dutyId={params.id} overlayScope="workspace" /></LogisticsWorkspace>;
}
