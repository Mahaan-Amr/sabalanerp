export type BiSourceState = 'complete' | 'partial' | 'unavailable' | 'unauthorized';

export type BiSourceHealth = {
  source: 'SALES' | 'CRM' | 'ACCOUNTING' | 'LOGISTICS' | 'SECURITY';
  state: BiSourceState;
  refreshedAt: string | null;
  coverage: { covered: number; total: number } | null;
};

export type BiContractEvidence = {
  id: string;
  contractNumber: string;
  customer: string;
  project: string;
  status: string;
  statusLabel: string;
  amount: number;
  responsibleSeller: string;
  responsibleSellerId: string;
  realizedSellerId?: string | null;
  createdAt: string;
  realizedAt?: string | null;
  canOpenSource: boolean;
};

export type BiRecommendation = {
  id: string;
  priority: 'breached' | 'imminent' | 'deterioration' | 'reconciliation';
  title: string;
  evidence: string;
  count: number;
  value?: number | null;
  destination: string;
};

export type BiSnapshot = {
  snapshotVersion: 1;
  generatedAt: string;
  generatedAtLabel: string;
  currency: string;
  scope: { label: string; mode: string; departmentId?: string | null; sellerId?: string | null };
  period: { label: string; from: string; to: string };
  permissions: { canCompany: boolean; canSelectSeller: boolean; canViewSellerComparisons: boolean };
  cards: {
    netRealized: number;
    growthPercent: number | null;
    currentPipelineValue: number;
    currentPipelineCount: number;
    lostCount: number;
  };
  finance: {
    receivedAmount: number;
    receivableAmount: number;
    overdueAmount: number;
    coverage: { coveredContracts: number; totalContracts: number };
  };
  delivery: {
    promisedDeliveries: number;
    dueSoonDeliveries: number;
    overdueDeliveries: number;
    deliveredUnconfirmed: number;
    finalizedLoadings: number;
    exitedLoadings: number;
    coverage: { coveredContracts: number; totalContracts: number };
  };
  trend: Array<{ key: string; label: string; net: number; pipeline: number; adjustments: number }>;
  contracts: BiContractEvidence[];
  sellers: Array<{
    id: string; name: string; netRealized: number; pipelineValue: number; lostCount: number;
    overdueFollowUpCount: number; stalledPipelineCount: number;
    deteriorationPercent: number | null; lossRate: number | null;
  }>;
  customers: Array<{ id: string; name: string; value: number; contracts: number }>;
  products: Array<{ id: string; name: string; code: string; value: number; contracts: number }>;
  legacyUnassigned: { count: number; value: number };
  sourceHealth: BiSourceHealth[];
  sourceRecordAccess: { sales: boolean; crm: boolean; accounting: boolean; logistics: boolean; security: boolean };
  recommendations?: BiRecommendation[];
  riskEvidence: {
    overdueReceivables: { count: number; value: number };
    overdueDeliveries: { count: number };
    overdueFollowUps: { count: number };
    dueSoonDeliveries: { count: number };
    stalledPipeline: { count: number; value: number };
    promisedWithoutLoading: { count: number };
    finalizedWithoutExit: { count: number };
    crmWonWithoutContract: { count: number };
  };
};
