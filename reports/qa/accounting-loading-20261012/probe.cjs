// Run inside the existing production backend container via stdin.
// Never prints identities, financial values, snapshots, or credentials.
// PostgreSQL rejects writes; this script calls only reads and pure projections.
const databaseUrl = new URL(process.env.DATABASE_URL);
databaseUrl.searchParams.set('options', '-c default_transaction_read_only=on');
process.env.DATABASE_URL = databaseUrl.toString();

const { prisma } = require('/app/dist/lib/prisma');
const { readPartnerRevisionProjections } = require('/app/dist/services/partnerSales/cases/lifecycle');
const { withCurrentSabalanPlan } = require('/app/dist/services/partnerSales/accounting/sabalanPlan');
const { preparePartnerFinancialSource, matchesFinancialPreparation } = require('/app/dist/services/partnerSales/accounting/source');
const { canonicalJson } = require('/app/node_modules/@sabalanerp/partner-sales-contracts');

async function probe() {
  const start = performance.now();
  const counts = { invoices: 0, healthy: 0, failed: 0, reasons: {}, differingFields: {} };
  const minimized = [];
  const invoices = await prisma.accountingFinancialRecord.findMany({
    where: { sourceKind: 'PARTNER_INTERNAL_RECORD' },
    select: { sourceId: true, sourceSnapshot: true, metadata: true, currency: true, amount: true, status: true },
  });
  counts.invoices = invoices.length;
  for (const invoice of invoices) {
    let reason;
    try {
      const historical = invoice.sourceSnapshot?.partnerPreparation;
      const owner = historical?.owner;
      const root = await prisma.partnerSaleCase.findUnique({
        where: { internalRecordId: invoice.sourceId },
        select: { id: true, profile: { select: { userId: true } } },
      });
      if (!owner || !root || owner.caseId !== root.id || invoice.metadata?.partnerCaseId !== root.id) {
        reason = 'OWNER';
      } else {
        const views = await readPartnerRevisionProjections(prisma, owner);
        if (!views?.accounting) reason = 'REVISION';
        else {
          const currentView = await withCurrentSabalanPlan(prisma, views.accounting);
          const source = view => ({ view: { ...view, state: 'COMMITTED' }, partnerSellerId: root.profile.userId });
          const prepared = await preparePartnerFinancialSource(source(currentView), owner);
          if (!prepared.ok) reason = `PREPARE_${prepared.error.code}`;
          else if (!matchesFinancialPreparation(prepared.value, historical)) {
            reason = 'PREPARATION_MISMATCH';
            for (const field of Object.keys(prepared.value)) {
              if (canonicalJson(prepared.value[field]) !== canonicalJson(historical[field])) {
                counts.differingFields[field] = (counts.differingFields[field] || 0) + 1;
              }
            }
            const rawPrepared = await preparePartnerFinancialSource(source(views.accounting), owner);
            const before = historical.paymentPlan;
            const after = prepared.value.paymentPlan;
            minimized.push({
              status: invoice.status,
              historicalPlanVersion: before.version,
              currentPlanVersion: after.version,
              historicalInstallmentCount: before.installments.length,
              currentInstallmentCount: after.installments.length,
              differingPlanFields: Object.keys({ ...before, ...after }).filter(field =>
                canonicalJson(before[field]) !== canonicalJson(after[field])),
              historicalRevisionMatches: rawPrepared.ok && matchesFinancialPreparation(rawPrepared.value, historical),
            });
          } else if (invoice.currency !== prepared.value.amount.currency) reason = 'CURRENCY';
          else if (!invoice.amount.eq(prepared.value.amount.amount)) reason = 'AMOUNT';
        }
      }
    } catch (error) {
      reason = `${error.name}_${error.code || 'UNKNOWN'}`;
    }
    if (reason) {
      counts.failed += 1;
      counts.reasons[reason] = (counts.reasons[reason] || 0) + 1;
    } else counts.healthy += 1;
  }
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    ms: Math.round(performance.now() - start),
    verdict: counts.failed ? 'FAIL_INTEGRITY' : 'PASS',
    counts,
    minimized,
  }));
  if (counts.failed) process.exitCode = 1;
}

probe().catch(error => {
  console.log(JSON.stringify({ verdict: 'FAIL_PROBE', error: error.name, code: error.code || 'UNKNOWN' }));
  process.exitCode = 2;
}).finally(() => prisma.$disconnect());
