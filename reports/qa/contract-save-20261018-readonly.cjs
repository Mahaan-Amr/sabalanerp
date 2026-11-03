// Stream into the existing production backend with `node`; no files or data are written there.
const { PrismaClient } = require('@prisma/client');
// Isolate the deployed function to avoid module startup effects/circular imports.
const source = require('node:fs').readFileSync('./dist/services/crossWorkspaceDutyAdapters/contractDispatchDutyAdapter.js', 'utf8');
const start = source.indexOf('const closeContractDispatchDuty =');
const end = source.indexOf('exports.closeContractDispatchDuty =', start);
if (start < 0 || end < start) throw new Error('DEPLOYED_FUNCTION_NOT_FOUND');
const closeContractDispatchDuty = require('node:vm').runInNewContext(
  source.slice(start, end) + '\ncloseContractDispatchDuty;', { json: value => JSON.parse(JSON.stringify(value)) });
const database = new PrismaClient();
const contractId = 'cmv7xbnsx039y9u81manhzg0u';
async function run() {
  await database.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const constraint = await tx.$queryRawUnsafe("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'hr_duties_response_check'");
    const contract = await tx.salesContract.findUniqueOrThrow({ where: { id: contractId }, select: {
      contractNumber: true, status: true, commercialRevision: true, updatedAt: true,
    } });
    const authorities = await tx.contractDispatchAuthority.findMany({ where: { contractId }, select: {
      id: true, kind: true, status: true, revision: true,
    } });
    const sessions = await tx.salesContractEditSession.findMany({ where: { contractId }, select: {
      baseRevision: true, updatedAt: true, recovery: true,
    } });
    console.log(JSON.stringify({ checkedAt: new Date().toISOString(), contract, constraint,
      authorities, recovery: sessions.map(s => ({ baseRevision: s.baseRevision, updatedAt: s.updatedAt,
        hasRecovery: s.recovery !== null, recoveryKeys: s.recovery && typeof s.recovery === 'object' ? Object.keys(s.recovery) : [] })) }));
    const duty = await tx.crossWorkspaceDuty.findUniqueOrThrow({ where: {
      stableKey: 'CONTRACT_DISPATCH:cmvcduetm02u635k8nni17gqk',
    } });
    console.log(JSON.stringify({ currentDuty: { status: duty.status, sourceVersion: duty.sourceVersion,
      respondedAt: duty.respondedAt, hasResponder: duty.respondedByUserId !== null } }));
    // Run the real deployed cancellation function; intercept its first mutation and
    // evaluate the intended row against the live constraint using SELECT only.
    let captured;
    const stop = new Error('READ_ONLY_UPDATE_INTERCEPTED');
    const facade = { crossWorkspaceDuty: {
      findUnique: args => tx.crossWorkspaceDuty.findUnique(args),
      update: async args => { captured = args.data; throw stop; },
    }, contractDispatchAuthority: { findUniqueOrThrow: args => tx.contractDispatchAuthority.findUniqueOrThrow(args) } };
    try { await closeContractDispatchDuty(facade, duty.sourceId, duty.createdByUserId, 'SUPERSEDED', 'نسخه قرارداد تغییر کرد.'); }
    catch (error) { if (error !== stop) throw error; }
    if (!captured) throw new Error('BUG_PATH_NOT_REACHED');
    const verdict = await tx.$queryRawUnsafe(`SELECT
      (($1 = 'COMPLETED' AND $2::boolean AND $3::boolean AND $4::boolean)
       OR ($1 <> 'COMPLETED' AND NOT $3::boolean AND NOT $4::boolean)) AS satisfies_constraint`,
      captured.status, captured.structuredResultJson != null, captured.respondedAt != null, captured.respondedByUserId != null);
    console.log(JSON.stringify({ verdict: verdict[0].satisfies_constraint ? 'PASS' : 'FAIL_REPRODUCED_RESPONSE_CONSTRAINT',
      attemptedStatus: captured.status, attemptedResponseTimestamp: captured.respondedAt != null,
      attemptedResponder: captured.respondedByUserId != null, persistentWrites: 0 }));
    if (!verdict[0].satisfies_constraint) process.exitCode = 1;
  }, { timeout: 15000 });
}
run().catch(error => { console.error(error.code || error.name); process.exitCode = 2; })
  .finally(() => database.$disconnect());
