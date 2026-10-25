/** Synthetic additions to the actual private NORMAL B, using canonical domain
 * services. Existing customer-fixture naming/admission is unchanged. */
import assert from 'node:assert/strict';import{randomBytes,randomUUID,createHash}from'node:crypto';import type{PrismaClient}from'@prisma/client';
import{assertRestoredQaPrivateNormal,type RestoredQaPrivateNormal}from'./restoredQaMigrationBaseline';
import{assertRestoredQaWorkingMaterial,type RestoredQaWorkingMaterial}from'./restoredQaWorkingMaterial';
type Owner=Readonly<{deploymentId:string;releaseId:string}>;
export type RestoredQaFinancialScope=Readonly<{material:RestoredQaWorkingMaterial;normal:RestoredQaPrivateNormal;owner:Owner}>;
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
function need(v:unknown):asserts v{assert.ok(v,'RESTORED_QA_FINANCIAL_FIXTURE_UNPROVEN');}
export function unusedRestoredQaAccountGroups(length:number,used:ReadonlySet<string>){need(Number.isInteger(length)&&length>=1&&length<=8);const groups:string[]=[];
 for(let n=10n**BigInt(length)-1n,attempts=0;n>=1n&&groups.length<9&&attempts<used.size+9;n--,attempts++){const code=n.toString().padStart(length,'0');if(!used.has(code))groups.push(code);}need(groups.length===9);return groups;}
export function assertOriginalBusinessRowMultisets(before:readonly {table:string;rows:readonly {hash:string;count:string}[]}[],after:readonly {table:string;rows:readonly {hash:string;count:string}[]}[]){
 need(before.length>0&&before.length===after.length);for(let i=0;i<before.length;i++){const b=before[i],a=after[i];need(b.table===a.table&&/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(b.table));const map=new Map<string,bigint>();for(const r of a.rows){need(/^[a-f0-9]{64}$/.test(r.hash)&&/^[1-9][0-9]*$/.test(r.count)&&!map.has(r.hash));map.set(r.hash,BigInt(r.count));}for(const r of b.rows)need(/^[a-f0-9]{64}$/.test(r.hash)&&/^[1-9][0-9]*$/.test(r.count)&&(map.get(r.hash)??0n)>=BigInt(r.count));}
 return Object.freeze({originalTables:before.length,originalRowMultisetSha256:sha(JSON.stringify(before)),originalRowsPreserved:true as const});
}
type Sequence=Readonly<{id:string;bookId:string;fiscalYearId:string;nextNumber:number;updatedAt:Date|string}>;
export function assertRestoredQaVoucherSequence(before:Sequence|null,after:Sequence,numbers:readonly number[]){
 need(after&&numbers.length===3&&new Set(numbers).size===3&&numbers.every(Number.isSafeInteger));const first=before?.nextNumber??1;
 need(Number.isSafeInteger(first)&&first>=1&&after.nextNumber===first+numbers.length&&JSON.stringify([...numbers].sort((a,b)=>a-b))===JSON.stringify(numbers.map((_,i)=>first+i)));
 if(before){need(before.id===after.id&&before.bookId===after.bookId&&before.fiscalYearId===after.fiscalYearId&&Date.parse(String(after.updatedAt))>=Date.parse(String(before.updatedAt)));const{nextNumber:_beforeNext,updatedAt:_beforeUpdated,...b}=before,{nextNumber:_afterNext,updatedAt:_afterUpdated,...a}=after;assert.deepEqual(a,b);}
 return Object.freeze({originalSequenceId:before?.id??null,currentSequenceId:after.id,originalNextNumber:first,currentNextNumber:after.nextNumber,canonicalPostedVouchers:3,conserved:true as const});
}
const identifier=(v:string)=>{need(/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(v));return'"'+v+'"';};
async function identity(db:PrismaClient,scope:RestoredQaFinancialScope){const v=assertRestoredQaWorkingMaterial(scope.material,scope.owner);assertRestoredQaPrivateNormal(scope.normal,scope.material,scope.owner);
 const [row]=await db.$queryRaw<Array<{name:string;oid:string;systemIdentifier:string}>>`SELECT current_database()::text AS name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,(SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier"`;assert.deepEqual(row,v.database);return v;}
async function originalRows(db:PrismaClient,sequenceId:string|null){
 const tables=await db.$queryRaw<Array<{table:string}>>`SELECT table_name AS "table" FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name ~ '^((contract|accounting|partner|crm)_|contracts$|customers$)' ORDER BY table_name COLLATE "C"`;
 need(tables.length>0&&tables.length<=1024);const result:Array<{table:string;rows:Array<{hash:string;count:string}>}>=[];
 for(const{table}of tables){const rows=await db.$queryRawUnsafe<Array<{hash:string;count:string}>>(`SELECT hash,count(*)::text AS count FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS hash FROM public.${identifier(table)} t ${table==='accounting_voucher_sequences'&&sequenceId?'WHERE id<>$1':''}) hashes GROUP BY hash ORDER BY hash COLLATE "C"`,...(table==='accounting_voucher_sequences'&&sequenceId?[sequenceId]:[]));need(rows.length<=500000);result.push({table,rows});}
 return result;
}
export async function withRestoredQaFinancialFixture<T>(db:PrismaClient,scope:RestoredQaFinancialScope,work:(fixture:Readonly<{customerId:string;sessionToken:string;adminId:string;bookId:string;yearId:string;command:Readonly<{periodId:string;postingRuleId:string;counterAccountId:string;occurredAt:string;reason:string;reference:string;confirmed:true}>;initialBalance:string;seedVoucherId:string}>)=>Promise<T>){
 await identity(db,scope);const at=new Date();
 const entities=await db.accountingLegalEntity.findMany({include:{books:{where:{isPrimary:true},include:{
  codeSchemes:{where:{retiredAt:null,effectiveFrom:{lte:at}},orderBy:{version:'desc'},take:1},
  fiscalYears:{where:{startsAt:{lte:at},endsAt:{gte:at}},include:{periods:{where:{status:'OPEN',startsAt:{lte:at},endsAt:{gte:at}},orderBy:{sequence:'asc'}}}}
 }}}});
 const entity=entities[0],book=entity?.books[0],scheme=book?.codeSchemes[0],year=book?.fiscalYears[0];need(entities.length===1&&entity.baseCurrency==='IRR'&&entity.books.length===1&&book.baseCurrency==='IRR'&&book.codeSchemes.length===1&&book.fiscalYears.length===1&&year.periods.length===1&&entity.activeFrom<=at&&(!entity.activeTo||entity.activeTo>=at));
 const groups=unusedRestoredQaAccountGroups(scheme.groupLength,new Set((await db.accountingLedgerAccount.findMany({where:{bookId:book.id,level:'GROUP'},select:{code:true}})).map(r=>r.code)));
 const sequenceBefore=await db.accountingVoucherSequence.findUnique({where:{bookId_fiscalYearId:{bookId:book.id,fiscalYearId:year.id}}}),originalVoucherIds=(await db.accountingLedgerVoucher.findMany({select:{id:true}})).map(r=>r.id);
 const before=await originalRows(db,sequenceBefore?.id??null),nonce=randomUUID(),admin=await db.user.create({data:{username:'qa-restored-financial-'+nonce,email:nonce+'@isolated.invalid',password:'NO_PASSWORD_LOGIN_'+randomBytes(32).toString('hex'),firstName:'Private',lastName:'Restored Financial',role:'ADMIN'}});
 await db.workspacePermission.create({data:{userId:admin.id,workspace:'accounting',permissionLevel:'admin',grantedBy:admin.id}});
 const{createAuthoritativeSession}=await import('./identitySessionService'),session=await createAuthoritativeSession(db,admin.id,{ipAddress:'127.0.0.1',userAgent:'Source-owned restored QA financial qualification'});
 const{createAccountingLedgerAdministration}=await import('./accountingLedgerAdministration'),administration=createAccountingLedgerAdministration(db),actor={id:admin.id,profile:'ACCOUNTING_MANAGER' as const};
 const suffix=(value:number)=>'1'.padStart(value,'0');need([scheme.kolLength,scheme.moinLength].every(v=>Number.isInteger(v)&&v>=1&&v<=8));
 async function account(code:string,titlePersian:string,normalSide:'DEBIT'|'CREDIT',statementRole:'ASSET'|'LIABILITY'|'REVENUE'|'EXPENSE',party=false,financial=false){const common={bookId:book.id,codeSchemeId:scheme.id,normalSide,statementRole,currencyBehavior:'BASE_ONLY' as const,effectiveFrom:at,actorId:admin.id};const group=await administration.createAccount({...common,code,titlePersian,level:'GROUP'}),kol=await administration.createAccount({...common,code:code+suffix(scheme.kolLength),titlePersian,parentId:group.id,level:'KOL'});return administration.createAccount({...common,code:code+suffix(scheme.kolLength)+suffix(scheme.moinLength),titlePersian,parentId:kol.id,level:'MOIN',partyRequirement:party?'REQUIRED':'FORBIDDEN',financialAccountRequirement:financial?'REQUIRED':'FORBIDDEN'});}
 const[receivable,advance,bank,counter,tax,inventory,cost]=await Promise.all([account(groups[0],'دریافتنی آزمون','DEBIT','ASSET',true),account(groups[1],'پیش‌دریافت آزمون','CREDIT','LIABILITY',true),account(groups[2],'بانک آزمون','DEBIT','ASSET',false,true),account(groups[3],'حساب مقابل آزمون','CREDIT','REVENUE'),account(groups[4],'مالیات آزمون','CREDIT','LIABILITY',true),account(groups[5],'موجودی آزمون','DEBIT','ASSET'),account(groups[6],'هزینه آزمون','DEBIT','EXPENSE')]);void bank;
 const{createCustomerPostingRulePrisma}=await import('./accountingCustomerTreasuryPrisma'),rule=await createCustomerPostingRulePrisma(db,{legalEntityId:entity.id,code:'qa-restored-'+nonce,version:1,receivableAccountId:receivable.id,customerAdvanceAccountId:advance.id,bankClearingAccountId:bank.id,revenueAccountId:counter.id,outputTaxAccountId:tax.id,inventoryAccountId:inventory.id,costAccountId:cost.id,effectiveFrom:at,actor});
 const customerId='customer:'+(await db.crmCustomer.create({data:{firstName:'آزمون مستقل',lastName:nonce}})).id,command=Object.freeze({periodId:year.periods[0].id,postingRuleId:rule.id,counterAccountId:counter.id,occurredAt:at.toISOString(),reason:'اثبات مالی بازیابی با مسیر اصلی',reference:'restored-qa-'+nonce,confirmed:true as const});
 const{recordCustomerAccountOperation}=await import('./accountingCustomerWorkspace'),initialBalance='9007199254740993',seed=await recordCustomerAccountOperation(db,customerId,{...command,occurredAt:at,kind:'DEBIT',amountRials:BigInt(initialBalance),idempotencyKey:randomUUID(),actor});need(typeof seed.voucherId==='string');
 const value=await work(Object.freeze({customerId,sessionToken:session.token,adminId:admin.id,bookId:book.id,yearId:year.id,command,initialBalance,seedVoucherId:seed.voucherId}));
 await identity(db,scope);const after=await originalRows(db,sequenceBefore?.id??null);assertOriginalBusinessRowMultisets(before,after);
 const vouchers=await db.accountingLedgerVoucher.findMany({where:{id:{notIn:originalVoucherIds}},include:{lines:true}});need(vouchers.length===3&&vouchers.some(v=>v.id===seed.voucherId)&&vouchers.every(v=>v.bookId===book.id&&v.fiscalYearId===year.id&&v.status==='POSTED'&&Number.isSafeInteger(v.statutoryNumber)));
 const{Prisma}=await import('@prisma/client');for(const voucher of vouchers){need(voucher.lines.length===2);const debit=voucher.lines.reduce((sum,line)=>sum.plus(line.debitRials),new Prisma.Decimal(0)),credit=voucher.lines.reduce((sum,line)=>sum.plus(line.creditRials),new Prisma.Decimal(0));need(debit.equals(credit)&&debit.isInteger()&&debit.toFixed(0)===(voucher.id===seed.voucherId?initialBalance:'2'));}
 const sequenceAfter=await db.accountingVoucherSequence.findUniqueOrThrow({where:{bookId_fiscalYearId:{bookId:book.id,fiscalYearId:year.id}}}),sequence=assertRestoredQaVoucherSequence(sequenceBefore,sequenceAfter,vouchers.map(v=>v.statutoryNumber!));
 return Object.freeze({value,originalBusinessRows:Object.freeze({tables:before.length,sha256:sha(JSON.stringify(before)),preserved:true as const}),sequence,
  vouchers:Object.freeze(vouchers.map(v=>Object.freeze({id:v.id,statutoryNumber:v.statutoryNumber!,contentHash:v.contentHash}))),decimalBalanced:true as const});
}
