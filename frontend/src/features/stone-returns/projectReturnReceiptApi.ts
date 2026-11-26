import api from '@/lib/api';
import type { ProjectReturnLinearCalculation } from './projectReturnQuantity';
import type { ProjectReturnVisit } from './projectReturnVisitApi';
import type { StoneReturnOption } from './stoneReturnApi';

export type ProjectReturnProduct = {
  productId: string;
  productName: string;
  productCode: string;
  unit: string;
  suggestedWidthMeters?: string | null;
  partnerContractId?: string | null;
};

export type ProjectReturnItem = ProjectReturnProduct & {
  id: string;
  healthyQuantity: string;
  damagedQuantity: string;
  healthyCalculation?: ProjectReturnLinearCalculation | null;
  damagedCalculation?: ProjectReturnLinearCalculation | null;
  inventoryIdentityId?: string | null;
  effectiveWidthMeters?: string | null;
  healthyAreaSquareMeters?: string | null;
  damagedAreaSquareMeters?: string | null;
};

export const projectReturnOperationStatuses = {
  ACTIVE: { label: 'دریافت‌شده', tone: 'info' },
  REWORK_REQUESTED: { label: 'در انتظار بررسی حسابداری', tone: 'warning' },
  RETURNED_TO_LOGISTICS: { label: 'ارجاع‌شده به لجستیک', tone: 'info' },
  CANCELLED: { label: 'لغوشده', tone: 'neutral' },
} as const;

export type ProjectReturnOperationalState = {
  hasAllocations: boolean;
  reservations: Array<{ id: string; identityId: string; purposeId: string; quantity: string; unit: string }>;
  stockBlock: string | null;
  canEdit: boolean;
  canRequestRework: boolean;
  canReturnToLogistics: boolean;
};

export type ProjectReturnReceipt = {
  id: string;
  customerId: string;
  customerName: string;
  createdAt: string;
  visit: ProjectReturnVisit | null;
  legacyFinalizationId: string | null;
  canSubmitCorrection?: boolean;
  operationStatus: keyof typeof projectReturnOperationStatuses;
  version: {
    id: string;
    number: number;
    baseVersionId: string | null;
    submittedAt: string | null;
    assignedAt: string | null;
    projects: Array<{ projectId: string; projectName: string }>;
    items: ProjectReturnItem[];
  };
};

export function projectReturnReceiptStatus(receipt: ProjectReturnReceipt) {
  if (!receipt.legacyFinalizationId) return projectReturnOperationStatuses[receipt.operationStatus];
  return receipt.version.assignedAt
    ? { label: 'در انتظار اصلاح', tone: 'warning' } as const
    : { label: 'اصلاح ارسال شد', tone: 'info' } as const;
}

export type ProjectReturnIntake = {
  visitId: string;
  customerId: string;
  projectIds: string[];
  items: Array<Pick<ProjectReturnItem, 'productId' | 'unit' | 'effectiveWidthMeters' | 'partnerContractId'> & (
    { healthyQuantity: string; healthyCalculation?: never } | { healthyCalculation: ProjectReturnLinearCalculation; healthyQuantity?: never }
  ) & (
    { damagedQuantity: string; damagedCalculation?: never } | { damagedCalculation: ProjectReturnLinearCalculation; damagedQuantity?: never }
  )>;
};

export type ProjectReturnReceiptDetails = ProjectReturnReceipt & {
  canManage: boolean;
  operational: ProjectReturnOperationalState | null;
  versions: Array<{ id: string; number: number; submittedAt: string | null }>;
  operations: Array<{
    id: string;
    kind: 'EDITED' | 'CANCELLED' | 'REWORK_REQUESTED' | 'RETURNED_TO_LOGISTICS';
    occurredAt: string;
  }>;
};

type Envelope<T> = { data: T };

const path = '/logistics/project-returns';
export const projectReturnListHref = '/dashboard/logistics/returns/project';
export const projectReturnReceiptHref = (id: string) => `${projectReturnListHref}/${encodeURIComponent(id)}`;

export const projectReturnReceiptApi = {
  customers: async (search: string) =>
    (await api.get<Envelope<StoneReturnOption[]>>(`${path}/customers`, { params: { search } })).data.data,
  projects: async (customerId: string) =>
    (await api.get<Envelope<StoneReturnOption[]>>(`${path}/customers/${encodeURIComponent(customerId)}/projects`)).data.data,
  partnerContracts: async (customerId: string, projectIds: string[], search: string) => {
    const params = new URLSearchParams({ customerId, search });
    projectIds.forEach(projectId => params.append('projectId', projectId));
    return (await api.get<Envelope<StoneReturnOption[]>>(`${path}/partner-contracts`, { params })).data.data;
  },
  products: async (customerId: string, projectIds: string[], search: string, partnerContractId?: string) => {
    const params = new URLSearchParams({ customerId, search });
    projectIds.forEach(projectId => params.append('projectId', projectId));
    if (partnerContractId) params.set('partnerContractId', partnerContractId);
    return (await api.get<Envelope<ProjectReturnProduct[]>>(`${path}/products`, { params })).data.data;
  },
  submit: async (input: ProjectReturnIntake) =>
    (await api.post<Envelope<ProjectReturnReceipt>>(path, input)).data.data,
  submitCorrection: async (id: string, input: Pick<ProjectReturnIntake, 'projectIds' | 'items'> & { expectedVersionId: string }) =>
    (await api.post<Envelope<ProjectReturnReceipt>>(`${path}/${encodeURIComponent(id)}/correction/submit`, input)).data.data,
  read: async (id: string) =>
    (await api.get<Envelope<ProjectReturnReceiptDetails>>(`${path}/${encodeURIComponent(id)}`)).data.data,
  readVersion: async (id: string, versionId: string) =>
    (await api.get<Envelope<ProjectReturnReceipt>>(`${path}/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`)).data.data,
  edit: async (id: string, expectedVersionId: string, input: ProjectReturnIntake) =>
    (await api.post<Envelope<ProjectReturnReceiptDetails>>(`${path}/${encodeURIComponent(id)}/edit`, { ...input, expectedVersionId })).data.data,
  change: async (id: string, action: 'cancel' | 'request-rework', expectedVersionId: string) =>
    (await api.post<Envelope<ProjectReturnReceiptDetails>>(`${path}/${encodeURIComponent(id)}/${action}`, { expectedVersionId })).data.data,
  list: async (after?: string) =>
    (await api.get<Envelope<{ items: ProjectReturnReceipt[]; nextCursor: string | null }>>(path, { params: { after } })).data.data,
};
