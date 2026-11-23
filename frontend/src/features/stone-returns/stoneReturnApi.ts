import api from '@/lib/api';

export const stoneReturnUnitLabels: Record<string, string> = {
  squareMeter: 'مترمربع', meter: 'متر طول', count: 'عدد', ton: 'تن',
};

export type StoneReturnReceipt = {
  id: string;
  customerId: string;
  customerName: string;
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  receivedQuantity: string;
  acceptedQuantity: string;
  rejectedQuantity: string;
  rejectionReason: string | null;
  guardReturnMovementId: string | null;
  inventoryIdentityId: string | null;
  createdAt: string;
};

export type StoneReturnOption = { id: string; label: string; description?: string | null };
type Envelope<T> = { success: true; data: T };
type ReceiptPage = { items: StoneReturnReceipt[]; nextCursor: string | null; canRecord?: boolean };
type StoneReturnIntake = {
  requestId: string; customerId: string; productId: string; unit: string;
  receivedQuantity: string; acceptedQuantity: string; rejectionReason: string;
  guardReturnMovementId: string | null;
};

const logistics = '/logistics/stone-returns';

export const stoneReturnApi = {
  list: async (workspace: 'logistics' | 'accounting', after?: string) =>
    (await api.get<Envelope<ReceiptPage>>(`/${workspace}/stone-returns`, { params: { after } })).data.data,
  customers: async (search: string) =>
    (await api.get<Envelope<StoneReturnOption[]>>(`${logistics}/customers`, { params: { search } })).data.data,
  products: async (search: string) =>
    (await api.get<Envelope<StoneReturnOption[]>>(`${logistics}/products`, { params: { search } })).data.data,
  guard: async (customerId: string, search: string): Promise<StoneReturnOption[]> => {
    const response = await api.get<Envelope<{ id: string; movementNumber: string; occurredAt: string }[]>>(
      `${logistics}/guard-movements`, { params: { customerId, search } },
    );
    return response.data.data.map(row => ({
      id: row.id, label: row.movementNumber, description: new Date(row.occurredAt).toLocaleDateString('fa-IR'),
    }));
  },
  record: async (command: StoneReturnIntake) =>
    (await api.post<Envelope<{ data: StoneReturnReceipt; replayed: boolean }>>(logistics, command)).data.data,
};

/** Keeps all persisted decimal digits when displaying exact quantity. */
export function displayStoneReturnQuantity(quantity: string, unit: string) {
  const [integer, fraction] = quantity.split('.');
  const tail = fraction ? '٫' + Array.from(fraction, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]).join('') : '';
  return `${BigInt(integer).toLocaleString('fa-IR')}${tail} ${stoneReturnUnitLabels[unit] ?? unit}`;
}
