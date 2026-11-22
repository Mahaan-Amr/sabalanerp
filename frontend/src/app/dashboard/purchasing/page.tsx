import PurchasingWorkspace from '@/features/purchasing/PurchasingWorkspace';
import {Suspense} from 'react';
import {ErpLoading} from '@/components/erp';
export default function PurchasingPage() { return <Suspense fallback={<ErpLoading/>}><PurchasingWorkspace dashboard /></Suspense>; }
