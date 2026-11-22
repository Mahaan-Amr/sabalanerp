import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {readPartnerSalesContractDetail} from '../partnerSales/cases/contractDetail';

// Regression against the reported local case. Every test-created row and audit
// is rolled back. Existing contract, grants and profile data are never edited.
test('100347 admits internal admin and owning Partner, denies unrelated readers and stale evidence', async () => {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL || '');
  assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55432'); assert.equal(url.pathname, '/sabalanerp');
  url.searchParams.set('connection_limit','2'); url.searchParams.set('pool_timeout','10');
  const db = new PrismaClient({datasources:{db:{url:url.toString()}}});
  const rollback = new Error('local-detail-test-rollback');
  try {
    await assert.rejects(db.$transaction(async tx => {
      const contract = await tx.salesContract.findUniqueOrThrow({where:{contractNumber:'100347'}});
      const admin = await tx.user.findUniqueOrThrow({where:{username:'admin'}});
      assert.equal(admin.role,'ADMIN'); assert.equal(await tx.partnerProfile.count({where:{userId:admin.id}}),0);
      const profile = await tx.partnerSaleCase.findUniqueOrThrow({where:{id:contract.partnerCaseId!},select:{profile:{select:{userId:true}}}});
      const database = {$transaction: async (work: (client: typeof tx) => unknown) => work(tx)} as unknown as PrismaClient;
      const correlationId = randomUUID();
      const read = (actorId: string, source = contract) => readPartnerSalesContractDetail(database,{actorId,contract:source,correlationId});
      const internal = await read(admin.id); assert.equal(internal?.ok,true,JSON.stringify(internal));
      const evidence = await tx.$queryRaw<Array<{purpose:string;allowed:boolean;isAdmin:boolean}>>`SELECT purpose,allowed,"isAdmin" FROM effective_authorization_audit WHERE "correlationId"=${correlationId} AND action='CASE_READ'`;
      assert.deepEqual(evidence,[{purpose:'MANAGEMENT',allowed:true,isAdmin:true}]);
      assert.equal((await read(profile.profile.userId))?.ok,true,'owning Partner retains private access');
      const id = randomUUID();
      await tx.user.create({data:{id,username:`qa-detail-${id}`,email:`${id}@example.invalid`,password:'unused',role:'USER',firstName:'آزمون',lastName:'مجوز'}});
      assert.equal((await read(id))?.ok,false,'unprivileged internal reader remains denied');
      await tx.partnerProfile.create({data:{userId:id,state:'ACTIVE'}});
      const foreign = await read(id); assert.equal(foreign?.ok,false); if(foreign?.ok===false)assert.equal(foreign.error.status,404,'foreign Partner existence stays hidden');
      await tx.user.update({where:{id},data:{role:'ADMIN'}});
      assert.equal((await read(id))?.ok,false,'Partner persona cannot inherit internal admin authority');
      assert.equal(await read(admin.id,{...contract,partnerIntegrityHash:'mismatched'}),null,'mismatched current evidence fails closed');
      throw rollback;
    },{timeout:45000,maxWait:5000}),error=>error===rollback);
  } finally {await db.$disconnect();}
});
