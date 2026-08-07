export type ShipmentProjectionHealth = 'CURRENT' | 'STALE' | 'LEGACY_UNRECONCILED' | 'EVIDENCE_CONFLICT';

export interface ShipmentQuantityRow {
  contractId: string;
  contractItemId: string;
  productRowId: string;
  contractNumber?: string;
  productName?: string | null;
  unit: string;
  quantities: { contracted: string; finalizedReserved: string; physicallyDispatched: string; availableToLoad: string } | null;
  health: ShipmentProjectionHealth;
  healthReasons: string[];
  hasNegativeAvailability: boolean;
}

export const shipmentHealthPresentation = (health: ShipmentProjectionHealth) => ({
  CURRENT: { label: 'به‌روز', tone: 'success' as const },
  STALE: { label: 'نیازمند به‌روزرسانی', tone: 'warning' as const },
  LEGACY_UNRECONCILED: { label: 'سابقه تطبیق‌نشده', tone: 'warning' as const },
  EVIDENCE_CONFLICT: { label: 'تعارض شواهد', tone: 'danger' as const },
}[health]);

export const formatShipmentQuantity = (value: string | null | undefined) => {
  if (value == null) return 'نامشخص';
  const [whole, fraction = ''] = value.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return `${Number(whole).toLocaleString('fa-IR')}${trimmed ? `٫${trimmed.replace(/\d/g, (digit) => Number(digit).toLocaleString('fa-IR'))}` : ''}`;
};
