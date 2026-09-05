import PerformanceWorkflow from "@/features/hr/performance-workflow/PerformanceWorkflow";

export default function SupervisorPerformanceSectionPage({ params }: { params: { sectionId: string } }) {
  return <PerformanceWorkflow initialSectionId={params.sectionId} />;
}
