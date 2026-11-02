import {acceptedDemandForRequest, purchaseCustodyProjection} from './custody';
import {ordinaryPurchaseDemands} from './ordinaryDemand';
import {offerValid, withOfferAvailability} from './contractEntry';
import { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { accessFor, canReadDocument, redact, assertCapability, type Actor } from './access';
import { partnerPurchaseSource, partnerFinancialReady, ordinaryItemUnit, purchasingUnit } from './source';
import { contactsFor } from './service';
import { asDoc, document, json } from './repository';
import { add, sub, max, min, gt,Decimal, text, label, orderProgress, receiptProgress, exchangeProgress, cleanDigits, PurchasingError, type Doc } from './domain';

type Database = typeof prisma | Prisma.TransactionClient;
export async function purchasingLookups(actor: Actor, search = '', kind = 'contracts', sourceId = '', db: Database = prisma) {
  const a = await accessFor(db, actor), q = cleanDigits(text(search, 100));
  if(kind==='accounting-periods') {
    assertCapability(a.accountant);
    const periods=await db.accountingPostingPeriod.findMany({where:{status:'OPEN',fiscalYear:{status:'ACTIVE'}},include:{fiscalYear:{include:{book:true}}},orderBy:{startsAt:'desc'},take:100});
    return periods.map(p=>({id:p.id,name:`${p.fiscalYear.book.namePersian} · ${p.fiscalYear.titlePersian} · ${p.titlePersian}`,bookId:p.fiscalYear.bookId}));
  }
  if (kind === 'inquiry-sources') {
    const ownContracts = !a.all ? await db.salesContract.findMany({where:{responsibleSellerId:actor.id},select:{id:true}}) : [];
    const rows = await db.purchasingDocument.findMany({where:{kind:'INQUIRY',status:'OPEN',...(!a.all ? {OR:[{creatorId:actor.id},{ownerId:actor.id},{contractId:{in:ownContracts.map(c=>c.id)}}]} : {}),...(q ? {data:{path:['stone'],string_contains:q}} : {})},orderBy:{updatedAt:'desc'},take:80});
    const visible: Array<{id:string;name:string;stone:string;unit:string}> = [];
    for (const row of rows) {
      const doc = asDoc(row);
      if (!await canReadDocument(db,a,doc) || !(doc.data.offers || []).some(offerValid)) continue;
      visible.push({id:doc.id,name:`${label(doc)} · ${doc.data.stone}`,stone:doc.data.stone,unit:doc.data.unit});
    }
    return visible;
  }
  if (kind === 'contracts') {
    const rows = await db.salesContract.findMany({ where: { isInactive: false, status: { notIn: ['CANCELLED', 'EXPIRED'] }, ...(!a.buyer && !a.manager ? { responsibleSellerId: actor.id } : {}), ...(q ? { OR: [{ contractNumber: { contains: q } }, { customer: { OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }, { companyName: { contains: q } }] } }] } : {}) }, select: { id: true, contractNumber: true, commercialRevision: true, partnerCaseId: true, productGraphState:true, customerId: true, customer: { select: { firstName: true, lastName: true, companyName: true } }, items: { where: { retiredAt: null }, select: { id: true, productId:true, productRowId:true, description: true, quantity: true, productType: true, product: { select: { code:true,name: true, namePersian: true, preparedSalesUnit: true, volumetricSalesUnit: true } } } } }, orderBy: { createdAt: 'desc' }, take: 40 });
    const ids = rows.map(x => x.id);
    const needs = await db.purchasingDocument.findMany({where:{contractId:{in:ids},kind:'REQUEST',status:{not:'CANCELLED'}},select:{contractId:true,data:true,targetLinks:{where:{purpose:'ALLOCATION',source:{status:{not:'VOID'}}},select:{quantity:true}}}});
    const needFor = (contractId:string,itemId:string,total:string) => {const relevant=needs.filter(n=>n.contractId===contractId && (n.data as any).itemId===itemId);const requested=add(...relevant.map(n=>(n.data as any).quantity));return {requested,ordered:add(...relevant.flatMap(n=>n.targetLinks.map(l=>l.quantity?.toFixed()))),remaining:max('0',sub(total,requested))};};
    const records = await db.accountingFinancialRecord.findMany({ where: { contractId: { in: ids }, voidedAt: null, status: { not: 'VOIDED' }, kind: { in: ['INVOICE_CANDIDATE', 'RECEIVABLE'] } }, select: { contractId: true, sourceSnapshot: true } });
    return Promise.all(rows.map(async r => {
      if (r.partnerCaseId) {
        let views: Awaited<ReturnType<typeof partnerPurchaseSource>>;
        try { views = await partnerPurchaseSource(db, r.partnerCaseId); } catch (error) { return { id: r.id, number: r.contractNumber, customerId: r.customerId, customer: `${r.customer.firstName} ${r.customer.lastName}`.trim() || r.customer.companyName, partner: true, version: r.commercialRevision, financial: false, items: [], sourceError: error instanceof PurchasingError ? error.message : 'منبع پرونده قابل بررسی نیست.' }; }
        return { id: r.id, number: r.contractNumber, customerId: r.customerId, customer: `${r.customer.firstName} ${r.customer.lastName}`.trim() || r.customer.companyName, partner: true, version: views.row.headRevision, financial: await partnerFinancialReady(db, views), items: views.partner.products.map(p => ({ id: p.productRowId, rowId: p.productRowId, stone: p.description, quantity: p.quantity, unit: purchasingUnit(p.unit), ...needFor(r.id,p.productRowId,p.quantity) })) };
      }
      let demands:ReturnType<typeof ordinaryPurchaseDemands>;try{demands=ordinaryPurchaseDemands(r);}catch(error){return {id:r.id,number:r.contractNumber,customerId:r.customerId,customer:`${r.customer.firstName} ${r.customer.lastName}`.trim() || r.customer.companyName,partner:false,version:r.commercialRevision,financial:false,items:[],sourceError:error instanceof PurchasingError?error.message:'مقدار قرارداد قابل بررسی نیست.'};}
      return { id: r.id, number: r.contractNumber, customerId: r.customerId, customer: `${r.customer.firstName} ${r.customer.lastName}`.trim() || r.customer.companyName, partner: false, version: r.commercialRevision, financial: records.some(f => f.contractId === r.id && ((f.sourceSnapshot as any)?.commercialRevision === r.commercialRevision || r.commercialRevision === 0 && !(f.sourceSnapshot as any)?.commercialRevision)), items: r.items.map(i => ({ id: i.id,productId:i.productId,productCode:i.product.code, rowId: i.productRowId || i.id, stone: demands.get(i.id)!.description || i.description || i.product.namePersian || i.product.name, quantity: demands.get(i.id)!.quantity.toFixed(), unit: demands.get(i.id)!.unit, ...needFor(r.id,i.id,demands.get(i.id)!.quantity.toFixed()) })) };
    }));
  }
  if (kind === 'contacts') {
    const order = await document(db, sourceId, 'ORDER'); assertCapability(a.all);
    const customerIds = [...new Set([...(order.data.allocations || []).map((x: any) => x.customerId),...(order.data.captureOnly&&order.customerId?[order.customerId]:[])].filter(Boolean))] as string[];
    const rows = customerIds.length ? await db.crmCustomer.findMany({ where: { id: { in: customerIds }, isActive: true }, select: { id: true, firstName: true, lastName: true, companyName: true } }) : await db.crmCustomer.findMany({ where: { isActive: true, cardDeletedAt: null, ...(q ? { OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }, { companyName: { contains: q } }] } : {}) }, select: { id: true, firstName: true, lastName: true, companyName: true }, take: 30 });
    return Promise.all(rows.map(async c => ({ id: c.id, name: `${c.firstName} ${c.lastName}`.trim() || c.companyName, contacts: await contactsFor(db, c.id) })));
  }
  if (kind === 'suppliers') { assertCapability(a.all); return db.purchasingSupplier.findMany({ where: { isActive: true, ...(q ? { OR: [{ name: { contains: q } }, { contact: { contains: q } }] } : {}) }, select: { id: true, name: true, ...(a.prices ? { contact: true, accountingPartyId: true, customerId: true } : {}) }, orderBy: { name: 'asc' }, take: 100 }); }
  if (kind === 'buyers') {
    const roles = await db.roleWorkspacePermission.findMany({ where: { workspace: 'purchasing', isActive: true, permissionLevel: { in: ['edit', 'admin'] } }, select: { role: true } });
    const users = await db.user.findMany({ where: { isActive: true, OR: [{ role: { in: ['ADMIN', 'MANAGER', ...Object.values(UserRole).filter(role => roles.some(r => r.role === role))] } }, { workspacePermissions: { some: { workspace: 'purchasing', isActive: true, permissionLevel: { in: ['edit', 'admin'] }, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } } }] }, select: { id: true, firstName: true, lastName: true, role: true }, take: 100 });
    const eligible = await Promise.all(users.map(async u => ({ u, eligible: await accessFor(db, u).then(a => a.buyer).catch(() => false) })));
    return eligible.filter(x => x.eligible).map(({ u }) => ({ id: u.id, name: `${u.firstName} ${u.lastName}`.trim() }));
  }
  if (kind === 'parties') {
    assertCapability(a.buyer||a.accountant);
    const [customers, parties] = await Promise.all([
      db.crmCustomer.findMany({ where: { isActive: true, cardDeletedAt: null, ...(q ? { OR: [{ firstName: { contains: q } }, { lastName: { contains: q } }, { companyName: { contains: q } }] } : {}) }, select: { id: true, firstName: true, lastName: true, companyName: true }, take: 30 }),
      db.accountingParty.findMany({ where: { ...(q ? { displayName: { contains: q } } : {}), OR: [{ activeTo: null }, { activeTo: { gt: new Date() } }] }, select: { id: true, displayName: true }, take: 30 }),
    ]);
    return [...customers.map(c => ({ id: `customer:${c.id}`, name: `${c.firstName} ${c.lastName}`.trim() || c.companyName })), ...parties.map(p => ({ id: `party:${p.id}`, name: p.displayName }))];
  }
  if (kind === 'existing') {
    assertCapability(a.accountant, 'مشاهده سوابق مالی به مجوز صریح حسابداری نیاز دارد.');
    if (!sourceId) return [];
    const order = await document(db, sourceId), supplier = order.data.supplierId ? await db.purchasingSupplier.findUnique({ where: { id: order.data.supplierId } }) : order.parentId ? await document(db, order.parentId).then(o => db.purchasingSupplier.findUnique({ where: { id: o.data.supplierId } })) : null;
    if (!supplier?.accountingPartyId) return [];
    const invoices = await db.accountingSupplierInvoice.findMany({ where: { supplierPartyId: supplier.accountingPartyId }, select: { id: true, supplierInvoiceNumber: true, documentDate: true }, orderBy: { createdAt: 'desc' }, take: 50 });
    return invoices.map(i => ({ id: i.id, type: 'SUPPLIER_INVOICE', label: `فاکتور ${i.supplierInvoiceNumber} · ${i.documentDate.toLocaleDateString('fa-IR')}` }));
  }
  throw new PurchasingError('INVALID_LOOKUP', 'فهرست انتخاب‌شده معتبر نیست.', 400);
}
export async function purchasingWorkspace(actor: Actor, q = '', db: Database = prisma) {
  const a = await accessFor(db, actor);
  let visibleIds: string[] | null = null;
  if (!a.all) {
    const ownedContracts = await db.salesContract.findMany({ where: { responsibleSellerId: actor.id }, select: { id: true } });
    const owned = await db.purchasingDocument.findMany({ where: { kind: { in: ['REQUEST', 'INQUIRY', 'INQUIRY_CASE', 'CHANGE'] }, OR: [{ contractId:null, creatorId: actor.id }, { contractId:null, ownerId: actor.id }, { contractId: { in: ownedContracts.map(x => x.id) } }] }, select: { id: true } }); visibleIds = owned.map(x => x.id);
  }
  const visibleKinds = a.all ? ['REQUEST', 'ORDER', 'RECEIPT','WAREHOUSE_TRANSFER', 'EXCHANGE', 'ADVANCE', 'ACCOUNTING_HANDOFF', 'CHANGE', 'INQUIRY', 'INQUIRY_CASE'] : ['REQUEST', 'INQUIRY', 'INQUIRY_CASE', 'CHANGE'];
  const search = text(q, 100), digits = cleanDigits(search), number = /^\d{1,9}$/.test(digits) ? Number(digits) : null;
  const matchingContracts = search ? await db.salesContract.findMany({ where: { contractNumber: { contains: search } }, select: { id: true }, take: 100 }) : [];
  const childMatches=search?await db.purchasingDocument.findMany({where:{kind:'INQUIRY',parentId:{not:null},OR:[{data:{path:['stone'],string_contains:search}},...(number===null?[]:[{number}])]},select:{parentId:true},take:500}):[];
  const where: Prisma.PurchasingDocumentWhereInput = { kind: { in: visibleKinds }, AND:[{OR:[{kind:{not:'INQUIRY'}},{parentId:null}]}], ...(visibleIds ? { id: { in: visibleIds } } : {}), ...(search ? { OR: [{ id: { contains: search } },{id:{in:childMatches.map(c=>c.parentId!)}}, { contractId: { in: matchingContracts.map(c => c.id) } }, { data: { path: ['stone'], string_contains: search } }, { data: { path: ['supplierName'], string_contains: search } }, ...(number === null ? [] : [{ number }])] } : {}) };
  const [rows, total] = await Promise.all([db.purchasingDocument.findMany({ where, orderBy: { createdAt: 'desc' }, take: 500 }), db.purchasingDocument.count({ where })]);
  const requested = rows.map(asDoc);
  const caseIds=requested.filter(d=>d.kind==='INQUIRY_CASE').map(d=>d.id);
  const caseLines=caseIds.length?(await db.purchasingDocument.findMany({where:{kind:'INQUIRY',parentId:{in:caseIds}}})).map(asDoc):[];
  const convertedIds=caseLines.flatMap(l=>(l.data.converted||[]).map((r:any)=>r.requestId));
  const convertedNeeds=convertedIds.length?await db.purchasingDocument.findMany({where:{id:{in:convertedIds},kind:'REQUEST',status:{not:'CANCELLED'}},select:{id:true,data:true}}):[];
  const caseProgress=(doc:Doc)=>{
    const lines=caseLines.filter(l=>l.parentId===doc.id);
    return {openLines:lines.filter(l=>doc.data.reason==='market'?!(l.data.offers||[]).some(offerValid):!((l.data.converted||[]).some((r:any)=>convertedNeeds.some(n=>n.id===r.requestId)))||Boolean(l.data.quantity&&gt(l.data.quantity,add(...convertedNeeds.filter(n=>(l.data.converted||[]).some((r:any)=>r.requestId===n.id)).map(n=>(n.data as any).purchaseQuantity||(n.data as any).quantity))))).length};
  };
  const requestIds = requested.filter(d => d.kind === 'REQUEST').map(d => d.id);
  const allocations = await db.purchasingLink.findMany({ where: { targetId: { in: requestIds }, purpose: 'ALLOCATION' } });
  const orderIds = [...new Set([...requested.filter(d => d.kind === 'ORDER').map(d => d.id), ...allocations.map(x => x.sourceId), ...requested.filter(d => d.kind === 'RECEIPT').map(d => d.parentId!), ...requested.filter(d => d.kind === 'EXCHANGE').map(d => d.data.orderId)])] as string[];
  const graph = (await db.purchasingDocument.findMany({ where: { OR: [{ id: { in: orderIds } }, { parentId: { in: orderIds } }, { kind: 'EXCHANGE', OR: orderIds.map(id => ({ data: { path: ['orderId'], equals: id } })) }] } })).map(asDoc);
  const docs = [...new Map([...requested, ...graph].map(x => [x.id, x])).values()];
  const contractIds = [...new Set([...requested.map(x => x.contractId),...(a.all?docs.filter(d=>d.kind==='ORDER').flatMap(d=>(d.data.allocations||[]).map((allocation:any)=>allocation.contractId)):[])].filter(Boolean))] as string[];
  const sourceRows = await db.salesContract.findMany({ where: { id: { in: contractIds } }, select: { id: true, partnerCaseId: true, contractNumber: true, status: true, isInactive: true, commercialRevision: true, responsibleSellerId: true, productGraphState:true, customer: { select: { firstName: true, lastName: true, companyName: true } }, items: { select: { id: true,productId:true,productRowId:true,productType:true,quantity: true, retiredAt: true,product:{select:{preparedSalesUnit:true,volumetricSalesUnit:true}} } } } });
  const financialRecords=await db.accountingFinancialRecord.findMany({where:{contractId:{in:contractIds},kind:{in:['INVOICE_CANDIDATE','RECEIVABLE']},status:{not:'VOIDED'},voidedAt:null},select:{contractId:true,sourceSnapshot:true}});
  const sources = await Promise.all(sourceRows.map(async source => {
    if (!source.partnerCaseId){const financialReady=financialRecords.some(r=>r.contractId===source.id&&((r.sourceSnapshot as any)?.commercialRevision===source.commercialRevision||source.commercialRevision===0&&!(r.sourceSnapshot as any)?.commercialRevision));try{const demand=ordinaryPurchaseDemands({...source,items:source.items.filter(i=>!i.retiredAt)});return {...source,financialReady,items:source.items.map(i=>({...i,quantity:demand.get(i.id)?.quantity || i.quantity})),integrityUnavailable:false};}catch{return {...source,financialReady,integrityUnavailable:true};}}
    try { const views = await partnerPurchaseSource(db, source.partnerCaseId); return { ...source,financialReady:await partnerFinancialReady(db,views), commercialRevision: views.row.headRevision, integrityUnavailable: false, items: views.partner.products.map(p => ({ id: p.productRowId, quantity: new Prisma.Decimal(p.quantity), retiredAt: null })) }; }
    catch { return { ...source,financialReady:false, integrityUnavailable: true }; }
  }));
  const sourceRequests=await db.purchasingDocument.findMany({where:{kind:'REQUEST',contractId:{in:contractIds},status:{not:'CANCELLED'}},orderBy:[{createdAt:'asc'},{id:'asc'}],select:{id:true,contractId:true,data:true}});
  const offerIds=[...new Set(requested.filter(d=>d.kind==='REQUEST').flatMap(d=>(d.data.inquirySelection||[]).map((s:any)=>s.inquiryId)))] as string[];
  const offerSources=await withOfferAvailability(db,(await db.purchasingDocument.findMany({where:{id:{in:offerIds},kind:'INQUIRY'}})).map(asDoc));
  const encode = (doc: Doc) => ({ ...redact(doc, a), number: label(doc), createdAt: doc.createdAt.toISOString(), updatedAt: doc.updatedAt.toISOString() });
  const requests = requested.filter(d => d.kind === 'REQUEST').map(doc => {
    const linked = allocations.filter(l => l.targetId === doc.id);
    const active = linked.filter(l => docs.find(d => d.id === l.sourceId)?.status !== 'VOID');
    const ordered = add(...active.map(l => l.quantity?.toFixed()));
    const delivered = add(...active.map(l=>{const order=docs.find(d=>d.id===l.sourceId);return order?acceptedDemandForRequest(order,docs,doc):'0';}));
    const source = sources.find(c => c.id === doc.contractId), item = source?.items.find(i => i.id === doc.data.itemId);
    const peerNeeds=sourceRequests.filter(r=>r.contractId===doc.contractId&&(r.data as any).itemId===doc.data.itemId),index=peerNeeds.findIndex(r=>r.id===doc.id);
    const earlierNeed=add(...peerNeeds.slice(0,Math.max(0,index)).map(r=>(r.data as any).quantity));
    const currentNeed = source?.integrityUnavailable ? doc.data.quantity : doc.status === 'CANCELLED' || source && (source.isInactive || terminalStatus(source.status) || !item || item.retiredAt) ? '0' : doc.data.quantity ? item ? min(doc.data.quantity,max('0',sub(item.quantity.toFixed(),earlierNeed))) : doc.data.quantity : null;
    const accepted = currentNeed ? min(delivered, currentNeed) : delivered;
    const quoteCommitments=active.flatMap(l=>(l.data as any).quoteBindings||[]);
    const quoteAvailability=(doc.data.inquirySelection||[]).map((split:any)=>{const offer=offerSources.find(s=>s.id===split.inquiryId)?.data.offers?.find((o:any)=>o.id===split.offerId);const own=max('0',sub(split.quantity,add(...quoteCommitments.filter((b:any)=>b.inquiryId===split.inquiryId&&b.offerId===split.offerId).map((b:any)=>b.quantity))));return {inquiryId:split.inquiryId,offerId:split.offerId,quantity:!offer||!offerValid(offer)||offer.price!==split.price?'0':offer.capacity==='limited'?min(own,offer.availableQuantity):own};});
    const purchaseOrdered=add(...active.map(l=>(l.data as any).purchaseQuantity||l.quantity?.toFixed()));
    const quoteChanged=Boolean(doc.data.inquirySelection&&gt(sub(doc.data.purchaseQuantity||doc.data.quantity||'0',purchaseOrdered),add(...quoteAvailability.map((b:any)=>b.quantity))));
    return { ...encode(doc),...(a.prices?{quoteCommitments,quoteAvailability}:{}),progress: { quoteChanged,purchaseOrdered,financialBlocked:Boolean(source&&!source.financialReady),ordered, accepted, toOrder: currentNeed ? max('0', sub(currentNeed, ordered)) : null, missing: currentNeed ? max('0', sub(currentNeed, accepted)) : null, stockSurplus: max('0', sub(delivered, accepted)), currentNeed, sourceChanged: Boolean(source && (source.integrityUnavailable || source.commercialRevision !== doc.data.sourceVersion)) }, source: source ? { number: source.contractNumber, customer: `${source.customer.firstName} ${source.customer.lastName}`.trim() || source.customer.companyName, revision: source.commercialRevision } : null };
  });
  const orders = a.all ? requested.filter(d => d.kind === 'ORDER').map(doc => ({ ...encode(doc), progress: {...orderProgress(doc, docs),financialBlocked:(doc.data.allocations||[]).some((allocation:any)=>{const source=sources.find(c=>c.id===allocation.contractId);return source&&!source.financialReady;})} })) : [];
  const receipts = a.all ? requested.filter(d => ['RECEIPT','WAREHOUSE_TRANSFER'].includes(d.kind)).map(doc => ({ ...encode(doc), order: docs.find(d => d.id === doc.parentId) ? { id: doc.parentId, number: label(docs.find(d => d.id === doc.parentId)!), supplier: docs.find(d => d.id === doc.parentId)!.data.supplierName } : null, progress: receiptProgress(doc, docs) })) : [];
  const exchanges = a.all ? requested.filter(d => d.kind === 'EXCHANGE').map(doc => ({ ...encode(doc), progress: exchangeProgress(doc, docs), toReturn: receiptProgress(docs.find(d => d.id === doc.parentId) || doc, docs).toReturn })) : [];
  const finance = a.prices ? requested.filter(d => ['ADVANCE','ACCOUNTING_HANDOFF'].includes(d.kind)).map(encode) : [];
  const openIds=finance.map(d=>d.data.openItemId).filter(Boolean) as string[];
  if(openIds.length) {
    const items=await db.accountingSupplierOpenItem.findMany({where:{id:{in:openIds}},include:{allocations:true}});
    for(const doc of finance){const item=items.find(i=>i.id===doc.data.openItemId);if(item){const paid=item.allocations.reduce((n,l)=>n+BigInt(l.amountRials.toFixed()),0n),remaining=BigInt(item.amountRials.toFixed())-paid;doc.data={...doc.data,remainingRials:remaining.toString(),paymentStatus:remaining===0n?'SETTLED':paid>0n?'PARTIALLY_SETTLED':'POSTED_UNSETTLED'};}}
  }
  const changes = requested.filter(d => d.kind === 'CHANGE').map(encode);
  return json({ access: a, inquiries: requested.filter(d => d.kind === 'INQUIRY_CASE' || d.kind === 'INQUIRY' && !d.parentId).map(d=>({...encode(d),displayTitle:d.kind==='INQUIRY_CASE'?inquiryCaseTitle(d,caseLines.filter(l=>l.parentId===d.id)):d.data.stone,progress:d.kind==='INQUIRY_CASE'?caseProgress(d):{}})), requests, orders, receipts, exchanges, finance, changes, total, limit: 500 });
}
const terminalStatus = (status: string) => ['CANCELLED', 'EXPIRED', 'VOID'].includes(status);
export async function purchasingDetail(actor: Actor, id: string, db: Database = prisma) {
  const a = await accessFor(db, actor), doc = await document(db, id); assertCapability(await canReadDocument(db, a, doc));
  const presented = doc.kind === 'INQUIRY' ? (await withOfferAvailability(db,[doc]))[0] : doc;
  const events = await db.purchasingEvent.findMany({ where: { documentId: id }, orderBy: { version: 'asc' }, select: { id: true, version: true, actorId: true, action: true, createdAt: true, data: true, ...(a.prices ? { entryHash: true, previousHash: true } : {}) } });
  const links = a.prices ? await db.purchasingExistingEvidence.findMany({ where: { documentId: id }, select: { sourceType: true, sourceId: true, createdAt: true } }) : [];
  const linkedRequests=doc.kind==='INQUIRY'?await db.purchasingDocument.findMany({where:{kind:'REQUEST',parentId:id},select:{id:true,version:true,status:true,data:true,targetLinks:{where:{purpose:'ALLOCATION',source:{status:{not:'VOID'}}},select:{id:true,quantity:true,data:true}}}}):[];
  const children = doc.kind === 'INQUIRY_CASE' ? (await db.purchasingDocument.findMany({where:{id:{in:doc.data.lineIds || []},kind:'INQUIRY'},orderBy:{createdAt:'asc'}})).map(asDoc) : [];
  const lines: unknown[] = [];
  for(const line of children) if(await canReadDocument(db,a,line)) lines.push({...redact(line,a),number:label(line)});
  const inventory=['RECEIPT','WAREHOUSE_TRANSFER'].includes(doc.kind)&&a.all?await purchaseCustodyProjection(db,doc.id):null;
  const attachments=await db.purchasingAttachment.findMany({where:{documentId:id,...(!a.prices?{visibility:'SPECIFICATION'}:{})},select:{id:true,originalName:true,mimeType:true,size:true,visibility:true,createdAt:true},orderBy:{createdAt:'asc'}});
  return json({ attachments, inventory, lines, linkedRequests:linkedRequests.map(r=>({id:r.id,version:r.version,status:r.status,quantity:(r.data as any).quantity,unit:(r.data as any).unit,purchaseQuantity:(r.data as any).inquirySelection?add(...(r.data as any).inquirySelection.map((s:any)=>s.quantity)):(r.data as any).quantity,remainingPurchaseQuantity:max('0',sub((r.data as any).purchaseQuantity||(r.data as any).quantity||'0',add(...r.targetLinks.map(l=>(l.data as any).purchaseQuantity||l.quantity?.toFixed())))),committed:r.targetLinks.length>0})), document: { ...redact(presented, a), number: label(doc),...(doc.kind==='INQUIRY_CASE'?{displayTitle:inquiryCaseTitle(doc,children)}:{}) }, events: events.map(event => { const evidence = event.data as any; const { data, ...meta } = event; return { ...meta, actor: evidence?.actor || null, ...(a.prices ? { data } : {}) }; }), links });
}

function inquiryCaseTitle(doc:Doc,lines:Doc[]) {
 const names=[...new Set(lines.map(l=>l.data.stone).filter(Boolean))];
 const stone=names[0]||doc.data.title||'اقلام انتخاب‌شده';
 const extra=names.length>1?` و ${names.length-1} کالای دیگر`:'';
 const origin=doc.contractId?`قرارداد ${doc.data.contractNumber||''}`:doc.data.reason==='stock'?'نیاز انبار':doc.data.reason==='prospect'?'نیاز مشتری':'استعلام مستقل';
 return `${stone}${extra} · ${origin}`;
}
