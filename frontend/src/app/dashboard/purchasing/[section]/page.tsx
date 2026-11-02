import { notFound } from 'next/navigation';
import PurchasingWorkspace, { type PurchasingTab } from '@/features/purchasing/PurchasingWorkspace';
import {Suspense} from 'react';
import {ErpLoading} from '@/components/erp';
const sections = ['requests', 'inquiries', 'orders', 'receipts', 'exchanges', 'suppliers', 'inventory', 'finance', 'changes'];
export default async function PurchasingSection({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!sections.includes(section)) notFound();
  return <Suspense fallback={<ErpLoading/>}><PurchasingWorkspace tab={section as PurchasingTab} /></Suspense>;
}
