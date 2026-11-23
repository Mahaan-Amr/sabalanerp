import { LogisticsWorkspace } from '@/features/logistics/LogisticsWorkspace';
import { StoneReturnList } from '@/features/stone-returns/StoneReturnList';

export default function LogisticsStoneReturnsPage() {
  return <LogisticsWorkspace><StoneReturnList workspace="logistics" /></LogisticsWorkspace>;
}
