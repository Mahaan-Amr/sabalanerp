import type { Prisma } from '@prisma/client';

type ContractScope = {
  departmentId: string | null;
  responsibleSellerId?: string | null;
  partnerKind?: string | null;
  partnerCaseId?: string | null;
};
type ActorScope = { id?: string; role: string; departmentId?: string | null };

// Responsibility extends resource scope only. Callers still enforce workspace,
// feature, lifecycle, financial-correction and edit-lease authority.
export const isAssignedOrdinaryContract = (contract: ContractScope, user: ActorScope) =>
  !!user.id && contract.responsibleSellerId === user.id && !contract.partnerKind && !contract.partnerCaseId;

export const validateContractAccess = (contract: ContractScope, user: ActorScope): boolean =>
  user.role === 'ADMIN' || !user.departmentId || contract.departmentId === user.departmentId
  || isAssignedOrdinaryContract(contract, user);

export const assignedOrdinaryContractWhere = (userId: string): Prisma.SalesContractWhereInput => ({
  responsibleSellerId: userId, partnerKind: null, partnerCaseId: null,
});

export const salesContractAccessWhere = (user: ActorScope): Prisma.SalesContractWhereInput =>
  user.role === 'ADMIN' || !user.departmentId ? {} : {
    OR: [{ departmentId: user.departmentId }, ...(user.id ? [assignedOrdinaryContractWhere(user.id)] : [])],
  };
