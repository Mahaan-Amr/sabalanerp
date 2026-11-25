import api from '@/lib/api';

export type ProjectReturnStatus = 'AWAITING_RECEIPT' | 'CANCELLED_WITHOUT_DELIVERY' | 'RECEIVED';

export const projectReturnStatuses = {
  AWAITING_RECEIPT: { label: 'در انتظار تحویل مرجوعی', tone: 'warning' },
  CANCELLED_WITHOUT_DELIVERY: { label: 'لغو بدون تحویل · در انتظار خروج', tone: 'neutral' },
  RECEIVED: { label: 'تحویل مرجوعی ثبت شد', tone: 'success' },
} as const;

export type ProjectReturnVisit = {
  id: string;
  driverSource: 'INTERNAL' | 'EXTERNAL' | 'CUSTOMER_PICKUP' | 'PERSONAL_PICKUP';
  status: string;
  projectReturnStatus: ProjectReturnStatus;
  admittedAt: string;
  driverName: string;
  vehicleType: string;
  plate: string;
};

const visitPath = '/logistics/project-return-visits';

export const projectReturnVisitApi = {
  list: async () => (await api.get<{ data: ProjectReturnVisit[]; capabilities: { canCancel: boolean } }>(visitPath)).data,
  cancel: async (id: string) => (await api.post<{ data: ProjectReturnVisit }>(`${visitPath}/${encodeURIComponent(id)}/cancel`)).data.data,
};

export function projectReturnDriverLabel(visit: ProjectReturnVisit) {
  return [visit.driverName, visit.vehicleType, visit.plate].filter(Boolean).join(' · ');
}
