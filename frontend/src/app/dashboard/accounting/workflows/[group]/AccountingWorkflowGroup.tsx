'use client';

import { FaBalanceScale, FaClipboardCheck, FaMoneyCheckAlt, FaChartLine } from 'react-icons/fa';
import { ErpActionGrid, ErpPage } from '@/components/erp';
import { accountingNavigationGroups, type AccountingNavigationGroup } from '@/features/accounting/accountingNavigation';

const groupIcons = {
  review: FaClipboardCheck,
  money: FaMoneyCheckAlt,
  records: FaBalanceScale,
  reports: FaChartLine,
};

export default function AccountingWorkflowGroup({ groupId }: { groupId: AccountingNavigationGroup['id'] | string }) {
  const group = accountingNavigationGroups.find(item => item.id === groupId)!;
  const Icon = groupIcons[group.id];
  return <ErpPage eyebrow="حسابداری" title={group.label} description={group.description} backHref="/dashboard/accounting">
    <ErpActionGrid columns={3} items={group.links.map(link => ({
      title: link.label, description: link.description, href: link.href, icon: Icon, tone: 'primary' as const,
    }))} />
  </ErpPage>;
}
