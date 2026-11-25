import { ProjectReturnIntake } from '@/features/stone-returns/ProjectReturnIntake';

export default async function NewLogisticsStoneReturnPage({ searchParams }: { searchParams: Promise<{ visitId?: string | string[] }> }) {
  const { visitId } = await searchParams;
  const selectedVisit = typeof visitId === 'string' ? visitId : undefined;
  return <ProjectReturnIntake key={selectedVisit} visitId={selectedVisit} />;
}
