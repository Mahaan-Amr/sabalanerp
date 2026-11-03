'use client';

import { useParams } from 'next/navigation';
import { ErpPage } from '@/components/erp';
import { ShipmentQuantitySummary } from '@/features/shipment-quantities/ShipmentQuantitySummary';

export default function ContractShipmentQuantitiesPage() {
  const contractId = useParams().id as string;
  return (
    <ErpPage
      eyebrow="فروش"
      title="وضعیت ارسال قرارداد"
      description="تفکیک رزرو بارگیری از خروج فیزیکی برای هر ردیف پایدار قرارداد"
      backHref={`/dashboard/sales/contracts/${contractId}`}
    >
      <ShipmentQuantitySummary contractId={contractId} />
    </ErpPage>
  );
}
