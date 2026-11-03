import SalesReportingDashboard from '@/components/reporting/SalesReportingDashboard';
import BiWorkspacePrototype from './BiWorkspacePrototype';

export default function BusinessIntelligencePage() {
  if (process.env.NEXT_PUBLIC_BI_PROTOTYPE === '1') {
    return <BiWorkspacePrototype fallback={<SalesReportingDashboard mode="bi" />} />;
  }

  return <SalesReportingDashboard mode="bi" />;
}
