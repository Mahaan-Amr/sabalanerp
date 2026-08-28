import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';

/** Relational authorization fixture only. The pair passes the real deferred
 * schema constraints; it is never committed, issued, priced or used by runtime. */
export async function seedAuthorizationCase(tx: Prisma.TransactionClient, partner: string, customerOwner = partner) {
  const id = `authorization-case-${randomUUID()}`;
  const hash = `sha256-v1:${'a'.repeat(64)}`;
  const internalId = `${id}-internal`; const contractId = `${id}-customer`;
  await tx.partnerCommercialAccount.create({ data: { id, profileId: partner } });
  await tx.crmCustomer.create({ data: { id, firstName: 'Fixture', lastName: 'Case', ownerUserId: customerOwner } });
  await tx.department.create({ data: { id, name: id, namePersian: `دپارتمان آزمون ${id}` } });
  await tx.$executeRaw`INSERT INTO partner_sale_cases
    (id,"caseNumber","profileId","customerId","internalRecordId","customerContractId","headRevision","integrityHash")
    VALUES (${id},${id},${partner},${id},${internalId},${contractId},1,${hash})`;
  await tx.$executeRaw`INSERT INTO partner_case_revisions
    ("caseId",revision,"integrityHash","graphHash",graph,"partySnapshots","wholesaleEnvelope","retailEnvelope",
     "paymentEvidence","customerContent","internalProjection","customerProjection","actorId","commandId")
    VALUES (${id},1,${hash},${hash},'{}','{}','{}','{}','{}','{}','{}','{}',${partner},${id})`;
  await tx.$executeRaw`INSERT INTO sabalan_to_partner_sale_records
    (id,"recordNumber","caseId","commercialAccountId","expectedRevision","integrityHash")
    VALUES (${internalId},${internalId},${id},${id},1,${hash})`;
  await tx.$executeRaw`INSERT INTO sales_contracts
    (id,"contractNumber",title,"titlePersian",content,"customerId","departmentId","createdBy","responsibleSellerId",
     "partnerKind","partnerCaseId","partnerRevision","partnerIntegrityHash","updatedAt")
    VALUES (${contractId},${contractId},'Fixture','آزمون','Fixture',${id},${id},${partner},${partner},
      'PARTNER_CUSTOMER',${id},1,${hash},now())`;
  const rowId = `${id}-row`;
  await tx.partnerProductRow.create({ data: { id: rowId, caseId: id } });
  await tx.partnerCaseRowBinding.create({ data: { caseId: id, revision: 1, productRowId: rowId,
    configurationHash: hash, quantity: 2, unit: 'm', precisionPolicyVersion: 'measured-v1' } });
  await tx.$executeRaw`INSERT INTO partner_case_events
    (id,"caseId","caseRevision","integrityHash",sequence,"stateRevision",type,"toState","actorId","commandId","correlationId","effectiveDate",evidence)
    VALUES (${`${id}-event`},${id},1,${hash},1,1,'CASE_CREATED','DRAFT',${partner},${id},${id},CURRENT_DATE,'{}')`;
  await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
  await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`;
  return { id, rowId, internalId, contractId, customerId: id };
}
