'use client';
import {purchaseDimensions,purchaseNumber as groupedNumber,purchaseText,purchaseTitle,purchaseDigits} from './presentation';
import { PurchaseSupplierPicker } from './PurchaseSupplierPicker';
import { ReceiptInventorySummary } from './ReceiptInventorySummary';
import { OrderCosts } from './OrderCosts';
import { PurchaseAttachments } from './PurchaseAttachments';
import { AccountingReview } from './AccountingReview';
import { inquiryOrderDefaults } from './inquiryOrderDefaults';
import { InquiryComparison } from './InquiryComparison';
import {ensureInquiryHistory,hasInquiryParent,inquiryHref} from './inquiryNavigation';
import { PurchaseDashboard } from './PurchaseDashboard';
import {purchaseMetrics} from './purchaseMetrics';
import { PurchaseStart,type PurchaseInquirySeed } from './PurchaseStart';
import { InquiryCaseView } from './InquiryCaseView';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter,useSearchParams } from 'next/navigation';
import { FaPlus, FaEye, FaSync, FaClipboardList, FaTruck, FaBoxOpen } from 'react-icons/fa';
import { ErpPresentationProvider, ErpListPage, ErpButton, ErpCard, ErpBadge, ErpField, ErpInput, ErpTextarea, ErpSearchableSelect, ErpSheet, ErpInlineState, ErpLoading, ErpEmptyState, ErpFieldView, ErpDisclosure, ErpCheckbox, ErpPersianDateField, type ErpAction, type ErpColumn } from '@/components/erp';
import { purchasingAPI, purchaseError, type PurchaseDocument as Doc, type PurchaseWorkspace, type ContractOption, type Option, type CommandResult } from './api';
const tabs = { inquiries: 'استعلام‌های ثبت‌شده', requests: 'درخواست‌ها', orders: 'سفارش‌های خرید', receipts: 'دریافت بار', exchanges: 'تعویض‌ها', suppliers: 'تأمین‌کنندگان', inventory: 'بارهای پذیرفته‌شده', finance: 'پیگیری حسابداری', changes: 'تغییر و لغو' };
export type PurchasingTab = keyof typeof tabs;
const descriptions: Record<PurchasingTab, string> = {
  inquiries: 'قیمت‌ها را مقایسه کنید؛ برای نیاز واقعی، پیشنهاد منتخب را به سفارش ادامه دهید.',
  requests: 'نیازهای ثبت‌شده را پیگیری کنید؛ سفارش خرید از روی هر درخواست ثبت می‌شود.',
  orders: 'سفارش‌های قطعی تأمین‌کنندگان و مقدار باقی‌مانده برای دریافت را پیگیری کنید.',
  receipts: 'مقدار بار رسیده و نتیجه بررسی کیفیت را ثبت کنید؛ رسیدن بار با پذیرش کیفیت متفاوت است.',
  exchanges: 'برگشت بار قبلی و دریافت و پذیرش بار جایگزین را جدا پیگیری کنید.',
  suppliers: 'اطلاعات تماس و مشخصات تأمین‌کنندگان خرید.',
  inventory: 'مقدار پذیرفته‌شده در دریافت‌های خرید؛ این فهرست جایگزین موجودی و رزرو انبار نیست.',
  finance: 'درخواست‌های مالی خرید و اتصال به اسناد حسابداری؛ ثبت درخواست به معنی پرداخت نیست.',
  changes: 'درخواست‌های تغییر یا لغو و نتیجه واقعی توافق با تأمین‌کننده.',
};
const fa = groupedNumber;
const quantity = (v: unknown, unit = '') => v == null ? 'هنوز مشخص نشده' : `${fa(v)} ${unit}`;
const positive = (v: unknown) => /^\d*\.?\d+$/.test(String(v)) && !/^0*(\.0*)?$/.test(String(v));
const units = ['مترمربع', 'متر طول', 'عدد', 'تن', 'کیلوگرم'];
type Draft = Record<string, string | boolean>;
type PendingCommand = { key: string; type: string; input: Record<string, unknown> };
type Feedback = { kind: 'success' | 'error' | 'stale'; title: string; result?: CommandResult };
export default function PurchasingWorkspace({ tab = 'requests', dashboard = false }: { tab?: PurchasingTab; dashboard?: boolean }) {
  const router = useRouter();
  const params=useSearchParams();
  const documentId=params.get('document')||'';
  const attentionView=params.get('view')==='attention'&&['requests','orders','receipts'].includes(tab);
  const [extraAllocations, setExtraAllocations] = useState<{ requestId: string; quantity: string; purchaseQuantity: string }[]>([]), [costs, setCosts] = useState<{ title: string; recipientId: string; amount: string }[]>([]);
  const [workspace, setWorkspace] = useState<PurchaseWorkspace | null>(null), [loading, setLoading] = useState(true), [feedback, setFeedback] = useState<Feedback | null>(null);
  const [search, setSearch] = useState(''), [filter, setFilter] = useState(attentionView?'attention':'all'), [sheet, setSheet] = useState(''), [draft, setDraft] = useState<Draft>({}), [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(()=>{setFilter(current=>attentionView?'attention':current==='attention'?'all':current);},[attentionView,tab]);
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState<PendingCommand | null>(null), inFlight = useRef(false);
  const [selected, setSelected] = useState<Doc | null>(null), [detail, setDetail] = useState<any>(null), [suppliers, setSuppliers] = useState<Option[]>([]), [buyers, setBuyers] = useState<Option[]>([]), [contracts, setContracts] = useState<ContractOption[]>([]), [customers, setCustomers] = useState<Option[]>([]), [parties, setParties] = useState<Option[]>([]), [existing, setExisting] = useState<Option[]>([]), [contractSearch, setContractSearch] = useState('');
  const supplierReturn = useRef<{ draft: Draft; selected: Doc | null; allocations: typeof extraAllocations; costs: typeof costs } | null>(null);
  const [attachmentLocked,setAttachmentLocked]=useState(false);
  const [startingContract,setStartingContract]=useState<ContractOption|null>(null);
  const [inquirySeed,setInquirySeed]=useState<PurchaseInquirySeed|null>(null);
  const access = workspace?.access;
  const readActorId=access?.actorId;
  const load = useCallback(async () => { try { const response = await purchasingAPI.workspace(search); setWorkspace(response.data.data); } catch (error) { setFeedback({ kind: 'error', title: purchaseError(error) }); } finally { setLoading(false); } }, [search]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 220); return () => clearTimeout(t); }, [load]);
  useEffect(() => { if (!access) return; let active = true; Promise.all([purchasingAPI.lookup('buyers'), access.all ? purchasingAPI.lookup('suppliers', tab === 'suppliers' ? search : '') : Promise.resolve(null)]).then(([b, s]) => { if (active) { setBuyers(b.data.data); setSuppliers(s?.data.data || []); } }).catch(e => { if (active) setFeedback({ kind: 'error', title: purchaseError(e) }); }); return () => { active = false; }; }, [access, tab, search]);
  useEffect(() => { if (!sheet || !['REQUEST', 'ORDER','HISTORICAL_PURCHASE'].includes(sheet)) return; let active = true; const t = setTimeout(() => { void purchasingAPI.lookup<ContractOption>('contracts', contractSearch).then(r => { if (active) setContracts(r.data.data); }).catch(e => { if (active) setErrors(v => ({ ...v, general: purchaseError(e) })); }); }, 200); return () => { active = false; clearTimeout(t); }; }, [sheet, contractSearch]);
  const set = (key: string, value: string | boolean) => { setDraft(d => ({ ...d, [key]: value })); setErrors(e => ({ ...e, [key]: '' })); };
  const get = (key: string) => String(draft[key] ?? '');
  const allDocs = workspace ? [...(workspace.inquiries || []), ...workspace.requests, ...workspace.orders, ...workspace.receipts, ...workspace.exchanges, ...workspace.finance, ...workspace.changes] : [];
  const find = (id: string) => allDocs.find(d => d.id === id);
  useEffect(()=>{
    if(!readActorId)return;
    if(!documentId){setSelected(null);setDetail(null);setSheet(current=>['INQUIRY_CASE','INQUIRY_DETAIL','OPENING_INQUIRY'].includes(current)?'':current);return;}
    let active=true;setSheet('OPENING_INQUIRY');
    void purchasingAPI.detail(documentId).then(r=>{
      if(!active)return;
      const doc=r.data.data.document;
      if(doc.kind==='INQUIRY_CASE'||doc.kind==='INQUIRY')ensureInquiryHistory(doc.id,doc.kind==='INQUIRY'?doc.parentId:null);
      setSelected({...doc,progress:{}});setDetail(r.data.data);
      setSheet(r.data.data.document.kind==='INQUIRY_CASE'?'INQUIRY_CASE':r.data.data.document.kind==='INQUIRY'?'INQUIRY_DETAIL':'DETAIL');
    }).catch(e=>{if(active){setSheet('');setFeedback({kind:'error',title:purchaseError(e)});}});
    return()=>{active=false;};
  },[readActorId,documentId]);
  const selectedRequest = find(get('requestId')), selectedOrder = find(get('orderId')), selectedContract = contracts.find(c => c.id === draft.contractId), destinationCustomer = customers.find(c => c.id === draft.customerId);
  function navigateInquiry(id:string) {
    const href=inquiryHref(id);
    if(window.location.pathname==='/dashboard/purchasing/inquiries')window.history.pushState({},'',href);
    else router.push(href);
  }
  async function repeatInquiry(doc:Doc) {
    setSheet('OPENING_INQUIRY');
    try {
      const response=await purchasingAPI.detail(doc.id),data=response.data.data;
      const lines:Doc[]=doc.kind==='INQUIRY_CASE'?data.lines:[data.document];
      const usable=lines.length>0&&lines.every(line=>line.data.productId&&!line.data.raw);
      setStartingContract(null);setInquirySeed({sourceTitle:purchaseTitle(doc),items:usable?lines.map(line=>({productId:line.data.productId,productCode:line.data.productCode,stone:line.data.stone,unit:line.data.unit,quantity:'',dimensions:line.data.technical?.dimensions||'',quoteScope:line.data.technical?.dimensions?'specific':'general'})):[],query:usable?'':lines[0]?.data.stone||''});setSheet('START');
    }catch(error){setSheet('');setFeedback({kind:'error',title:purchaseError(error)});}
  }
  function changeStatusFilter(value:string) {
    setFilter(value);const query=new URLSearchParams(params.toString());
    if(value==='attention')query.set('view','attention');else query.delete('view');
    router.replace(`/dashboard/purchasing/${tab}${query.size?`?${query}`:''}`,{scroll:false});
  }
  function backInquiry(parentId?:string|null) { if(hasInquiryParent(parentId))router.back();else router.replace(inquiryHref(parentId)); }
  function changeTab(value: string) { router.push(`/dashboard/purchasing/${value}`); }
  function open(type: string, doc?: Doc) {
    if (uncertain) { setSheet(uncertain.type); return; }
    setSelected(doc || null); setExtraAllocations([]); setCosts(type==='PRICE'?(doc?.data.costs||[]):[]); setErrors({}); setDetail(null); setSheet(type);
    const base: Draft = { notes: '', date: '', quantity: '', expectedVersion: doc ? String(doc.version) : '' };
    if (type === 'REQUEST') setDraft({ ...base, reason: doc?.data.reason || 'contract', contractId: doc?.contractId || '', itemId: doc?.data.itemId || '', stone: doc?.data.stone || '', unit: doc?.data.unit || 'مترمربع', quantity: doc?.data.quantity || '', ownerId: doc?.ownerId || (access?.buyer ? access.actorId : buyers[0]?.id || ''), documentId: doc?.id || '', dimensions: doc?.data.dimensions || '', raw: doc?.data.raw === true });
    else if (type === 'ORDER') { const request = doc || workspace?.requests.find(d => d.status === 'OPEN' && d.progress.toOrder !== '0'); setDraft({ ...base, requestId: request?.id || '', stone: request?.data.stone || '', unit: request?.data.unit || 'مترمربع', demandQuantity: String(request?.progress.toOrder || ''), purchaseShareQuantity: String(request?.progress.toOrder || ''), quantity: String(request?.progress.toOrder || ''), supplierId: '', price: '', route: 'warehouse', conversionConfirmed: false, historical: false, occurredAt: '', ...(() => {const q=inquiryOrderDefaults(request,workspace?.orders || []);return q ? {...q,demandQuantity:q.demandQuantity,purchaseShareQuantity:q.quantity} : {};})() }); }
    else if (type === 'RECEIPT') { const order = doc?.kind === 'EXCHANGE' ? find(doc.data.orderId) : doc || workspace?.orders.find(d => positive(d.progress.remaining)); setDraft({ ...base, orderId: order?.id || '', exchangeId: doc?.kind === 'EXCHANGE' ? doc.id : '', quantity: String(doc?.kind === 'EXCHANGE' ? doc.progress.remaining : order?.progress.remaining || ''), quality: 'pending', accepted: '', customerId: '', recipientId: '' }); if (order?.data.route === 'direct') void loadContacts(order.id); }
    else if (['ACCEPT', 'REJECT', 'RETURN', 'RETURN_ACCEPTED', 'EXCHANGE'].includes(type)) setDraft({ ...base,qualityOutcome:type, receiptId: doc?.id || '', quantity: String(type === 'ACCEPT' || type === 'REJECT' ? doc?.progress.pending : type === 'RETURN' ? doc?.progress.toReturn : type === 'EXCHANGE' ? doc?.progress.toExchange : doc?.progress.acceptedReturnable || ''), reason: '', physicalConfirmed: false });
    else if (type === 'SUPPLIER') { setDraft({ name: '', contact: '', partyId: '' }); void purchasingAPI.lookup('parties').then(r => setParties(r.data.data)).catch(e => setErrors({ general: purchaseError(e) })); }
    else if(type==='ACCOUNTING_SUPPLIER_LINK'){setDraft({supplierId:doc?.id||'',accountingPartyId:''});void purchasingAPI.lookup('parties').then(r=>setParties(r.data.data.filter(p=>p.id.startsWith('party:')).map(p=>({...p,id:p.id.slice(6)})))).catch(e=>setErrors({general:purchaseError(e)}));}
    else if(type==='ACCOUNTING_HANDOFF')setDraft({...base,...(doc?.kind==='ORDER'?{orderId:doc.id}:{receiptId:doc?.id||''}),quantity:String(doc?.progress.accepted||''),price:'',invoiceNumber:''});
    else if(type==='ACCOUNTING_RECOGNIZE')setDraft({...base,...(doc?.data.invoiceDraft||{}),documentId:doc?.id||'',price:doc?.data.price||doc?.data.orderPrice||'',invoiceNumber:doc?.data.invoiceNumber||''});
    else if(type==='HISTORICAL_PURCHASE')setDraft({...base,stone:'',unit:'مترمربع',supplierId:'',price:'',occurredAt:'',route:'warehouse',contractId:'',itemId:''});
    else if(type==='STOCK_SURPLUS')setDraft({...base,documentId:doc?.id||'',quantity:String(doc?.progress.stockSurplus||'')});
    else if (type === 'DETAIL') { setDraft(base); if (doc) void purchasingAPI.detail(doc.id).then(r => setDetail(r.data.data)).catch(e => setErrors({ general: purchaseError(e) })); }
    else { setDraft({ ...base, documentId: doc?.id || '', price: doc?.data.price || '', ownerId: doc?.ownerId || '', requestedAction: 'EDIT', sourceType: 'SUPPLIER_INVOICE' }); if (type === 'LINK_EXISTING' && !access?.accountant) { setDraft(d => ({ ...d, sourceType: 'INVENTORY_EVENT' })); setExisting([]); }
      if (type === 'LINK_EXISTING' && doc && access?.accountant) void purchasingAPI.lookup('existing', '', doc.id).then(r => setExisting(r.data.data)).catch(e => setErrors({ general: purchaseError(e) })); }
  }
  async function loadContacts(orderId: string) { try { const r = await purchasingAPI.lookup('contacts', '', orderId); setCustomers(r.data.data); if (r.data.data.length === 1) setDraft(d => ({ ...d, customerId: r.data.data[0].id, recipientId: '' })); } catch (e) { setErrors({ general: purchaseError(e) }); } }
  function chooseRequest(id: string) { const r = find(id); setDraft(d => ({ ...d, requestId: id, stone: r?.data.stone || '', unit: r?.data.unit || 'مترمربع', quantity: String(r?.progress.toOrder || ''), demandQuantity: String(r?.progress.toOrder || ''), purchaseShareQuantity: String(r?.progress.toOrder || '') })); const q=inquiryOrderDefaults(r,workspace?.orders || []);if(q)setDraft(d=>({...d,...q,demandQuantity:q.demandQuantity,purchaseShareQuantity:q.quantity}));setErrors({}); }
  function chooseOrder(id: string) { const o = find(id); setDraft(d => ({ ...d, orderId: id, exchangeId: '', quantity: String(o?.progress.remaining || ''), quality: 'pending', accepted: '', customerId: '', recipientId: '' })); setCustomers([]); setErrors({}); if (o?.data.route === 'direct') void loadContacts(id); }
  async function openInquiryOrder(id:string) {
    try {
      const response=await purchasingAPI.workspace('');
      const request=response.data.data.requests.find(r=>r.id===id);
      if(!request)throw new Error('درخواست خرید در فهرست جاری پیدا نشد؛ از بخش درخواست‌ها آن را جست‌وجو کنید.');
      setSearch('');setWorkspace(response.data.data);open('ORDER',request);
    }catch(error){setFeedback({kind:'error',title:purchaseError(error)});}
  }
  function nextAction():ErpAction|undefined {
    const doc=feedback?.result&&find(feedback.result.id);
    if(!doc||!access)return;
    if(doc.kind==='REQUEST'&&access.buyer&&positive(doc.progress.toOrder))return {label:'ادامه: سفارش خرید',onClick:()=>open('ORDER',doc)};
    if(doc.kind==='ORDER'&&(access.buyer||access.receiver)&&positive(doc.progress.remaining))return {label:'ادامه: دریافت بار',onClick:()=>open('RECEIPT',doc)};
    if(doc.kind==='RECEIPT') {
      if(positive(doc.progress.pending)&&(access.manager||doc.data.route==='direct'&&access.buyer||doc.data.route==='warehouse'&&access.receiver))return {label:'ادامه: بررسی کیفیت',onClick:()=>open('ACCEPT',doc)};
      if(access.buyer&&positive(doc.progress.toReturn))return {label:'ادامه: برگشت بار',onClick:()=>open('RETURN',doc)};
      if(access.buyer&&positive(doc.progress.toExchange))return {label:'ادامه: تعویض بار',onClick:()=>open('EXCHANGE',doc)};
      const exchange=doc.data.exchangeId&&find(doc.data.exchangeId);
      if(exchange&&(access.buyer||access.receiver)&&positive(exchange.progress.remaining))return {label:'ادامه: دریافت باقی جایگزین',onClick:()=>open('RECEIPT',exchange)};
      const order=doc.parentId&&find(doc.parentId);
      if(order&&(access.buyer||access.receiver)&&positive(order.progress.remaining))return {label:'ادامه: دریافت باقی سفارش',onClick:()=>open('RECEIPT',order)};
    }
    if(doc.kind==='EXCHANGE'&&(access.buyer||access.receiver)&&positive(doc.progress.remaining))return {label:'ادامه: دریافت جایگزین',onClick:()=>open('RECEIPT',doc)};
  }
  function chooseContract(id: string) { const c = contracts.find(c => c.id === id), item = c?.items[0]; setDraft(d => ({ ...d, contractId: id, itemId: item?.id || '', stone: item?.stone || '', quantity: item?.quantity || '', unit: item?.unit || 'مترمربع' })); setErrors({}); }
  async function applied(result: CommandResult, type: string) { setUncertain(null); setSheet(''); setFeedback({ kind: result.messageType==='warning'?'stale':'success', title: result.message || 'اطلاعات ثبت شد.', result }); await load(); if (type === 'SUPPLIER') { const r = await purchasingAPI.lookup('suppliers'); setSuppliers(r.data.data); if (supplierReturn.current && result.supplier) { const saved = supplierReturn.current; supplierReturn.current = null; setDraft({ ...saved.draft, supplierId: result.supplier.id }); setSelected(saved.selected); setExtraAllocations(saved.allocations); setCosts(saved.costs); setSheet('ORDER'); } } }
  async function commit(command: PendingCommand) {
    if (inFlight.current) return; inFlight.current = true; setBusy(true); setErrors({});
    try { const r = await purchasingAPI.command(command.key, command.type, command.input); await applied(r.data.data, command.type); }
    catch (error: any) { const status = error.response?.status; if (!status || status >= 500) { setUncertain(command); setErrors({ general: purchaseError(error) }); } else { setUncertain(null); setErrors({ ...(error.response?.data?.fields || {}), general: purchaseError(error) }); } }
    finally { inFlight.current = false; setBusy(false); }
  }
  function closeSheet() { if (sheet === 'SUPPLIER' && supplierReturn.current) { const saved = supplierReturn.current; supplierReturn.current = null; setDraft(saved.draft); setSelected(saved.selected); setExtraAllocations(saved.allocations); setCosts(saved.costs); setErrors({}); setSheet('ORDER'); } else setSheet(''); }
  function save() {
    if (uncertain) { void commit(uncertain); return; }
    const input: Record<string, unknown> = { ...draft };
    if (input.expectedVersion) input.expectedVersion = Number(input.expectedVersion); else delete input.expectedVersion;
    if (sheet === 'SUPPLIER') { const party = get('partyId'); if (party.startsWith('customer:')) input.customerId = party.slice(9); if (party.startsWith('party:')) input.accountingPartyId = party.slice(6); }
    if(sheet==='PRICE')input.costs=costs;
    if (sheet === 'ORDER') { input.allocations = [{ requestId: input.requestId, quantity: input.demandQuantity || input.quantity, purchaseQuantity: extraAllocations.length ? input.purchaseShareQuantity : input.quantity, conversionConfirmed: input.conversionConfirmed }, ...extraAllocations.map(a => ({ ...a, conversionConfirmed: input.conversionConfirmed }))]; input.costs = costs; }
    void commit({ key: crypto.randomUUID(), type: sheet, input });
  }
  async function checkOutcome() { if (!uncertain || busy) return; setBusy(true); try { const r = await purchasingAPI.outcome(uncertain.key); if (r.data.data.state === 'APPLIED' && r.data.data.result) await applied(r.data.data.result, uncertain.type); else setErrors({ general: 'هنوز نتیجه‌ای ثبت نشده است. فقط همین درخواست را با همان شناسه دوباره بفرستید؛ سفارش تازه نسازید.' }); } catch (e) { setErrors({ general: purchaseError(e) }); } finally { setBusy(false); } }
  async function print(doc: Doc) { try { const r = await purchasingAPI.pdf(doc.id), url = URL.createObjectURL(r.data); const a = document.createElement('a'); a.href = url; a.download = `${doc.number}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); } catch (e) { setFeedback({ kind: 'error', title: purchaseError(e) }); } }
  const field = (key: string, label: string, options: { required?: boolean; hint?: string; readOnly?: boolean; decimal?: boolean } = {}) => <ErpField label={label} required={options.required} error={errors[key]} hint={options.hint}><ErpInput numberFormat={options.decimal?'money':undefined} value={get(key)} onChange={e => set(key, e.target.value)} readOnly={options.readOnly} inputMode={options.decimal ? 'decimal' : undefined} /></ErpField>;
  const select = (key: string, label: string, options: { id: string; name: string }[], onChange?: (id: string) => void, required = true) => <ErpField label={label} required={required} error={errors[key]}><ErpSearchableSelect value={get(key)} onChange={e => onChange ? onChange(e.target.value) : set(key, e.target.value)} aria-label={label}><option value="">انتخاب کنید</option>{options.map(o => <option key={o.id} value={o.id}>{purchaseText(o.name)}</option>)}</ErpSearchableSelect></ErpField>;
  const unitField = <><ErpField label="واحد مقدار" required error={errors.unit}><ErpSearchableSelect value={units.includes(get('unit')) ? get('unit') : 'other'} onChange={e => set('unit', e.target.value === 'other' ? '' : e.target.value)} aria-label="واحد مقدار">{units.map(u => <option key={u} value={u}>{u}</option>)}<option value="other">سایر</option></ErpSearchableSelect></ErpField>{!units.includes(get('unit')) && field('unit', 'نام واحد دلخواه', { required: true })}</>;
  const dateField = (key: string, label: string) => <div><ErpPersianDateField label={label} value={get(key)} valueFormat="iso-date" onChange={value => set(key, value)} />{errors[key] && <p className="text-sm text-[var(--sds-danger)]">{errors[key]}</p>}</div>;
  const notes = <ErpDisclosure title="توضیحات تکمیلی (اختیاری)"><ErpField label="توضیحات"><ErpTextarea value={get('notes')} onChange={e => set('notes', e.target.value)} /></ErpField></ErpDisclosure>;
  if (loading) return <ErpLoading />;
  if (!workspace || !access) return <ErpEmptyState title="فضای خرید قابل دریافت نیست" description={feedback?.title || 'دسترسی و ارتباط را بررسی کنید.'} action={{ label: 'تلاش دوباره', onClick: load }} />;
  const receipts = workspace.receipts;
  const rows: Doc[] = tab === 'suppliers' ? suppliers.map(s => ({ id: s.id, number: s.name, kind: 'SUPPLIER', data: s, progress: {}, version: 1, status: 'OPEN', ownerId: '', creatorId: '', contractId: null, customerId: null, parentId: null, createdAt: '' })) : tab === 'inventory' ? receipts.filter(r => positive(r.progress.accepted) && r.data.route === 'warehouse') : workspace[tab];
  const visibleRows = rows.filter(d => filter === 'attention' ? tab === 'requests' ? d.status === 'OPEN' && d.progress.missing !== '0' : tab === 'orders' ? d.status === 'OPEN' && d.progress.remaining !== '0' : tab === 'receipts' && d.progress.pending !== '0' : filter === 'all' || (filter === 'closed' ? d.status !== 'OPEN' : d.status === 'OPEN'));
  const displayStatus = (d: Doc) => {
    if(d.kind==='REQUEST'&&d.status==='OPEN'&&d.progress.quoteChanged)return <ErpBadge tone="warning">پیشنهاد مانده سفارش نیاز به بازبینی دارد</ErpBadge>;
    if(d.status==='OPEN'&&['REQUEST','ORDER'].includes(d.kind)&&d.progress.financialBlocked)return <ErpBadge tone="warning">{d.kind==='ORDER'||positive(d.progress.ordered)?'رکورد مالی تغییر کرده؛ پیگیری تعهد قبلی':'منتظر رکورد مالی برای سفارش قطعی'}</ErpBadge>;
    if(d.kind==='ACCOUNTING_HANDOFF')return <ErpBadge tone={d.data.paymentStatus==='SETTLED'?'success':d.data.paymentStatus==='PRICE_MISMATCH'?'danger':'warning'}>{({NOT_POSTED:'منتظر تطبیق حسابداری',PRICE_MISMATCH:'اختلاف قیمت؛ پیگیری مسئول خرید',POSTED_UNSETTLED:'فاکتور ثبت شد؛ تسویه‌نشده',PARTIALLY_SETTLED:'بخشی تسویه شده',SETTLED:'تسویه کامل',COST_MISMATCH:'اختلاف هزینه؛ پیگیری مسئول خرید',CANCELLED:'ارسال به حسابداری لغو شد' } as Record<string,string>)[d.data.paymentStatus]||'پیگیری حسابداری'}</ErpBadge>;
    if (d.kind === 'ORDER' && d.data.exception) return <ErpBadge tone="danger">خرید انجام‌شده؛ مغایرت شرط مالی</ErpBadge>;
    if (d.kind === 'REQUEST' && d.progress.sourceChanged) return <ErpBadge tone="warning">قرارداد تغییر کرده؛ بررسی نیاز</ErpBadge>;
    if (d.status !== 'OPEN') return <ErpBadge>{({ CANCELLED: 'لغوشده', RESOLVED: 'تعیین تکلیف شده', VOID: 'باطل' } as Record<string, string>)[d.status] || d.status}</ErpBadge>;
    if (d.kind === 'INQUIRY') return <ErpBadge tone={d.data.selection?.length ? 'info' : 'warning'}>{d.data.selection?.length ? 'پیشنهاد منتخب دارد' : d.data.offers?.length ? 'آماده مقایسه پیشنهادها' : 'در انتظار پیشنهاد تأمین‌کننده'}</ErpBadge>;
    if (d.kind === 'INQUIRY_CASE') {
      const count=Number(d.progress.offerCount||0),validLines=Number(d.progress.validLines||0),total=d.data.lineIds?.length||0;
      return <ErpBadge tone={!count||validLines<total?'warning':'success'}>{!count?'در انتظار ثبت پیشنهاد':!validLines?'پیشنهاد معتبر ندارد':validLines<total?'پیشنهاد بعضی اقلام ثبت شده':'پیشنهادها ثبت شده'}</ErpBadge>;
    }
    if (d.kind === 'RECEIPT') return <ErpBadge tone={positive(d.progress.toReturn) ? 'danger' : positive(d.progress.pending) ? 'warning' : 'success'}>{positive(d.progress.toReturn) ? 'رد قطعی؛ برگشت باقی است' : positive(d.progress.pending) ? 'در انتظار بررسی کیفیت' : positive(d.progress.rejected) ? 'رد قطعی؛ برگشت ثبت شد' : 'کیفیت پذیرفته شد'}</ErpBadge>;
    if (d.kind === 'ORDER') return <ErpBadge tone={positive(d.progress.toReturn) ? 'danger' : positive(d.progress.remaining) || positive(d.progress.replacementRemaining) ? 'warning' : 'info'}>{positive(d.progress.toReturn) ? 'برگشت کالای نامناسب باز است' : positive(d.progress.replacementRemaining) ? 'در انتظار جایگزین' : positive(d.progress.remaining) ? 'در انتظار دریافت' : positive(d.progress.pending) ? 'دریافت شد؛ کیفیت در انتظار بررسی' : d.progress.accepted === d.data.quantity ? 'تأمین کامل' : positive(d.data.closedQuantity) ? 'باقی سفارش بسته شد؛ کسری نیاز جداست' : 'دریافت پایان یافت؛ کسری تأمین باز است'}</ErpBadge>;
    if (d.kind === 'REQUEST') return <ErpBadge tone={d.progress.missing === '0' ? 'success' : positive(d.progress.ordered) ? 'info' : 'warning'}>{d.progress.missing === '0' ? d.data.raw ? 'سنگ خام تأمین شد؛ فرآوری جداست' : 'تأمین کامل' : positive(d.progress.ordered) ? 'در حال تأمین' : 'در انتظار خرید'}</ErpBadge>;
    return <ErpBadge tone="info">{d.kind === 'EXCHANGE' ? positive(d.progress.remaining) ? 'در انتظار جایگزین' : 'جایگزین دریافت شد' : d.kind === 'ADVANCE' ? 'درخواست به حسابداری' : 'نیازمند پیگیری'}</ErpBadge>;
  };
  const columns: ErpColumn<Doc>[] = [
    { id: 'number', header: tab === 'suppliers' ? 'تأمین‌کننده' : 'سند / سنگ', priority: 'primary', cell: d => <div><strong>{tab==='inquiries'?purchaseTitle(d):d.number}</strong><p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{tab==='inquiries'?`${d.stoneSummary?`${purchaseText(d.stoneSummary)} · `:''}شماره پیگیری: ${d.number}`:purchaseText(d.data.stone || d.data.title || d.data.name)}</p></div> },
    { id: 'source', header: tab === 'receipts' ? 'سفارش / نوع بار' : 'مبدأ / تأمین‌کننده', cell: d => d.source ? <div>قرارداد {purchaseDigits(d.source.number)}<p>{purchaseText(d.source.customer)}</p></div> : purchaseText(d.data.supplierName) || d.order?.number || (d.data.reason === 'stock' ? 'نیاز انبار' : d.data.exchangeId ? 'بار جایگزین' : '—') },
    { id: 'quantity', header: tab === 'finance' ? 'مبلغ (تومان)' : 'مقدار', cell: d => d.kind === 'INQUIRY_CASE' ? `${fa(d.data.lineIds?.length || 0)} قلم` : tab === 'suppliers' ? d.data.contact || '—' : quantity(tab === 'finance' ? d.data.amount : d.data.quantity, tab==='finance'?'':d.data.unit) },
    ...(['requests', 'orders', 'receipts', 'inventory', 'exchanges'].includes(tab) ? [{ id: 'progress', header: 'پیشرفت تأمین', cell: (d: Doc) => <div className="space-y-1 text-sm">
      {tab === 'receipts' || tab === 'inventory' ? <><p>پذیرفته‌شده: {quantity(d.progress.accepted, d.data.unit)}</p><p>در انتظار بررسی: {quantity(d.progress.pending, d.data.unit)}</p></> : <><p>{tab === 'requests' ? 'سفارش‌شده' : 'دریافت‌شده'}: {quantity(tab === 'requests' ? d.progress.ordered : d.progress.received, d.data.unit)}</p><p>پذیرفته‌شده: {quantity(d.progress.accepted, d.data.unit)}</p></>}
    </div> }] : []),
    ...(tab === 'inquiries' ? [{ id: 'offers', header: 'پیشنهاد تأمین‌کنندگان', cell: (d: Doc) => d.kind === 'INQUIRY_CASE' ? `${fa(d.progress.offerCount||0)} پیشنهاد برای ${fa(d.progress.quotedLines||0)} قلم` : `${fa(d.data.offers?.length || 0)} پیشنهاد` }] : []),
    ...(tab === 'receipts' ? [{ id: 'rejected', header: 'پیگیری بار ردشده', cell: (d: Doc) => <div className="space-y-1 text-sm"><p>رد قطعی: {quantity(d.progress.rejected, d.data.unit)}</p><p>برگشت واقعی: {quantity(d.progress.returned, d.data.unit)}</p></div> }] : []),
    ...(tab === 'orders' && access.prices ? [{ id: 'price', header: 'نرخ واحد (تومان)', cell: (d: Doc) => d.data.price == null ? 'در انتظار توافق' : fa(d.data.price) }] : []),
    { id: 'status', header: 'وضعیت', cell: displayStatus },
  ];
  const actionsFor = (d: Doc): ErpAction[] => {
    const actions: ErpAction[] = [];
    if (d.kind === 'INQUIRY' || d.kind === 'INQUIRY_CASE') {actions.push({label:'مشاهده استعلام',icon:FaEye,onClick:() => navigateInquiry(d.id)});if(access.requester)actions.push({label:d.kind==='INQUIRY_CASE'?'استعلام جدید برای این اقلام':'استعلام جدید برای این سنگ',icon:FaPlus,onClick:()=>repeatInquiry(d)});}
    if (d.kind === 'REQUEST') {
      if(access.buyer&&d.parentId&&d.data.inquirySelection)actions.push({label:'بازبینی پیشنهادهای این درخواست',onClick:()=>router.push(`/dashboard/purchasing/inquiries?document=${encodeURIComponent(d.parentId!)}`)});
      if(access.buyer&&positive(d.progress.stockSurplus))actions.push({label:'انتقال مازاد مشتری به سهم انبار',onClick:()=>open('STOCK_SURPLUS',d)});
      if (access.buyer && d.status === 'OPEN' && d.progress.toOrder !== '0') actions.push({ label: 'ثبت سفارش خرید', onClick: () => open('ORDER', d) });
      if (access.buyer) actions.push({ label: 'ثبت پاسخ مسئول خرید', onClick: () => open('QUOTE', d) });
      if (d.creatorId === access.actorId || access.manager) actions.push({ label: positive(d.progress.ordered) ? 'درخواست تغییر یا لغو' : 'ویرایش درخواست', onClick: () => open(positive(d.progress.ordered) ? 'CHANGE' : 'REQUEST', d) });
      if ((access.manager || d.creatorId === access.actorId) && !positive(d.progress.ordered) && d.status === 'OPEN') actions.push({ label: 'لغو درخواست', tone: 'danger', onClick: () => open('CANCEL', d) });
      if (access.manager) actions.push({ label: 'واگذاری مسئول پیگیری', onClick: () => open('ASSIGN', d) });
    }
    if (d.kind === 'ORDER') {
      if(access.buyer&&positive(d.progress.accepted))actions.push({label:'ارسال دریافت‌های این سفارش به حسابداری',onClick:()=>open('ACCOUNTING_HANDOFF',d)});
      if ((d.data.route === 'direct' ? access.buyer : access.receiver) && positive(d.progress.remaining)) actions.push({ label: d.data.route === 'direct' ? 'ثبت تحویل در مقصد' : 'ثبت دریافت بار', onClick: () => open('RECEIPT', d) });
      if (access.prices) actions.push({ label: 'PDF سفارش خرید', onClick: () => print(d) });
      if (access.buyer) actions.push({ label: 'ثبت یا اصلاح قیمت توافقی', onClick: () => open('PRICE', d) }, { label: 'درخواست پیش‌پرداخت', onClick: () => open('ADVANCE', d) }, { label: 'بستن باقی سفارش کارخانه', onClick: () => open('CLOSE_REMAINDER', d) }, { label: 'درخواست تغییر یا لغو', onClick: () => open('CHANGE', d) });
      if (d.data.historical && access.accountant) actions.push({ label: 'اتصال به سابقه قبلی', onClick: () => open('LINK_EXISTING', d) });
    }
    if(d.kind==='WAREHOUSE_TRANSFER'&&access.buyer)actions.push({label:'ارسال برای تطبیق حسابداری',onClick:()=>open('ACCOUNTING_HANDOFF',d)});
    if (d.kind === 'RECEIPT') {
      if(access.buyer&&positive(d.progress.accepted)&&!d.data.existingOnly)actions.push({label:'ارسال برای تطبیق حسابداری',onClick:()=>open('ACCOUNTING_HANDOFF',d)});
      if (d.data.existingOnly && (access.accountant || access.manager)) actions.push({ label: 'اتصال دریافت قبلی انبار', onClick: () => open('LINK_EXISTING', d) });
      if (positive(d.progress.pending) && (access.manager || d.data.route === 'direct' && access.buyer || d.data.route === 'warehouse' && access.receiver)) actions.push({ label: 'بررسی و تأیید کیفیت', onClick: () => open('ACCEPT', d) }, { label: 'ثبت رد قطعی', tone: 'danger', onClick: () => open('REJECT', d) });
      if (access.buyer && positive(d.progress.toReturn)) actions.push({ label: 'ثبت برگشت واقعی', onClick: () => open('RETURN', d) });
      if (access.buyer && positive(d.progress.toExchange)) actions.push({ label: 'ثبت تعویض', onClick: () => open('EXCHANGE', d) });
      if (access.buyer && positive(d.progress.acceptedReturnable)) actions.push({ label: 'برگشت پس از پذیرش', onClick: () => open('RETURN_ACCEPTED', d) });
    }
    if (d.kind === 'EXCHANGE' && positive(d.progress.remaining) && (access.buyer || access.receiver)) actions.push({ label: 'ثبت دریافت بار جایگزین', onClick: () => open('RECEIPT', d) });
    if (d.kind === 'CHANGE' && access.buyer && d.status === 'OPEN') actions.push({ label: 'ثبت نتیجه واقعی تغییر', onClick: () => open('RESOLVE_CHANGE', d) });
    if (d.kind === 'ADVANCE' && (access.accountant || access.manager)) actions.push({ label: 'اتصال به پرداخت حسابداری', onClick: () => open('LINK_EXISTING', d) });
    if(d.kind==='ACCOUNTING_HANDOFF'&&d.status==='OPEN'&&access.accountant&&!d.data.invoiceId)actions.push({label:'تطبیق و ثبت فاکتور',onClick:()=>open('ACCOUNTING_RECOGNIZE',d)});
    if(d.kind==='ACCOUNTING_HANDOFF'&&d.status==='OPEN'&&!d.data.invoiceId&&(access.buyer||access.accountant))actions.push({label:'لغو ارسال به حسابداری',onClick:()=>open('ACCOUNTING_HANDOFF_CANCEL',d)});
    if(d.kind==='ACCOUNTING_HANDOFF'&&access.buyer&&['PRICE_MISMATCH','COST_MISMATCH'].includes(d.data.paymentStatus))actions.push({label:'بررسی توافق سفارش خرید',onClick:async()=>{try{const response=await purchasingAPI.detail(d.data.orderId);open('PRICE',{...response.data.data.document,progress:{}});}catch(e){setFeedback({kind:'error',title:purchaseError(e)});}}});
    if(d.kind==='SUPPLIER'&&access.accountant)actions.push({label:'تطبیق طرف‌حساب حسابداری',onClick:()=>open('ACCOUNTING_SUPPLIER_LINK',d)});
    if (d.kind !== 'SUPPLIER' && d.kind !== 'INQUIRY' && d.kind !== 'INQUIRY_CASE') actions.push({ label: 'جزئیات و سوابق', onClick: () => open('DETAIL', d) });
    const preferred=d.kind==='REQUEST'?'ثبت سفارش خرید':d.kind==='ORDER'?'ثبت دریافت بار':d.kind==='RECEIPT'?positive(d.progress.pending)?'بررسی و تأیید کیفیت':positive(d.progress.toReturn)?'ثبت برگشت واقعی':positive(d.progress.toExchange)?'ثبت تعویض':'':null;
    if(preferred)actions.sort((left,right)=>Number(right.label===preferred)-Number(left.label===preferred));
    return actions;
  };
  const primary: ErpAction[] = ['requests','inquiries'].includes(tab) && access.requester ? [{ label: 'استعلام جدید', onClick: () => {setStartingContract(null);setInquirySeed(null);setSheet('START');}, icon: FaPlus, variant: 'solid' }] : tab === 'orders' && access.buyer ? [{ label: 'سفارش خرید جدید', onClick: () => open('ORDER'), icon: FaPlus, variant: 'solid' }] : tab === 'receipts' && (access.buyer || access.receiver) ? [{ label: 'ثبت دریافت بار', onClick: () => open('RECEIPT'), icon: FaPlus, variant: 'solid' }] : tab === 'suppliers' && access.buyer ? [{ label: 'تأمین‌کننده جدید', onClick: () => open('SUPPLIER'), icon: FaPlus, variant: 'solid' }] : [];
  const titles: Record<string, string> = { ACCOUNTING_HANDOFF_CANCEL:'لغو ارسال به حسابداری', STOCK_SURPLUS:'انتقال مازاد مشتری به سهم انبار', HISTORICAL_PURCHASE:'خرید انجام‌شده', ACCOUNTING_HANDOFF:'ارسال برای تطبیق حسابداری', ACCOUNTING_RECOGNIZE:'فاکتور حسابداری', ACCOUNTING_SUPPLIER_LINK:'تطبیق طرف‌حساب', CANCEL: 'لغو درخواست خرید', REQUEST: 'ویرایش درخواست خرید', ORDER: 'سفارش خرید', RECEIPT: draft.exchangeId ? 'دریافت بار جایگزین' : 'دریافت بار', ACCEPT: 'پذیرش کیفیت', REJECT: 'رد قطعی کیفیت', RETURN: 'برگشت واقعی بار', EXCHANGE: 'تعویض با تأمین‌کننده', RETURN_ACCEPTED: 'برگشت پس از پذیرش', SUPPLIER: 'تأمین‌کننده', DETAIL: 'جزئیات و سوابق', QUOTE: 'پاسخ مسئول خرید', CHANGE: 'درخواست تغییر یا لغو', ASSIGN: 'واگذاری مسئول پیگیری', PRICE: 'قیمت توافقی', ADVANCE: 'درخواست پیش‌پرداخت', CLOSE_REMAINDER: 'بستن باقی سفارش کارخانه', LINK_EXISTING: 'اتصال به سابقه موجود', RESOLVE_CHANGE: 'نتیجه واقعی تغییر' };
  if (sheet === 'INQUIRY_DETAIL' && selected) return <ErpPresentationProvider scope="workspace"><InquiryComparison id={selected.id} access={access} onBack={() => backInquiry(selected.parentId)} onChanged={load} onOrderRequest={openInquiryOrder}/></ErpPresentationProvider>;
  if (sheet === 'INQUIRY_CASE' && selected) return <ErpPresentationProvider scope="workspace"><InquiryCaseView id={selected.id} access={access} onBack={()=>backInquiry()} onChanged={load} onOpenLine={navigateInquiry}/></ErpPresentationProvider>;
  if(sheet==='OPENING_INQUIRY')return <ErpLoading/>;
  if (sheet === 'START') return <ErpPresentationProvider scope="workspace"><PurchaseStart access={access} initialContract={startingContract} initialSeed={inquirySeed} onBack={()=>setSheet('')} onCreated={async result=>{setSheet('OPENING_INQUIRY');router.push(inquiryHref(result.id));}}/></ErpPresentationProvider>;
  if (dashboard && !sheet) return <ErpPresentationProvider scope="workspace"><PurchaseDashboard workspace={workspace} onStart={()=>{setStartingContract(null);setInquirySeed(null);setSheet('START');}} onStartContract={contract=>{setStartingContract(contract);setInquirySeed(null);setSheet('START');}} onNavigate={changeTab} onContinue={(doc,action)=>{if(action==='INQUIRY_CASE'||action==='INQUIRY_DETAIL'){navigateInquiry(doc.id);}else open(action,doc);}}/></ErpPresentationProvider>;
  return <ErpPresentationProvider scope="workspace"><div className="sds-neumorphic-scope space-y-5 pb-20">
    <ErpListPage title={tabs[tab]} eyebrow="فضای کاری خرید" description={descriptions[tab]} actions={[...primary,...(tab==='orders'&&access.buyer?[{label:'ثبت خرید انجام‌شده',variant:'outline' as const,onClick:()=>open('HISTORICAL_PURCHASE')}]:[]), { label: 'به‌روزرسانی', icon: FaSync, tone: 'neutral', variant: 'soft', onClick: load }]}
      metrics={purchaseMetrics(workspace)}
      rows={visibleRows} rowKey={d => d.id} columns={columns} rowActions={actionsFor} rowActionMode={tab==='inquiries'?'icons':'menu'}
      filters={[{ id: 'search', type: 'search', label: 'جست‌وجو', placeholder: 'شماره سند، قرارداد، سنگ یا تأمین‌کننده', value: search, onChange: setSearch }, { id: 'status', type: 'select', label: 'وضعیت پرونده', value: filter, onChange: changeStatusFilter, options: [...(['requests','orders','receipts'].includes(tab)?[{value:'attention',label:tab==='requests'?'نیازمند تأمین':tab==='orders'?'منتظر دریافت':'منتظر بررسی کیفیت'}]:[]),{ value: 'all', label: 'همه پرونده‌ها' }, { value: 'open', label: 'باز' }, { value: 'closed', label: 'بسته و تعیین تکلیف‌شده' }] }]}
      emptyState={<ErpEmptyState title="موردی برای نمایش وجود ندارد." description="با این جست‌وجو و فیلتر، موردی در این بخش پیدا نشد." />}
      footer={<p className="text-xs text-[var(--sds-text-muted)]">نمایش حداکثر {fa(workspace.limit)} از {fa(workspace.total)} سند مطابق جست‌وجو و دسترسی شما؛ برای پرونده قدیمی از جست‌وجو استفاده کنید.</p>}
    >{feedback && <ErpInlineState kind={feedback.kind} title={feedback.title} action={nextAction()} />}</ErpListPage>
    <ErpSheet open={Boolean(sheet)} onClose={closeSheet} presentation="modal" size="default" scope="workspace" title={titles[sheet] || 'خرید'} pending={busy||attachmentLocked} dismissible={!uncertain&&!attachmentLocked}
      footer={<div className="flex flex-wrap items-center justify-between gap-2"><ErpButton label="بستن" variant="outline" onClick={closeSheet} disabled={busy || Boolean(uncertain)||attachmentLocked} />{sheet !== 'DETAIL' && <ErpButton label={uncertain ? 'ارسال دوباره همین ثبت' : `ثبت ${titles[sheet] || ''}`} variant="solid" tone={sheet === 'REJECT' ? 'danger' : 'primary'} onClick={save} disabled={busy} />}</div>}>
      <div className="space-y-4">{errors.general && <ErpInlineState kind="error" title={errors.general} />}{uncertain && <ErpInlineState kind="stale" title="نتیجه ثبت نامشخص است؛ پیش از ثبت تازه، نتیجه همین درخواست را بررسی کنید." action={{ label: 'بررسی نتیجه ثبت', onClick: checkOutcome, disabled: busy }} />}
      <fieldset disabled={busy || Boolean(uncertain)} className="min-w-0 space-y-4">
        {sheet === 'REQUEST' && <>
          {select('reason', 'علت خرید', [{ id: 'contract', name: 'سفارش مشتری' }, { id: 'stock', name: 'نیاز انبار' }], id => { setDraft(d => ({ ...d, reason: id, contractId: '', itemId: '', stone: '', quantity: '' })); })}
          {draft.reason === 'contract' && <>{<ErpField label="جست‌وجوی قرارداد"><ErpInput value={contractSearch} onChange={e => setContractSearch(e.target.value)} placeholder="شماره قرارداد یا نام مشتری" /></ErpField>}{select('contractId', 'قرارداد مشتری', contracts.map(c => ({ id: c.id, name: `${purchaseDigits(c.number)} · ${c.customer}${c.partner ? ' · همکار' : ''}` })), chooseContract)}{select('itemId', 'ردیف قرارداد', (selectedContract?.items || []).map(i => ({ id: i.id, name: `${i.stone} · ${quantity(i.quantity, i.unit)}` })), id => { const item = selectedContract?.items.find(i => i.id === id); setDraft(d => ({ ...d, itemId: id, stone: item?.stone || '', quantity: item?.quantity || '', unit: item?.unit || 'مترمربع' })); })}{selectedContract?.sourceError && <ErpInlineState kind="error" title={selectedContract.sourceError} />}{selectedContract && !selectedContract.financial && <ErpInlineState kind="permission" title="اعلام نیاز مجاز است؛ سفارش قطعی به رکورد مالی معتبر نیاز دارد." />}</>}
          {field('stone', 'سنگ و مشخصات اولیه', { required: true, readOnly: draft.reason === 'contract'||Boolean(selected?.data.inquirySelection) })}
          <div className="grid gap-3 sm:grid-cols-2">{field('quantity', 'مقدار موردنیاز', { decimal: true, hint: 'اگر هنوز مشخص نیست، خالی بگذارید.' })}{draft.reason === 'contract'||selected?.data.inquirySelection ? <ErpFieldView label="واحد قرارداد" value={get('unit')} /> : unitField}</div>
          <ErpFieldView label="روش تأمین" value={draft.raw?'قلم خام برای فرآوری':'محصول آماده'}/>
          {select('ownerId', 'مسئول پیگیری خرید', buyers)}
          <ErpDisclosure title="مشخصات تکمیلی و موعد (اختیاری)"><div className="space-y-4">{field('dimensions', 'ابعاد و ضخامت',{readOnly:Boolean(selected?.data.inquirySelection)})}{dateField('date', 'موعد موردنیاز')}{notes}</div></ErpDisclosure>
        </>}
        {sheet === 'ORDER' && <>
          {select('requestId', 'درخواست خرید', workspace.requests.filter(r => r.status === 'OPEN').map(r => ({ id: r.id, name: `${r.number} · ${r.data.stone}` })), chooseRequest)}
          {selectedRequest && <p className="text-sm text-[var(--sds-text-secondary)]">باقی سفارش: {quantity(selectedRequest.progress.toOrder, selectedRequest.data.unit)}</p>}
          <PurchaseSupplierPicker value={get('supplierId')} options={suppliers} disabled={busy || Boolean(uncertain)} onChange={id => {const q=inquiryOrderDefaults(selectedRequest,workspace.orders,id);setDraft(d=>({...d,supplierId:id,...(q?{price:q.price,quantity:q.quantity,demandQuantity:q.demandQuantity,purchaseShareQuantity:q.quantity,paymentTerms:q.paymentTerms,date:q.date}:{})}));}}/><ErpDisclosure title="تأمین‌کننده تازه"><ErpButton label="افزودن تأمین‌کننده" variant="ghost" onClick={() => { supplierReturn.current = { draft, selected, allocations: extraAllocations, costs }; open('SUPPLIER'); }} /></ErpDisclosure>
          {field('stone', 'قلم خرید و مشخصات دقیق', { required: true, readOnly: Boolean(selectedRequest?.data.inquirySelection) })}
          {selectedRequest&&purchaseDimensions(selectedRequest.data.purchaseTechnical||selectedRequest.data.technical)&&<ErpFieldView label="مشخصات مورد توافق" value={purchaseDimensions(selectedRequest.data.purchaseTechnical||selectedRequest.data.technical)}/>}
          <div className="grid gap-3 sm:grid-cols-2">{field('quantity', 'مقدار خرید', { required: true, decimal: true })}{unitField}</div>
          {field('demandQuantity', 'سهم تأمین نیاز درخواست (واحد درخواست)', { required: true, decimal: true })}
          {extraAllocations.length > 0 && field('purchaseShareQuantity', 'سهم این درخواست از مقدار خرید', { required: true, decimal: true })}
          <ErpDisclosure title="تجمیع چند نیاز در این سفارش"><div className="space-y-4">{extraAllocations.map((allocation, index) => <ErpCard key={index} className="space-y-3 p-3"><ErpField label="درخواست دیگر" required><ErpSearchableSelect value={allocation.requestId} onChange={e => { const r = find(e.target.value); setExtraAllocations(list => list.map((a, i) => i === index ? { requestId: e.target.value, quantity: String(r?.progress.toOrder || ''), purchaseQuantity: String(r?.progress.toOrder || '') } : a)); }} aria-label={`درخواست دیگر ${index + 1}`}><option value="">انتخاب کنید</option>{workspace.requests.filter(r => r.id !== draft.requestId && r.status === 'OPEN').map(r => <option key={r.id} value={r.id}>{r.number} · {r.data.stone}</option>)}</ErpSearchableSelect></ErpField><div className="grid gap-3 sm:grid-cols-2"><ErpField label="مقدار تأمین نیاز"><ErpInput value={allocation.quantity} inputMode="decimal" onChange={e => setExtraAllocations(list => list.map((a, i) => i === index ? { ...a, quantity: e.target.value } : a))} /></ErpField><ErpField label="سهم از مقدار خرید"><ErpInput value={allocation.purchaseQuantity} inputMode="decimal" onChange={e => setExtraAllocations(list => list.map((a, i) => i === index ? { ...a, purchaseQuantity: e.target.value } : a))} /></ErpField></div><ErpButton label="حذف این سهم" variant="ghost" tone="danger" onClick={() => setExtraAllocations(list => list.filter((_, i) => i !== index))} /></ErpCard>)}<ErpButton label="افزودن نیاز دیگر" variant="outline" onClick={() => { if (!extraAllocations.length) set('purchaseShareQuantity', get('demandQuantity')); setExtraAllocations(list => [...list, { requestId: '', quantity: '', purchaseQuantity: '' }]); }} /><p className="text-xs text-[var(--sds-text-secondary)]">جمع سهم‌ها از مقدار خرید باید دقیقاً برابر مقدار کل سفارش باشد.</p></div></ErpDisclosure>

          {(selectedRequest?.data.unit !== get('unit') || (extraAllocations.length ? get('purchaseShareQuantity') : get('quantity')) !== get('demandQuantity') || extraAllocations.some(a => a.quantity !== a.purchaseQuantity || find(a.requestId)?.data.unit !== get('unit'))) && <ErpCheckbox label="رابطه مقدار خرید و مقدار تأمین نیاز را بررسی و تأیید کرده‌ام." checked={draft.conversionConfirmed === true} onChange={e => set('conversionConfirmed', e.target.checked)} />}
          {field('price', 'قیمت هر واحد (تومان)', { decimal: true, hint: 'اگر توافق نشده، خالی بگذارید؛ خالی به معنای صفر نیست.' })}
          <ErpDisclosure title="هزینه‌های جانبی"><OrderCosts costs={costs} onChange={setCosts} suppliers={suppliers}/></ErpDisclosure>
          {select('route', 'محل تحویل', [{ id: 'warehouse', name: 'انبار سبلان' }, { id: 'direct', name: 'ارسال مستقیم به مشتری' }])}
          <ErpDisclosure title="موعد، شرایط پرداخت و خرید انجام‌شده"><div className="space-y-4">{dateField('date', 'موعد تحویل')}{field('paymentTerms', 'شرایط پرداخت',{readOnly:Boolean(selectedRequest?.data.inquirySelection?.some((s:any)=>s.offerSnapshot?.terms))})}<ErpCheckbox label="این خرید قبلاً خارج از سیستم انجام شده است." checked={draft.historical === true} onChange={e => set('historical', e.target.checked)} />{draft.historical && dateField('occurredAt', 'تاریخ واقعی خرید')}{notes}</div></ErpDisclosure>
        </>}
        {sheet === 'RECEIPT' && <>
          {draft.exchangeId ? <ErpFieldView label="پرونده تعویض" value={find(get('exchangeId'))?.number || 'تعویض مرتبط'} /> : select('orderId', 'سفارش خرید', workspace.orders.map(o => ({ id: o.id, name: `${o.number} · ${o.data.supplierName} · ${o.data.stone}` })), chooseOrder)}
          {selectedOrder && <p className="text-sm text-[var(--sds-text-secondary)]">{selectedOrder.data.route === 'direct' ? 'تحویل مستقیم' : 'انبار سبلان'} · باقی دریافت: {quantity(draft.exchangeId ? find(get('exchangeId'))?.progress.remaining : selectedOrder.progress.remaining, selectedOrder.data.unit)}</p>}
          {selectedOrder?.data.route === 'direct' && <>{select('customerId', 'مشتری مقصد', customers, id => setDraft(d => ({ ...d, customerId: id, recipientId: '' })))}{select('recipientId', 'تأییدکننده در مقصد', (destinationCustomer?.contacts || []).map(c => ({ id: c.id, name: `${c.name} · ${c.role}` })))}</>}
          {select('quality', 'نتیجه بررسی کیفیت', [{ id: 'pending', name: 'هنوز بررسی نشده؛ فقط دریافت ثبت شود' }, { id: 'all', name: 'تمام مقدار رسیده پذیرفته است' }, { id: 'partial', name: 'فقط بخشی از بار پذیرفته است' }])}
          <div className="grid gap-3 sm:grid-cols-2">{field('quantity', `مقدار بار رسیده (${selectedOrder?.data.unit || ''})`, { required: true, decimal: true })}{draft.quality === 'partial' && field('accepted', 'مقدار پذیرفته‌شده', { required: true, decimal: true })}</div>
          {selectedOrder?.data.historical && <ErpCheckbox label="این دریافت قبلاً در انبار ثبت شده؛ فقط ارجاع به سابقه قبلی است." checked={draft.existingOnly === true} onChange={e => set('existingOnly', e.target.checked)} />}<ErpInlineState kind="permission" title="فقط مقدار پذیرفته‌شده قابل مصرف است؛ پذیرش‌نشده هنوز رد قطعی یا برگشت محسوب نمی‌شود." />{notes}
        </>}
        {['ACCEPT', 'REJECT', 'RETURN', 'RETURN_ACCEPTED', 'EXCHANGE'].includes(sheet) && selected && <>
          {['ACCEPT','REJECT'].includes(sheet)&&select('qualityOutcome','نتیجه بررسی',[{id:'ACCEPT',name:'پذیرفته است'},{id:'REJECT',name:'رد قطعی کیفیت'}],value=>open(value,selected))}
          <ErpFieldView label="رسید بار" value={`${selected.number} · ${selected.data.stone}`} />
          <div className="grid gap-3 sm:grid-cols-2"><ErpFieldView label="پذیرفته‌شده" value={quantity(selected.data.accepted, selected.data.unit)} /><ErpFieldView label={sheet === 'RETURN_ACCEPTED' ? 'قابل برگشت از پذیرش قبلی' : sheet === 'RETURN' ? 'باقی برگشت' : sheet === 'EXCHANGE' ? 'بدون تعویض' : 'بررسی‌نشده'} value={quantity(sheet === 'RETURN_ACCEPTED' ? selected.progress.acceptedReturnable : sheet === 'RETURN' ? selected.progress.toReturn : sheet === 'EXCHANGE' ? selected.progress.toExchange : selected.progress.pending, selected.data.unit)} /></div>
          {field('quantity', `مقدار ${titles[sheet]} (${selected.data.unit})`, { required: true, decimal: true })}
          {sheet==='RETURN_ACCEPTED'&&(selected.data.acceptedShares||[]).filter((s:any)=>positive(s.purchaseQuantity)&&!s.warehouseTransferred).length>1&&select('shareRequestId','برگشت از سهم',selected.data.acceptedShares.filter((s:any)=>positive(s.purchaseQuantity)&&!s.warehouseTransferred).map((s:any)=>({id:s.requestId||'stock',name:`${s.contractId?find(s.requestId)?.source?.number?`قرارداد ${find(s.requestId)!.source!.number}`:'سهم قرارداد':'سهم انبار'} · ${quantity(s.purchaseQuantity,selected.data.unit)}`})))}
          {['REJECT', 'RETURN_ACCEPTED'].includes(sheet) && select('reason', 'علت', ['کیفیت یا سورت نامناسب', 'شکستگی یا آسیب', 'مغایرت ابعاد یا ضخامت', 'سایر'].map(id => ({ id, name: id })))}
          {['RETURN', 'RETURN_ACCEPTED'].includes(sheet) && <ErpCheckbox label="این مقدار واقعاً به تأمین‌کننده برگشت داده شده است." checked={draft.physicalConfirmed === true} onChange={e => set('physicalConfirmed', e.target.checked)} />}
          {sheet === 'EXCHANGE' && <ErpInlineState kind="permission" title="توافق تعویض، دریافت یا تأیید بار جدید نیست و خرید یا بدهی تکراری ایجاد نمی‌کند." />}
{notes}
        </>}
        {sheet === 'SUPPLIER' && <>{select('partyId', 'طرف‌حساب موجود (اختیاری)', parties, undefined, false)}{field('name', 'نام تأمین‌کننده', { required: !get('partyId') })}{field('contact', 'شماره تماس یا راه ارتباطی', { required: true })}<ErpInlineState kind="permission" title="اگر طرف‌حساب قبلاً مشتری یا تأمین‌کننده است، همان هویت موجود را انتخاب کنید." /></>}
        {sheet==='ACCOUNTING_SUPPLIER_LINK'&&<>{select('accountingPartyId','طرف‌حساب حسابداری',parties)}<ErpInlineState kind="permission" title="همان طرف‌حساب موجود را انتخاب کنید. این اقدام حساب یا بدهی تازه ایجاد نمی‌کند."/></>}
        {sheet==='ACCOUNTING_HANDOFF'&&<>{field('quantity',`مقدار پذیرفته‌شده برای تطبیق (${selected?.data.unit})`,{required:true,decimal:true})}{field('invoiceNumber','شماره فاکتور (اختیاری)')}{field('price','نرخ واحد فاکتور (تومان، اختیاری)',{decimal:true})}<ErpInlineState kind="permission" title="حسابداری مقدار و قیمت را تطبیق می‌دهد؛ با این ارسال، بدهی یا پرداختی ثبت نمی‌شود."/></>}
        {sheet==='ACCOUNTING_RECOGNIZE'&&selected&&<AccountingReview document={selected} values={draft} set={set} locked={busy||Boolean(uncertain)}/>}
        {sheet==='ACCOUNTING_HANDOFF_CANCEL'&&<ErpInlineState kind="permission" title="فقط ارسالِ ثبت‌نشده به حسابداری لغو می‌شود. رسید بار، سفارش و اسناد مالی قبلی حذف یا تغییر نمی‌کنند."/>}
        {sheet==='STOCK_SURPLUS'&&selected&&<>
          <ErpFieldView label="مازاد پذیرفته‌شده" value={quantity(selected.progress.stockSurplus,selected.data.unit)}/>
          {field('quantity',`مقدار انتقال از سهم مشتری (${selected.data.unit})`,{required:true,decimal:true})}
          <ErpInlineState kind="permission" title="برای سنگ موجود در انبار، سهم محفوظ مشتری آزاد می‌شود. بار ارسال مستقیم فقط پس از دریافت واقعی در انبار قابل انتقال است؛ پذیرش یا اسناد قبلی حذف نمی‌شوند."/>
          {selected.data.raw&&<ErpCheckbox label="تبدیل سهم محصول نهایی به مقدار سنگ خامِ موجود را بررسی کرده‌ام." checked={draft.conversionConfirmed===true} onChange={e=>set('conversionConfirmed',e.target.checked)}/>}
          <ErpCheckbox label="اگر بار در مقصد مشتری بوده، اکنون واقعاً در انبار سبلان دریافت شده است." checked={draft.physicalConfirmed===true} onChange={e=>set('physicalConfirmed',e.target.checked)}/>
        </>}
        {sheet==='HISTORICAL_PURCHASE'&&<>
          <ErpInlineState kind="permission" title="فقط خریدی را ثبت کنید که واقعاً انجام شده است. تاریخ خرید و زمان ثبت جدا می‌مانند؛ درخواست یا تأیید قبلی ساخته نمی‌شود."/>
          {select('supplierId','تأمین‌کننده',suppliers)}{field('stone','سنگ خریداری‌شده',{required:true})}<div className="grid gap-3 sm:grid-cols-2">{field('quantity','مقدار خریداری‌شده',{required:true,decimal:true})}{unitField}</div>{field('price','نرخ واحد (تومان، اختیاری)',{decimal:true})}{dateField('occurredAt','تاریخ واقعی خرید')}
          {select('route','مسیر واقعی بار',[{id:'warehouse',name:'انبار سبلان'},{id:'direct',name:'ارسال مستقیم به مشتری'}])}
          <ErpDisclosure title="اتصال به قرارداد مشتری"><div className="space-y-4"><ErpField label="جست‌وجوی قرارداد"><ErpInput value={contractSearch} onChange={e=>setContractSearch(e.target.value)}/></ErpField>{select('contractId','قرارداد موجود',contracts.map(c=>({id:c.id,name:`${purchaseDigits(c.number)} · ${c.customer}`})),id=>{set('contractId',id);set('itemId','');},false)}{get('contractId')&&select('itemId','ردیف قرارداد',selectedContract?.items.map(i=>({id:i.id,name:i.stone}))||[])}</div></ErpDisclosure>{notes}
        </>}
        {sheet === 'DETAIL' && (detail ? <div className="space-y-4"><ErpFieldView label="پرونده" value={selected?.number} /><ErpFieldView label="سنگ / شرح" value={purchaseText(selected?.data.stone || selected?.data.notes) || '—'} />{selected&&['RECEIPT','WAREHOUSE_TRANSFER'].includes(selected.kind)&&<ReceiptInventorySummary inventory={detail.inventory} route={detail.document.data.route}/>} {detail.document?.data.resolution && <ErpFieldView label="نتیجه پیگیری" value={detail.document.data.resolution} />}{detail.document?.data.lastReason && <ErpFieldView label="علت رد یا برگشت" value={detail.document.data.lastReason} />}{detail.document?.data.lastNotes && <ErpFieldView label="آخرین توضیح پیگیری" value={detail.document.data.lastNotes} />}{detail.document?.data.closeNotes && <ErpFieldView label="نتیجه بستن باقی سفارش" value={detail.document.data.closeNotes} />}{detail.document?.data.recipient && <ErpFieldView label="تأییدکننده تحویل" value={`${detail.document.data.recipient.name} · ${detail.document.data.recipient.role}`} />}{selected?.kind === 'REQUEST' && selected.progress.stockSurplus && selected.progress.stockSurplus !== '0' && <ErpFieldView label="مازاد سهم مشتری؛ نیازمند تعیین تکلیف برای انبار" value={quantity(selected.progress.stockSurplus, selected.data.unit)} />}{detail.document?.data.exception && <ErpInlineState kind="error" title="در زمان این خرید، رکورد مالی معتبر قرارداد احراز نشده است. واقعیت خرید ثبت شده؛ مغایرت را مدیریت و حسابداری باید تعیین تکلیف کنند." />}{selected?.kind === 'REQUEST' && selected.progress.sourceChanged && <ErpInlineState kind="stale" title="قرارداد مبدأ تغییر کرده است؛ مقدار جاری و سهم مازاد انبار را بررسی کنید." />}{detail.document?.data.quoteHistory?.length > 0 && <ErpCard className="space-y-2 p-3"><strong>آخرین پاسخ مسئول خرید</strong>{[detail.document.data.quoteHistory.at(-1)].map((quote: any) => <div key="quote"><p>{({ AVAILABLE: 'قابل تأمین', UNAVAILABLE: 'قابل تأمین نیست', REPLACEMENT: 'پیشنهاد جایگزین' } as Record<string, string>)[quote.result] || 'پاسخ ثبت شد'}</p>{quote.quantity && <p>مقدار قابل تأمین: {quantity(quote.quantity, detail.document.data.unit)}</p>}{quote.price != null && <p>قیمت پیشنهادی: {fa(quote.price)} تومان</p>}{quote.readyDate && <p>آماده‌شدن: {new Date(quote.readyDate).toLocaleDateString('fa-IR')}</p>}{quote.arrivalDate && <p>رسیدن: {new Date(quote.arrivalDate).toLocaleDateString('fa-IR')}</p>}{quote.replacement && <p>جایگزین: {quote.replacement}</p>}</div>)}</ErpCard>}<PurchaseAttachments embedded document={detail.document} access={access} attachments={detail.attachments||[]} onLockChange={setAttachmentLocked} onChanged={async()=>{const r=await purchasingAPI.detail(detail.document.id);setDetail(r.data.data);await load();}}/>{detail.events?.map((event: any) => <ErpCard key={event.id} className="p-3"><p>نسخه {fa(event.version)} · {({ CREATED: 'ثبت اولیه', ACCEPT: 'پذیرش کیفیت', REJECT: 'رد قطعی', RETURN: 'برگشت واقعی', RETURN_ACCEPTED: 'برگشت پس از پذیرش', EXISTING_EVIDENCE_LINKED: 'اتصال سابقه', REQUEST_EDITED: 'اصلاح درخواست', PRICE: 'قیمت توافقی', QUOTE: 'پاسخ تأمین', ASSIGN: 'واگذاری مسئول', CANCEL: 'لغو درخواست', CLOSE_REMAINDER: 'بستن باقی سفارش' } as Record<string, string>)[event.action] || 'به‌روزرسانی پرونده'}</p><p className="text-xs text-[var(--sds-text-muted)]">{new Date(event.createdAt).toLocaleString('fa-IR')} · {purchaseText(event.actor?.name) || 'کاربر ثبت‌کننده'}</p></ErpCard>)}{detail.links?.map((link: any) => <p key={link.sourceId}>سابقه متصل: {({SUPPLIER_INVOICE:'فاکتور تأمین‌کننده',PAYMENT:'پرداخت حسابداری',INVENTORY_EVENT:'رویداد موجودی'} as Record<string,string>)[link.sourceType]||'سند مرتبط'}</p>)}</div> : <ErpLoading />)}
        {sheet === 'QUOTE' && <>{field('price', 'قیمت پیشنهادی (تومان)', { decimal: true })}{field('quantity', 'مقدار قابل تأمین', { decimal: true })}<div className="grid gap-3 sm:grid-cols-2">{dateField('readyDate', 'تاریخ آماده‌شدن')}{dateField('date', 'تاریخ رسیدن')}</div>{select('result', 'نتیجه پاسخ', [{ id: 'AVAILABLE', name: 'قابل تأمین' }, { id: 'UNAVAILABLE', name: 'قابل تأمین نیست' }, { id: 'REPLACEMENT', name: 'پیشنهاد جایگزین' }], undefined, false)}{field('replacement', 'سنگ جایگزین پیشنهادی (اختیاری)')}{notes}</>}
        {sheet === 'PRICE' && <><ErpDisclosure title="هزینه‌های جانبی"><OrderCosts costs={costs} onChange={setCosts} suppliers={suppliers}/></ErpDisclosure>{field('price', 'قیمت توافقی هر واحد (تومان)', { decimal: true, hint: 'قیمت قبلی در سابقه حفظ می‌شود؛ فاکتور حسابداری باید جدا تطبیق یابد.' })}</>}
        {sheet === 'ASSIGN' && select('ownerId', 'مسئول جدید', buyers)}
        {sheet === 'CHANGE' && <>{select('requestedAction', 'نوع درخواست', [{ id: 'EDIT', name: 'اصلاح' }, { id: 'CANCEL', name: 'لغو' }])}<ErpField label="شرح تغییر موردنیاز" required error={errors.notes}><ErpTextarea value={get('notes')} onChange={e => set('notes', e.target.value)} /></ErpField></>}
        {sheet === 'RESOLVE_CHANGE' && <><ErpInlineState kind="permission" title="نتیجه پیگیری ثبت می‌شود؛ بستن تعهد باقی کارخانه و اصلاح قرارداد، اقدام‌های جداگانه‌اند." /><ErpField label="نتیجه واقعی نزد تأمین‌کننده" required error={errors.notes}><ErpTextarea value={get('notes')} onChange={e => set('notes', e.target.value)} /></ErpField></>}
        {sheet === 'ADVANCE' && <>{field('amount', 'مبلغ درخواستی (تومان)', { required: true, decimal: true })}<ErpInlineState kind="permission" title="این ثبت، درخواست به حسابداری است؛ پرداخت واقعی یا تسویه انجام نمی‌دهد." />{notes}</>}
        {sheet === 'CANCEL' && <ErpInlineState kind="permission" title="درخواست لغو می‌شود؛ سابقه آن باقی می‌ماند. این کار تعهد سفارش ایجادشده را لغو نمی‌کند." />}
        {sheet === 'CLOSE_REMAINDER' && <><ErpInlineState kind="permission" title="باقی سفارش این کارخانه بسته می‌شود؛ کسری نیاز مشتری همچنان باز می‌ماند." />{notes}</>}
        {sheet === 'LINK_EXISTING' && <>{select('sourceType', 'نوع سابقه', [...(access.accountant ? [{ id: 'SUPPLIER_INVOICE', name: 'فاکتور تأمین‌کننده' }, { id: 'PAYMENT', name: 'پرداخت حسابداری' }] : []), ...(access.receiver ? [{ id: 'INVENTORY_EVENT', name: 'رویداد موجودی' }] : [])])}{existing.filter(e => e.type === draft.sourceType).length > 0 && select('sourceId', 'انتخاب سابقه موجود', existing.filter(e => e.type === draft.sourceType).map(e => ({ id: e.id, name: e.label || e.name })))}{!existing.filter(e => e.type === draft.sourceType).length && field('sourceId', 'شناسه سابقه معتبر', { required: true })}<ErpInlineState kind="permission" title="اتصال فقط سابقه موجود را پیوند می‌دهد؛ موجودی، بدهی یا پرداخت دوباره ثبت نمی‌شود." /></>}
      </fieldset></div>
    </ErpSheet>
  </div></ErpPresentationProvider>;
}
