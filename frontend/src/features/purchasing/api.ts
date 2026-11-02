import api from '@/lib/api';
export type PurchaseDocument = {
  id: string; number: string; displayTitle?:string; kind: string; version: number; status: string;
  ownerId: string; creatorId: string; contractId: string | null; customerId: string | null; parentId: string | null;
  data: Record<string, any>; progress: Record<string, string | null | boolean>; toReturn?: string;
  source?: { number: string; customer: string; revision: number } | null;
  order?: { id: string; number: string; displayTitle?:string; supplier: string }; createdAt: string;
  quoteCommitments?:Array<{inquiryId:string;offerId:string;quantity:string}>;
  quoteAvailability?:Array<{inquiryId:string;offerId:string;quantity:string}>;
};
export type PurchaseAccess = { actorId: string; manager: boolean; buyer: boolean; receiver: boolean; accountant: boolean; requester: boolean; prices: boolean; all: boolean };
export type PurchaseWorkspace = { access: PurchaseAccess; requests: PurchaseDocument[]; inquiries: PurchaseDocument[]; orders: PurchaseDocument[]; receipts: PurchaseDocument[]; exchanges: PurchaseDocument[]; finance: PurchaseDocument[]; changes: PurchaseDocument[]; total: number; limit: number };
export type ContractOption = { id: string; number: string; displayTitle?:string; customerId: string; customer: string; financial: boolean; partner: boolean; version: number; sourceError?: string; items: { id: string;productId?:string;productCode?:string; rowId?: string; requested?: string; ordered?: string; remaining?: string; stone: string; quantity: string; unit: string }[] };
export type CatalogProduct={id:string;code:string;name:string;unit:string;facts:string;validCount?:number;latest?:{inquiryId:string;supplierName:string;price:string|null;unit:string;recordedAt:string;validUntil:string|null;valid:boolean;scope:string;specification:string|null}|null};
export type Option = { id: string; name: string; contact?: string; contacts?: { id: string; name: string; role: string; phone: string | null }[]; type?: string; label?: string };
export type CommandResult = { id: string; number: string; displayTitle?:string; version: number; kind: string; message: string; messageType?:'warning'; supplier?: Option };
export type PurchaseAttachment={id:string;originalName:string;mimeType:string;size:number;visibility:string};
export type AttachmentInput={documentId:string;expectedVersion:number;visibility:string;file:File};
export const purchasingAPI = {
  catalog:(q='',cursor='',family='')=>api.get<{success:boolean;data:{items:CatalogProduct[];nextCursor:string|null;types:{id:"longitudinal"|"stair"|"slab"|"prepared";label:string;count:number}[]}}>('/purchasing/catalog',{params:{q,cursor,family}}),
  access: () => api.get<{success:boolean;data:{access:PurchaseAccess;sections:string[]}}>('/purchasing/access'),
  compatibleInquiries: (id: string) => api.get<{success:boolean;data:PurchaseDocument[]}>(`/purchasing/inquiries/${id}/compatible`),
  contractEntry: (contractId: string, rowId: string) => api.get('/purchasing/contract-entry', {params: {contractId, rowId}}),
  workspace: (q = '') => api.get<{ success: boolean; data: PurchaseWorkspace }>('/purchasing/workspace', { params: { q } }),
  lookup: <T = Option>(kind: string, q = '', sourceId = '') => api.get<{ success: boolean; data: T[] }>('/purchasing/lookups', { params: { kind, q, sourceId } }),
  command: (key: string, type: string, input: unknown) => api.post<{ success: boolean; data: CommandResult }>('/purchasing/commands', { type, input }, { headers: { 'Idempotency-Key': key }, timeout: 20000 }),
  attachment:(key:string,input:AttachmentInput)=>{const form=new FormData();form.append('file',input.file);form.append('expectedVersion',String(input.expectedVersion));form.append('visibility',input.visibility);return api.post<{success:boolean;data:CommandResult}>(`/purchasing/documents/${input.documentId}/attachments`,form,{headers:{'Content-Type':'multipart/form-data','Idempotency-Key':key},timeout:45000});},
  attachmentDownload:(id:string)=>api.get(`/purchasing/attachments/${id}`,{responseType:'blob'}),
  outcome: (key: string) => api.get<{ success: boolean; data: { state: 'APPLIED' | 'NOT_FOUND'; result?: CommandResult } }>(`/purchasing/commands/${key}`),
  detail: (id: string) => api.get(`/purchasing/documents/${id}`),
  pdf: (id: string) => api.get(`/purchasing/documents/${id}/pdf`, { responseType: 'blob' }),
};
export function purchaseError(error: unknown): string {
  const e = error as { response?: { data?: { message?: string; error?: string } } };
  const message = e.response?.data?.message || e.response?.data?.error;
  return message && /[\u0600-\u06ff]/.test(message) ? message : 'ارتباط با سرویس خرید برقرار نشد. نوشته‌هایتان حفظ شده است؛ نتیجه ثبت قبلی را بررسی کنید.';
}
