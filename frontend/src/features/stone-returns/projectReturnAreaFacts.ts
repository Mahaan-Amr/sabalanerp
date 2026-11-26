import type { ProjectReturnItem } from './projectReturnReceiptApi';
import { displayStoneReturnQuantity } from './stoneReturnApi';

export const healthyProjectReturnAreaLabel = 'مساحت سالم';
export const damagedProjectReturnAreaLabel = 'مساحت آسیب‌دیده';

export function projectReturnQuantityFacts(item: Pick<ProjectReturnItem,
  'unit' | 'healthyQuantity' | 'damagedQuantity' | 'healthyAreaSquareMeters' | 'damagedAreaSquareMeters'>) {
  if (item.unit === 'squareMeter') return [
    { label: healthyProjectReturnAreaLabel, value: displayStoneReturnQuantity(item.healthyAreaSquareMeters ?? item.healthyQuantity, item.unit) },
    { label: damagedProjectReturnAreaLabel, value: displayStoneReturnQuantity(item.damagedAreaSquareMeters ?? item.damagedQuantity, item.unit) },
  ];
  const quantities = [
    { label: 'مقدار سالم', value: displayStoneReturnQuantity(item.healthyQuantity, item.unit) },
    { label: 'مقدار آسیب‌دیده', value: displayStoneReturnQuantity(item.damagedQuantity, item.unit) },
  ];
  if (item.unit !== 'meter') return quantities;
  const areaValue = (value: string | null | undefined) => value == null ? '—' : displayStoneReturnQuantity(value, 'squareMeter');
  return [
    ...quantities,
    { label: healthyProjectReturnAreaLabel, value: areaValue(item.healthyAreaSquareMeters) },
    { label: damagedProjectReturnAreaLabel, value: areaValue(item.damagedAreaSquareMeters) },
  ];
}
