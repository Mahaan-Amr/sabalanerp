const fs = require('node:fs');
const ts = require('../../backend/node_modules/typescript');
const source = ts.transpileModule(fs.readFileSync('backend/src/services/partnerSales/cases/technicalSavedGraph.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const script = `
const { PrismaClient } = require('@prisma/client');
const Module = require('node:module');
const modulePath = '/app/dist/services/partnerSales/cases/technicalSavedGraph.js';
const helper = new Module(modulePath, module);
helper.filename = modulePath;
helper.paths = Module._nodeModulePaths('/app/dist/services/partnerSales/cases');
helper._compile(${JSON.stringify(source)}, modulePath);
const { decodeTechnicalSavedSnapshot } = require('./dist/services/partnerSales/cases/technicalSavedRecords');
const { createPartnerTechnicalEvidenceResolver } = require('./dist/services/partnerSales/cases/technicalEvidence');
const { compilePartnerTechnicalGraph } = require('./dist/services/partnerSales/cases/technicalGraph');
const { canonicalHash } = require('@sabalanerp/partner-sales-contracts');
const database = new PrismaClient();
(async () => {
  await database.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const recoveryId = 'partner-recovery-60301eed-47d5-4530-a920-50fb8ae668e9';
    const session = await tx.salesContractEditSession.findUnique({ where: { draftId: recoveryId } });
    const snapshots = [];
    for (const record of session.recovery.validatedSnapshots) {
      const snapshot = await decodeTechnicalSavedSnapshot(record);
      if (!snapshot || snapshot.sessionId !== session.id) throw new Error('Protected evidence rejected');
      snapshots.push(snapshot);
    }
    const previous = snapshots.at(-1);
    const draft = session.recovery.draft;
    const evidence = await createPartnerTechnicalEvidenceResolver()(tx, { actorId: session.ownerUserId,
      recoveryId, draft, previous });
    if (!evidence.ok) throw new Error(evidence.error.code);
    const start = performance.now();
    const candidate = helper.exports.compileOrReuseTechnicalSavedGraph(draft, evidence.value.context, previous);
    const reuseMs = Math.round(performance.now() - start);
    const compiledStart = performance.now();
    const baseline = compilePartnerTechnicalGraph(draft, evidence.value.context);
    const baselineMs = Math.round(performance.now() - compiledStart);
    if (!candidate.ok || !baseline.ok) throw new Error('Compilation rejected');
    const equal = await canonicalHash(candidate.value.graph) === await canonicalHash(baseline.value.graph);
    console.log(JSON.stringify({ rows: draft.rows.length, snapshots: snapshots.length, reused: candidate.value.graph === previous.graph,
      reuseMs, baselineMs, identicalCanonicalGraph: equal,
      identicalMeasures: JSON.stringify(candidate.value.measures) === JSON.stringify(baseline.value.measures), readOnly: true }));
    if (!equal) throw new Error('Candidate differs from canonical compiler');
  }, { timeout: 20000 });
})().catch(error => { console.error(error.code || error.name); process.exitCode = 1; }).finally(() => database.$disconnect());
`;
fs.writeFileSync('reports/qa/partner-save-reuse-readonly-probe.cjs', script);
