import { ProjectReturnReceiptPage } from '@/features/stone-returns/ProjectReturnReceiptPage';

export default async function LogisticsProjectReturnReceiptPage({ params }: { params: Promise<{ receiptId: string }> }) {
  return <ProjectReturnReceiptPage receiptId={(await params).receiptId} />;
}
