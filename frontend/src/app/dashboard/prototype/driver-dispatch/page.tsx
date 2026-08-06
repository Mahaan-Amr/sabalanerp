import { Suspense } from 'react';
import { ErpLoading } from '@/components/erp';
import DriverDispatchPrototype from './prototype-client';

export default function DriverDispatchPrototypePage() {
  return (
    <Suspense fallback={<ErpLoading />}>
      <DriverDispatchPrototype />
    </Suspense>
  );
}
