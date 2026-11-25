import { ProjectReturnAllocationPage } from '@/features/stone-returns/ProjectReturnAllocationPage';

export default async function AccountingProjectReturnReview({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  return <ProjectReturnAllocationPage key={caseId} caseId={caseId} />;
}
