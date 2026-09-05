import PerformanceWorkflow from "@/features/hr/performance-workflow/PerformanceWorkflow";

export default async function PerformanceReviewPage({ params }: { params: Promise<{ submissionId: string }> }) {
  const { submissionId } = await params;
  return <PerformanceWorkflow initialSubmissionId={submissionId} />;
}
