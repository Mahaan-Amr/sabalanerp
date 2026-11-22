import {randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
/** Owned by the outer rollback harness; never creates a database or service. */
export async function purchasingLedgerFixture(tx:Prisma.TransactionClient,actorId:string) {
  const from=new Date('2026-01-01'),to=new Date('2027-12-31T23:59:59Z');
  const entity=await tx.accountingLegalEntity.create({data:{code:`purchase-qa-${randomUUID()}`,namePersian:'آزمایش تراکنشی خرید',activeFrom:from,createdBy:actorId}});
  const book=await tx.accountingBook.create({data:{legalEntityId:entity.id,code:'QA',namePersian:'دفتر آزمایش خرید',createdBy:actorId}});
  const scheme=await tx.accountingCodeScheme.create({data:{bookId:book.id,version:1,effectiveFrom:from,groupLength:1,kolLength:2,moinLength:3,createdBy:actorId}});
  const year=await tx.accountingFiscalYear.create({data:{bookId:book.id,code:'QA',titlePersian:'سال آزمایش',startsAt:from,endsAt:to,status:'ACTIVE',createdBy:actorId}});
  const period=await tx.accountingPostingPeriod.create({data:{fiscalYearId:year.id,code:'QA',titlePersian:'دوره آزمایش',sequence:1,startsAt:from,endsAt:to,status:'OPEN'}});
  for(const kind of ['ASSET','LIABILITY'] as const) {
    const root=kind==='ASSET'?'1':'2',side=kind==='ASSET'?'DEBIT':'CREDIT';let parentId:string|undefined;
    for(const [index,level] of (['GROUP','KOL','MOIN'] as const).entries()) {
      const account=await tx.accountingLedgerAccount.create({data:{bookId:book.id,codeSchemeId:scheme.id,code:index===0?root:index===1?`${root}01`:`${root}01001`,titlePersian:`حساب آزمایش ${level}`,level,normalSide:side,statementRole:kind,parentId,effectiveFrom:from,createdBy:actorId,partyRequirement:level==='MOIN'&&kind==='LIABILITY'?'REQUIRED':'FORBIDDEN'}});
      parentId=account.id;
      if(level==='MOIN')await tx.accountingSupplyChainPostingRule.create({data:{bookId:book.id,accountRole:kind==='ASSET'?'INVENTORY':'SUPPLIER_PAYABLE',accountId:account.id,version:1,effectiveFrom:from,createdBy:actorId}});
    }
  }
  const party=await tx.accountingParty.create({data:{legalEntityId:entity.id,sourceKind:'PURCHASE_QA',sourceId:randomUUID(),displayName:'تأمین‌کننده آزمایش حسابداری',activeFrom:from}});
  await tx.workspacePermission.upsert({where:{userId_workspace:{userId:actorId,workspace:'accounting'}},update:{permissionLevel:'admin',isActive:true,expiresAt:null},create:{userId:actorId,workspace:'accounting',permissionLevel:'admin',isActive:true,grantedBy:actorId}});
  return {bookId:book.id,periodId:period.id,partyId:party.id};
}
