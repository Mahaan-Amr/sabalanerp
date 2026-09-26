import { notFound } from 'next/navigation';
import { FaBalanceScale, FaClipboardCheck, FaMoneyCheckAlt, FaChartLine } from 'react-icons/fa';
import { ErpActionGrid, ErpPage } from '@/components/erp';
import { accountingNavigationGroups } from '@/features/accounting/accountingNavigation';

const groupIcons = {
  review: FaClipboardCheck,
  money: FaMoneyCheckAlt,
  records: FaBalanceScale,
  reports: FaChartLine,
};

export default async function AccountingWorkflowGroupPage({ params }: { params: Promise<{ group: string }> }) {
  const { group: groupId } = await params;
  const group = accountingNavigationGroups.find(item => item.id === groupId);
  if (!group) notFound();
  const Icon = groupIcons[group.id];
  return <ErpPage eyebrow="حسابداری" title={group.label} description={group.description} backHref="/dashboard/accounting">
    <ErpActionGrid columns={3} items={group.links.map(link => ({
      title: link.label, description: link.description, href: link.href, icon: Icon, tone: 'primary' as const,
    }))} />
  </ErpPage>;
}
