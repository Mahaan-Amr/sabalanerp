import { StoneReturnReviewPage } from '@/features/stone-returns/StoneReturnReviewPage';

export default async function AccountingStoneReturnReview({ params }: { params: Promise<{ receiptId: string }> }) {
  const { receiptId } = await params;
  return <StoneReturnReviewPage key={receiptId} receiptId={receiptId} />;
}
