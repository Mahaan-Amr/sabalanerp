import { notFound } from 'next/navigation';
import { accountingNavigationGroups } from '@/features/accounting/accountingNavigation';
import AccountingWorkflowGroup from './AccountingWorkflowGroup';

export default async function AccountingWorkflowGroupPage({ params }: { params: Promise<{ group: string }> }) {
  const { group } = await params;
  if (!accountingNavigationGroups.some(item => item.id === group)) notFound();
  return <AccountingWorkflowGroup groupId={group} />;
}
