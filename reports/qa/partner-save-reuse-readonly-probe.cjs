
const { PrismaClient } = require('@prisma/client');
const Module = require('node:module');
const modulePath = '/app/dist/services/partnerSales/cases/technicalSavedGraph.js';
const helper = new Module(modulePath, module);
helper.filename = modulePath;
helper.paths = Module._nodeModulePaths('/app/dist/services/partnerSales/cases');
helper._compile("\"use strict\";\nObject.defineProperty(exports, \"__esModule\", { value: true });\nexports.compileOrReuseTechnicalSavedGraph = compileOrReuseTechnicalSavedGraph;\nconst partner_sales_contracts_1 = require(\"@sabalanerp/partner-sales-contracts\");\nconst technicalGraph_1 = require(\"./technicalGraph\");\nconst technicalGraphMeasures_1 = require(\"./technicalGraphMeasures\");\nconst canonical = (value) => (0, partner_sales_contracts_1.canonicalJson)(JSON.parse(JSON.stringify(value)));\nconst content = ({ inputRevision: _correlation, ...draft }) => canonical(draft);\n/** Called only with owner-decoded, integrity-validated history and freshly\n * resolved evidence. Reuse immutable calculation output, never authorization,\n * inquiry validation, pending edits or a changed commercial intent. */\nfunction compileOrReuseTechnicalSavedGraph(draft, context, previous) {\n    if (previous && !draft.editingValues?.length && !previous.draft.editingValues?.length &&\n        !draft.rows.some(row => row.family === 'volumetric') &&\n        previous.graph.rows.every(row => row.commercial.calculationSnapshot?.partnerPricingBasis === 'ordinary-sale-v1') &&\n        content(draft) === content(previous.draft) && canonical(context) === canonical(previous.context)) {\n        return { ok: true, value: { graph: previous.graph, measures: (0, technicalGraphMeasures_1.technicalGraphMeasures)(previous.graph) } };\n    }\n    return (0, technicalGraph_1.compilePartnerTechnicalGraph)(draft, context);\n}\n", modulePath);
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
