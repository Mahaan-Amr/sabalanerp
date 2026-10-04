import api from '@/lib/api';
export type SellerCreditBalance = { sellerId: string; limitRials: string; usedRials: string; availableRials: string; balanceRials: string; contractReservedRials?: string };
export type DispatchAuthority = { id: string; kind: 'MANAGER' | 'CREDIT' | 'DATE' | 'TRANSFER' | 'CUSTOMER_DATE'; status: string;
  revision: number; amountRials: string; promisedDate: string; requestedBy: string; sellerId?: string; sellerName?: string; reason?: string; targetSellerId?: string };
export type DispatchCreditView = { authorities: DispatchAuthority[]; access: { read: boolean; request: boolean; manage: boolean; seller: boolean };
  customerCredit: { amountRials: string; consumedRials: string; promisedDate: string; active: boolean } | null;
  canManageCustomerDate: boolean;
  eligible: boolean; balance: SellerCreditBalance; activeManagerId: string | null; actorId: string; canRequestManager: boolean;
  responsibleSeller: { id: string; displayName: string } };
const data = <T>(response: { data: { success: boolean; data: T; error?: string } }) => {
  if (!response.data.success) throw new Error(response.data.error || 'عملیات ثبت نشد.');
  return response.data.data;
};
export const dispatchCreditApi = {
  balance: async (contractId?: string, potentialProjectId?: string) => data<SellerCreditBalance>(await api.get('/dispatch-credit/balance', { params: { contractId, potentialProjectId } })),
  sellers: async () => data<Array<SellerCreditBalance & { id: string; firstName: string; lastName: string; username: string }>>(await api.get('/dispatch-credit/sellers')),
  limit: async (id: string, limitRials: string) => data<SellerCreditBalance>(await api.put(`/dispatch-credit/sellers/${id}`, { limitRials })),
  contract: async (id: string) => data<DispatchCreditView>(await api.get(`/dispatch-credit/contracts/${id}`)),
  request: async (id: string, input: { kind: 'MANAGER' | 'DATE' | 'TRANSFER' | 'CUSTOMER_DATE'; promisedDate: string; reason?: string; targetAuthorityId?: string; targetSellerId?: string }) =>
    data(await api.post(`/dispatch-credit/contracts/${id}/requests`, input)),
  act: async (id: string, action: string, reason?: string) => data(await api.post(`/dispatch-credit/authorities/${id}/actions`, { action, reason })),
};
