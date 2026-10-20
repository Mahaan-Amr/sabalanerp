import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import type {PrismaClient} from '@prisma/client';
import {qualifyInstalledCurrentDispatch,verifyRestoredInstalledCurrentDispatch,type DispatchPrerequisites} from './installed-current-dispatch-native.fixture';
import {qualifyInstalledSecurityAndUploads,verifyRestoredInstalledSecurityAndUploads} from './installed-security-uploads-native.fixture';

type Target={runtimeId:string;image:string;database:{name:string;oid:string;systemIdentifier:string};httpIngress:{bindHost:string;port:number};
 hiring:{liveRoot:string;store:string};accounting:{liveRoot:string;store:string};security:{liveRoot:string;store:string};uploads:{liveRoot:string;store:string}};
type Seed={adminId:string;sessionToken:string;customerId:string;writerCustomerId:string;dispatchPrerequisites:DispatchPrerequisites;command:{periodId:string;postingRuleId:string;counterAccountId:string;occurredAt:string;reason:string;reference:string;confirmed:boolean}};
const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
function readHead(store:string,key:string){
 assert.equal(path.resolve(store),store);const file=path.join(store,'heads',hash(key)+'.json');assert.equal(fs.realpathSync(file),file);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const st=fs.fstatSync(fd,{bigint:true});assert.ok(st.isFile()&&st.nlink===1n&&st.size<=16384n&&(st.mode&0o777n)===0o400n);const raw=fs.readFileSync(fd),after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});for(const item of ['dev','ino','size','mtimeNs','ctimeNs']as const){assert.equal(st[item],after[item]);assert.equal(st[item],named[item]);}const value=JSON.parse(raw.toString());assert.equal(value.key,key);return{sha256:hash(raw),value};}finally{fs.closeSync(fd);}
}
/** Fixed HTTP only business workflows; this fixture never imports a backend
 * application/service graph. Direct isolated SQL creates fixture prerequisites
 * and observes real committed results, never substitutes a business command. */
export async function runInstalledDomainWriterCases({db,origin,scope,seed,adminPassword}:{db:PrismaClient;origin:string;scope:Target;seed:Seed;adminPassword:string}){
 const url=new URL(origin);assert.equal(url.protocol,'http:');assert.equal(url.hostname,scope.httpIngress.bindHost);assert.equal(isIP(url.hostname),4);const octets=url.hostname.split('.').map(Number);assert.ok(octets[0]===10||octets[0]===172&&octets[1]>=16&&octets[1]<=31||octets[0]===192&&octets[1]===168);assert.equal(Number(url.port),scope.httpIngress.port);assert.equal(url.pathname,'/');assert.equal(url.username+url.password+url.search+url.hash,'');assert.match(scope.image,/^sha256:[a-f0-9]{64}$/);assert.match(scope.runtimeId,/^[a-f0-9]{64}$/);
 const [{name,oid,system}]=await db.$queryRaw<Array<{name:string;oid:string;system:string}>>`SELECT current_database()::text AS name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,(SELECT system_identifier::text FROM pg_control_system()) AS system`;
 assert.match(name,/^qa_application_(?:native|restored)_[a-f0-9]{32}$/);assert.deepEqual({name,oid,systemIdentifier:system},scope.database);
 const base=url.origin,headers={cookie:'sabalan_session='+seed.sessionToken,'content-type':'application/json'};
 async function json(route:string,method='GET',body?:unknown,expected=200){const response=await fetch(base+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error'});const value=await response.json()as any;assert.equal(response.status,expected,JSON.stringify(value));assert.equal(value.success,true);return value.data;}
 const own=await json('/api/auth/me');assert.equal(own.id,seed.adminId);
 assert.equal(seed.dispatchPrerequisites.format,'sabalan-dispatch-native-prerequisites/v1');
 assert.match(seed.writerCustomerId,/^customer:/);assert.notEqual(seed.writerCustomerId,seed.customerId);
 const accountRoute='/api/accounting/ledger/customer-accounts/'+encodeURIComponent(seed.writerCustomerId),before=await json(accountRoute);
 const key=randomUUID(),command={...seed.command,kind:'DEBIT',amountRials:'17',idempotencyKey:key};
 const posted=await json(accountRoute+'/operations','POST',command);assert.ok(posted.voucherId);
 const repeat=await json(accountRoute+'/operations','POST',command);assert.equal(repeat.voucherId,posted.voucherId);
 const after=await json(accountRoute);assert.equal(BigInt(after.netBalanceRials),BigInt(before.netBalanceRials)+17n);
 const voucher=await db.accountingLedgerVoucher.findUniqueOrThrow({where:{id:posted.voucherId},include:{lines:true}});assert.equal(voucher.status,'POSTED');assert.equal(voucher.idempotencyKey,key);assert.equal(voucher.sourceType,'CUSTOMER_ACCOUNT_OPERATION');assert.ok(voucher.lines.length>=2);assert.equal(await db.accountingLedgerVoucher.count({where:{idempotencyKey:key}}),1);
 const run=randomUUID(),person=await db.personnel.create({data:{firstName:'Private',lastName:'Installed Personnel '+run}});
 const user=await db.user.create({data:{username:'installed-erasure-'+run,email:run+'@isolated.invalid',password:'NO_LOGIN_QA',firstName:'Private',lastName:'Target',role:'USER',personnelId:person.id}});
 const session=await db.authSession.create({data:{userId:user.id,tokenHash:randomUUID(),idleExpiresAt:new Date(Date.now()+3600000),absoluteExpiresAt:new Date(Date.now()+7200000)}});
 const candidate=await db.hrCandidate.create({data:{firstName:'Private',lastName:'Installed Personnel '+run,mobile:'09120000000',linkedPersonnelId:person.id}});
 const application=await db.hrJobApplication.create({data:{candidateId:candidate.id,createdBy:seed.adminId,preIdentityReleasedAt:new Date()}});
 const bytes=Buffer.from('%PDF-1.4\nPRIVATE INSTALLED PERSONNEL ERASURE '+run+'\n');
 const form=new FormData();form.append('category','NATIONAL_ID_FRONT');form.append('inspectionSource','COPY_RECEIVED');form.append('file',new Blob([new Uint8Array(bytes)],{type:'application/pdf'}),'private-personnel.pdf');
 const uploaded=await fetch(base+'/api/hr-hiring/applications/'+application.id+'/documents',{method:'POST',headers:{cookie:headers.cookie},body:form,redirect:'error'});const uploadBody=await uploaded.json()as any;assert.equal(uploaded.status,201,JSON.stringify(uploadBody));
 const document=await db.hrHiringDocument.findFirstOrThrow({where:{applicationId:application.id}});assert.ok(document.storageName);const storageName=document.storageName!;
 assert.equal(path.basename(storageName),storageName);const put=readHead(scope.hiring.store,storageName);assert.equal(put.value.operation,'PUT');assert.equal(put.value.object.sha256,hash(bytes));
 const preview=await json('/api/hr/personnel/'+person.id+'/deletion-preview');
 const erased=await json('/api/hr/personnel/'+person.id+'/permanent-delete','POST',{adminPassword,fingerprint:preview.fingerprint,fullName:preview.displayName,reason:'Private actual installed Personnel erasure',confirmed:true},202);
 assert.equal(erased.status,'FILE_CLEANUP_PENDING');const deleted=readHead(scope.hiring.store,storageName);assert.equal(deleted.value.operation,'DELETE');
 assert.equal(fs.existsSync(path.join(scope.hiring.liveRoot,storageName)),false);
 assert.deepEqual(await Promise.all([db.personnel.count({where:{id:person.id}}),db.user.count({where:{id:user.id}}),db.authSession.count({where:{id:session.id}}),db.hrJobApplication.count({where:{id:application.id}})]),[0,0,0,0]);
 const receipt=await db.hrDeletionReceipt.findUniqueOrThrow({where:{id:erased.receiptId}});assert.equal(receipt.targetType,'PERSONNEL');assert.equal(receipt.targetId,person.id);assert.equal(receipt.actorUserId,seed.adminId);
 const cleanup=await db.hrDeletionFileCleanup.findFirstOrThrow({where:{receiptId:receipt.id,storageName}});assert.equal(cleanup.status,'VERSIONED_LIVE_REMOVED_RETAINED_COPIES_PENDING');assert.equal((cleanup.versionedFileState as any).originalVersionSha256,put.sha256);
 const dispatch=await qualifyInstalledCurrentDispatch({db,json,base,headers,prerequisites:seed.dispatchPrerequisites});
 const printed=await json('/api/accounting/contracts/'+seed.dispatchPrerequisites.contractId+'/pdf'),pdfUrl=new URL(printed.url);
 assert.equal(pdfUrl.origin,base);assert.equal(pdfUrl.search+pdfUrl.hash,'');assert.match(pdfUrl.pathname,/^\/files\/accounting-contracts\/[^/]+\.pdf$/);
 const pdfResponse=await fetch(pdfUrl,{headers:{cookie:headers.cookie},redirect:'error'});assert.equal(pdfResponse.status,200);const pdfBytes=Buffer.from(await pdfResponse.arrayBuffer());assert.equal(pdfBytes.subarray(0,5).toString(),'%PDF-');
 const pdfKey=decodeURIComponent(pdfUrl.pathname.split('/').at(-1)!);assert.equal(path.basename(pdfKey),pdfKey);const pdfHead=readHead(scope.accounting.store,pdfKey);assert.equal(pdfHead.value.operation,'PUT');assert.equal(pdfHead.value.object.sha256,hash(pdfBytes));assert.equal(hash(fs.readFileSync(path.join(scope.accounting.liveRoot,pdfKey))),hash(pdfBytes));
 const ancillary=await qualifyInstalledSecurityAndUploads({db,base,cookie:headers.cookie,actorId:seed.adminId,security:scope.security,uploads:scope.uploads,readHead});
 return{format:'sabalan-installed-domain-writers/v1',runtimeId:scope.runtimeId,image:scope.image,database:scope.database,
 financial:{customerId:seed.writerCustomerId,voucherId:voucher.id,idempotencyKey:key,amountRials:'17',balanceBefore:String(before.netBalanceRials),balanceAfter:String(after.netBalanceRials),explicitIdempotencyReplaySameVoucher:true},
 personnel:{personnelId:person.id,userId:user.id,sessionId:session.id,applicationId:application.id,receiptId:receipt.id,storageName,originalVersionSha256:put.sha256,deleteVersionSha256:deleted.sha256,originalSha256:hash(bytes),cleanupId:cleanup.id,retainedCopiesPhysicallyErased:false},
 dispatch,ancillary,accountingPdf:{key:pdfKey,sha256:hash(pdfBytes),bytes:pdfBytes.length,versionSha256:pdfHead.sha256},
 diagnosticServiceGraphImported:false,dispatchIssuanceExecuted:true,productionAdmission:false};
}

type InstalledBrowserProof={format:string;tickets:Array<{id:string;title:string;description:string}>};
export async function verifyRestoredInstalledDomainWriters({db,scope,qualification:q}:{db:PrismaClient;scope:Target;qualification:Awaited<ReturnType<typeof runInstalledDomainWriterCases>>&{installedBrowserProof?:InstalledBrowserProof;installedLegacyBrowserProof?:InstalledBrowserProof}}){
 const voucher=await db.accountingLedgerVoucher.findUniqueOrThrow({where:{id:q.financial.voucherId}});assert.equal(voucher.status,'POSTED');assert.equal(voucher.idempotencyKey,q.financial.idempotencyKey);
 assert.deepEqual(await Promise.all([db.personnel.count({where:{id:q.personnel.personnelId}}),db.user.count({where:{id:q.personnel.userId}}),db.authSession.count({where:{id:q.personnel.sessionId}}),db.hrJobApplication.count({where:{id:q.personnel.applicationId}})]),[0,0,0,0]);
 const cleanup=await db.hrDeletionFileCleanup.findUniqueOrThrow({where:{id:q.personnel.cleanupId}});assert.equal(cleanup.receiptId,q.personnel.receiptId);assert.equal(cleanup.status,'VERSIONED_LIVE_REMOVED_RETAINED_COPIES_PENDING');assert.equal((cleanup.versionedFileState as any).originalVersionSha256,q.personnel.originalVersionSha256);
 // Independent cut restore adopts restored live bytes into fresh stores. Its
 // new head is not relabeled as the source generation; deleted live bytes must
 // remain absent and the restored SQL retains the original deletion evidence.
 assert.equal(fs.existsSync(path.join(scope.hiring.liveRoot,q.personnel.storageName)),false);
 const pdf=readHead(scope.accounting.store,q.accountingPdf.key);assert.equal(pdf.value.operation,'PUT');assert.equal(pdf.value.object.sha256,q.accountingPdf.sha256);const bytes=fs.readFileSync(path.join(scope.accounting.liveRoot,q.accountingPdf.key));assert.equal(bytes.length,q.accountingPdf.bytes);assert.equal(hash(bytes),q.accountingPdf.sha256);
 const dispatch=await verifyRestoredInstalledCurrentDispatch(db,q.dispatch);
 const ancillary=await verifyRestoredInstalledSecurityAndUploads({db,security:scope.security,uploads:scope.uploads,qualification:q.ancillary});
 const installedBrowserTickets=q.installedBrowserProof?await verifyInstalledBrowserTickets(db,(await db.hrDeletionReceipt.findUniqueOrThrow({where:{id:q.personnel.receiptId}})).actorUserId,q.installedBrowserProof):undefined;
 const installedLegacyBrowserTickets=q.installedLegacyBrowserProof?await verifyInstalledLegacyBrowserTickets(db,(await db.hrDeletionReceipt.findUniqueOrThrow({where:{id:q.personnel.receiptId}})).actorUserId,q.installedLegacyBrowserProof):undefined;
 return{format:'sabalan-restored-installed-domain-writers/v1',financialVoucherRestored:true,personnelErasureRestored:true,accountingPdfExactBytesRestored:true,sourceVersionHistoryRestored:false,dispatch,ancillary,installedBrowserTickets,installedLegacyBrowserTickets,productionAdmission:false};
}

export async function verifyInstalledBrowserTickets(db:PrismaClient,reporterId:string,proof:InstalledBrowserProof){
 assert.equal(proof.format,'sabalan-installed-paired-browser/v1');return verifyOriginalTicketRows(db,reporterId,proof);
}
export async function verifyInstalledLegacyBrowserTickets(db:PrismaClient,reporterId:string,proof:InstalledBrowserProof){
 assert.equal(proof.format,'sabalan-installed-legacy-paired-browser/v1');return verifyOriginalTicketRows(db,reporterId,proof);
}
async function verifyOriginalTicketRows(db:PrismaClient,reporterId:string,proof:InstalledBrowserProof){
 assert.equal(proof.tickets.length,2);assert.equal(new Set(proof.tickets.map(row=>row.id)).size,2);
 const receipts=[];
 for(const expected of proof.tickets){
  const ticket=await db.supportTicket.findUniqueOrThrow({where:{id:expected.id},include:{entries:true,attachments:true,auditEvents:true}});
  assert.equal(ticket.reporterId,reporterId);assert.equal(ticket.title,expected.title);assert.equal(ticket.attachments.length,0);
  const reports=ticket.entries.filter(entry=>entry.kind==='REPORT');assert.equal(reports.length,1);assert.equal(reports[0].authorId,reporterId);assert.equal(reports[0].body,expected.description);
  const created=ticket.auditEvents.filter(event=>event.action==='CREATED');assert.equal(created.length,1);assert.equal(created[0].actorId,reporterId);assert.equal(await db.supportTicket.count({where:{reporterId,title:expected.title}}),1);
  receipts.push({ticketId:ticket.id,originalPersianText:true,reportEntries:1,creationAudits:1,duplicateTickets:0});
 }
 return receipts;
}
