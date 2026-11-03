// Run by streaming stdin to the existing production backend: read-only diagnosis.
// Never exposes session secrets. Every persistent write and row lock is disabled.
// Fresh lease time is simulated so an expired browser lease cannot mask timing.
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('node:crypto');
const { createPartnerTechnicalSaveService } = require('./dist/services/partnerSales/cases/technicalSave');
const { createPartnerTechnicalEvidenceResolver } = require('./dist/services/partnerSales/cases/technicalEvidence');
const { createPartnerTechnicalRecoveryAuthority } = require('./dist/services/partnerSales/authorization/technicalRecovery');
const database = new PrismaClient();
const recoveryId = 'partner-recovery-60301eed-47d5-4530-a920-50fb8ae668e9';

async function run() {
  const session = await database.salesContractEditSession.findUnique({ where: { draftId: recoveryId } });
  const command = { schemaVersion: 1, recoveryId, browserSessionId: session.browserSessionId,
    leaseToken: session.leaseToken, baseRevision: session.baseRevision,
    expectedRecoveryRevision: session.recovery.recoveryRevision,
    idempotencyKey: randomUUID(), draft: session.recovery.draft };
  for (const timeout of (process.env.PROBE_TIMEOUTS || '5000,15000').split(',').map(Number)) {
    const started = performance.now();
    const phases = [];
    const mark = phase => phases.push({ phase, ms: Math.round(performance.now() - started) });
    const evidence = createPartnerTechnicalEvidenceResolver();
    const authority = createPartnerTechnicalRecoveryAuthority({ actorId: session.ownerUserId, correlationId: randomUUID() });
    const service = createPartnerTechnicalSaveService({ actorId: session.ownerUserId,
      authorize: async (...args) => { mark('authorizeStart'); const result = await authority(...args); mark('authorizeEnd'); return result; },
      resolveEvidence: async (...args) => { mark('evidenceStart'); const result = await evidence(...args); mark('evidenceEnd'); return result; },
      transaction: work => database.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        const wrapper = new Proxy(tx, { get(target, key) {
          if (key === '$queryRaw') return async (strings, ...values) => {
            const stripped = strings.map(part => part.replace(/ FOR (UPDATE|SHARE)/g, ''));
            stripped.raw = stripped;
            return target.$queryRaw(stripped, ...values);
          };
          if (key === '$executeRaw') return async strings => {
            if (!strings.join('').includes('INSERT INTO effective_authorization_audit')) throw new Error('Unexpected write denied');
            mark('virtualAuthorizationAudit'); return 1;
          };
          if (key === 'salesContractEditSession') return new Proxy(target[key], { get(model, operation) {
            if (operation === 'updateMany') return async args => { mark('virtualSessionWrite'); const rows = await tx.$queryRawUnsafe('SELECT length($1::jsonb::text) AS replacement_bytes FROM sales_contract_edit_sessions WHERE id = $2 AND recovery = $3::jsonb', JSON.stringify(args.data.recovery), session.id, JSON.stringify(args.where.recovery.equals)); mark('virtualSessionWriteEnd'); return { count: rows.length }; };
            if (operation === 'findUnique') return async args => {
              const value = await model.findUnique(args);
              return value && 'updatedAt' in value ? { ...value, updatedAt: new Date() } : value;
            };
            return typeof model[operation] === 'function' ? model[operation].bind(model) : model[operation];
          } });
          if (key === 'partnerCommandOutcome') return new Proxy(target[key], { get(model, operation) {
            if (operation === 'create') return async () => { mark('virtualOutcomeWrite'); return {}; };
            return typeof model[operation] === 'function' ? model[operation].bind(model) : model[operation];
          } });
          return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
        } });
        return work(wrapper);
      }, { timeout }),
    });
    let result;
    try { const value = await service.save(command); result = { ok: value.ok, code: value.ok ? 'SUCCESS' : value.error.code }; }
    catch (error) { result = { ok: false, code: error.code || error.name, message: error.message?.replace(/\s+/g, ' ').slice(-450) }; }
    console.log(JSON.stringify({ timeout, elapsedMs: Math.round(performance.now() - started), phases, ...result }));
  }
}
run().catch(error => { console.error(error.code || error.name); process.exitCode = 1; })
  .finally(() => database.$disconnect());



