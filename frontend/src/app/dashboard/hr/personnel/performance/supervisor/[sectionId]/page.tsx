import PerformanceWorkflow from "@/features/hr/performance-workflow/PerformanceWorkflow";

export default async function SupervisorPerformanceSectionPage({ params }: { params: Promise<{ sectionId: string }> }) {
  const { sectionId } = await params;
  return <PerformanceWorkflow initialSectionId={sectionId} />;
}
