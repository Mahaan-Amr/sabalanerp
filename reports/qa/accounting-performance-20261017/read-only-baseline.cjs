// Standalone diagnostic; stream into the verified existing production backend.
// No identities, amounts, query parameters or credentials are printed.
const url = new URL(process.env.DATABASE_URL);
url.searchParams.set('options', '-c default_transaction_read_only=on -c statement_timeout=15000');
url.searchParams.set('connection_limit', '2');
process.env.DATABASE_URL = url.toString();
const { prisma } = require('/app/dist/lib/prisma');
const fs = require('node:fs');
const originalInfo = console.info;
console.info = () => {};
const service = require('/app/dist/services/accountingService');
console.info = originalInfo;
let stats = {};
if (prisma.$use) prisma.$use(async (params, next) => {
  const started = performance.now();
  try { return await next(params); }
  finally {
    const key = `${params.model || 'raw'}.${params.action}`;
    const row = stats[key] ||= { count: 0, ms: 0 };
    row.count++; row.ms += performance.now() - started;
  }
});
async function measure(label, read) {
  stats = {};
  const start = performance.now();
  try {
    const result = await read();
    console.log(JSON.stringify({ label, ms: Math.round(performance.now() - start),
      total: result?.total, rows: result?.items?.length,
      trendError: result?.trendError,
      slowest: Object.entries(stats).map(([key, value]) => ({ key, count: value.count, ms: Math.round(value.ms) }))
        .sort((a,b) => b.ms-a.ms).slice(0, 8) }));
  } catch (e) {
    console.log(JSON.stringify({ label, ms: Math.round(performance.now()-start), error: e.name, code: e.code || null }));
  }
}
(async () => {
  const scopeText = fs.readFileSync('/app/dist/services/partnerSales/authorization/readSnapshot.js', 'utf8');
  const serviceText = fs.readFileSync('/app/dist/services/accountingService.js', 'utf8');
  console.log(JSON.stringify({ time: new Date().toISOString(), commit: process.env.APP_COMMIT,
    multiRootExclusiveLock: scopeText.includes('await (0, technicalRollout_1.lockPartnerOperationsControl)(tx)'),
    hasHistoricalPlanResolver: fs.existsSync('/app/dist/services/partnerSales/accounting/sabalanPlanEvidence.js'),
    dashboardHasPartnerMerge: serviceText.includes('mergePartnerWorkspaceContracts'),
    note: 'No-actor service diagnostic, excludes authenticated Partner read work; not browser or API latency.' }));
  for (let i=0;i<2;i++) {
    await measure('ordinary-list-50', () => service.listAccountingContracts({page:1,pageSize:50}));
    await measure('ordinary-list-no-match', () => service.listAccountingContracts({page:1,pageSize:50,search:'__diagnostic_no_match_20261017__'}));
    await measure('dashboard-no-actor', () => service.getAccountingDashboard({}, '6m'));
  }
})().catch(e => { console.log(JSON.stringify({error:e.name,code:e.code||null}));process.exitCode=1; })
  .finally(() => prisma.$disconnect());
