'use client';

import { useParams } from 'next/navigation';
import { ErpPage } from '@/components/erp';
import { ShipmentQuantitySummary } from '@/features/shipment-quantities/ShipmentQuantitySummary';

export default function CustomerShipmentQuantitiesPage() {
  const customerId = useParams().id as string;
  return (
    <ErpPage
      eyebrow="مشتری"
      title="وضعیت ارسال مشتری"
      description="جمع شناخته‌شده هر واحد با امکان ردیابی تا قرارداد و ردیف مبدأ"
      backHref={`/dashboard/crm/customers/${customerId}`}
    >
      <ShipmentQuantitySummary customerId={customerId} />
    </ErpPage>
  );
}
