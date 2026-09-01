import PerformanceWorkflow from "@/features/hr/performance-workflow/PerformanceWorkflow";

export default function PerformanceReviewPage({ params }: { params: { submissionId: string } }) {
  return <PerformanceWorkflow initialSubmissionId={params.submissionId} />;
}
