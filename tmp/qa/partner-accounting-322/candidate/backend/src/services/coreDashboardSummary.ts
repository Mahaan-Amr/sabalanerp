type DashboardContractRow = {
  id: string;
  status: string;
  customerId: string;
  createdAt: Date | string;
};

const CONTRACT_STATUSES = [
  'PENDING_APPROVAL',
  'SIGNED',
  'DRAFT',
  'APPROVED',
  'PRINTED',
  'CANCELLED',
  'EXPIRED',
] as const;

export const summarizeCoreDashboard = ({
  contracts,
  totalCustomers,
  realizedSales,
}: {
  contracts: DashboardContractRow[];
  totalCustomers: number;
  realizedSales: {
    total: number;
    average: number | null;
    successRate: number | null;
    realizedContracts: number;
  };
}) => {
  const counts = Object.fromEntries(CONTRACT_STATUSES.map((status) => [
    status,
    contracts.filter((contract) => contract.status === status).length,
  ])) as Record<(typeof CONTRACT_STATUSES)[number], number>;
  return {
    contracts: {
      total: contracts.length,
      pending: counts.PENDING_APPROVAL,
      signed: counts.SIGNED,
      draft: counts.DRAFT,
      approved: counts.APPROVED,
      printed: counts.PRINTED,
      cancelled: counts.CANCELLED,
      expired: counts.EXPIRED,
    },
    customers: { total: totalCustomers },
    realizedSales,
  };
};
