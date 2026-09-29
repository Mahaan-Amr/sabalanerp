import { LogisticsWorkspace } from '@/features/logistics/LogisticsWorkspace';
import { DestinationDutyQueue } from '@/features/hr-duties/DestinationDutyQueue';

export default function DutyQueuePage() {
  return <LogisticsWorkspace><DestinationDutyQueue workspace="logistics" metricPresentation="neumorphic" /></LogisticsWorkspace>;
}
