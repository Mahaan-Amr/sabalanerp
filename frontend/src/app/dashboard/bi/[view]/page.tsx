import { notFound } from 'next/navigation';
import BiWorkspace, { type BiView } from '@/features/bi/BiWorkspace';

const views = new Set<BiView>([
  'realized-sales', 'pipeline', 'collections', 'delivery', 'recommendations',
  'reconciliation', 'sellers', 'commercial-mix',
]);

export default async function BusinessIntelligenceViewPage(props: { params: Promise<{ view: string }> }) {
  const params = await props.params;
  if (!views.has(params.view as BiView)) notFound();
  return <BiWorkspace view={params.view as BiView} />;
}
