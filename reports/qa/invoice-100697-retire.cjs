// Standalone, narrowly authorized operational repair. No runtime-code edits.
// The caller supplies cleanupMode (REHEARSE/COMMIT) and verifiedBackup metadata.
const crypto = require('node:crypto');
const prismaModule = require('/app/dist/lib/prisma');
const database = prismaModule.prisma;
const { lockPartnerOperationsControl } = require('/app/dist/services/partnerSales/authorization/technicalRollout');
const { cancelOpenCrossWorkspaceDuty } = require('/app/dist/services/crossWorkspaceDutyCancellation');
const { reconcileSalesContractCorrectionDuties } = require('/app/dist/services/salesContractCorrectionDuty');
const { readPartnerRevisionProjections } = require('/app/dist/services/partnerSales/cases/lifecycle');
const { withCurrentSabalanPlan } = require('/app/dist/services/partnerSales/accounting/sabalanPlan');
const { preparePartnerFinancialSource, matchesFinancialPreparation } = require('/app/dist/services/partnerSales/accounting/source');
const invoiceId = 'partner-accounting:b26455ba64343c6e4230ec2766e86b12b07eef7fc2235252847dfc8b1c5ceb29';
const contractId = '2f0aad2e-fbf5-4ac0-899e-9ae5b715c00e';
const caseId = 'partner-recovery-9145995c-806e-41cc-a695-2f6842274f47';
const requestId = 'cmv57i8e901idtfi86vpb2s4t';
const dutyId = 'cmv57kjts01kwtfi82nrydyw7';
const note = 'به درخواست صریح مالک سامانه: حذف فقط پیش‌نویس صادرنشده مرتبط با قرارداد ۱۰۰۶۹۷ برای رفع خطای خواندن حسابداری، پس از پشتیبان رمزگذاری‌شده و تأییدشده؛ لغو مجوز اصلاح وابسته با اجازه جداگانه و حفظ کامل تاریخچه. اجرا از SSH در نشست بررسی‌شده admin؛ بدون استقرار، بازنویسی شواهد یا غیرفعال‌سازی محافظ‌ها.';
const json = x => JSON.parse(JSON.stringify(x));
const hash = x => crypto.createHash('sha256').update(JSON.stringify(json(x))).digest('hex');
const quote = x => '"' + x.replaceAll('"', '""') + '"';
async function fingerprints(tx) {
  const tables = await tx.$queryRawUnsafe(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='caseId' ORDER BY table_name`);
  const result = {};
  for (const { table_name } of tables) {
    const [row] = await tx.$queryRawUnsafe('SELECT count(*)::int AS count, md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,\'[]\')) AS hash FROM ' + quote(table_name) + ' t WHERE "caseId"=$1', caseId);
    result[table_name] = row;
  }
  result.contract = hash(await tx.salesContract.findUniqueOrThrow({ where: { id: contractId } }));
  result.internal = hash(await tx.sabalanToPartnerSaleRecord.findUniqueOrThrow({ where: { caseId } }));
  result.root = hash(await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: caseId } }));
  result.editSessions = hash(await tx.salesContractEditSession.findMany({ where: { contractId }, orderBy: { id: 'asc' } }));
  return result;
}
async function noDependencies(tx) {
  const refs = await tx.$queryRawUnsafe(`SELECT c.relname AS table_name,a.attname AS column_name,cardinality(con.conkey) AS columns FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=con.conkey[1] WHERE con.contype='f' AND con.confrelid='accounting_financial_records'::regclass`);
  for (const r of refs) {
    if (r.columns !== 1) throw Error('UNREVIEWED_COMPOSITE_FOREIGN_KEY');
    const [count] = await tx.$queryRawUnsafe('SELECT count(*)::int AS count FROM ' + quote(r.table_name) + ' WHERE ' + quote(r.column_name) + '=$1', invoiceId);
    if (count.count) throw Error('FINANCIAL_DEPENDENCY:' + r.table_name);
  }
  const columns = await tx.$queryRawUnsafe(`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND data_type IN ('text','character varying') AND column_name IN ('recordId','invoiceId','invoiceRecordId','financialRecordId','sourceFinancialRecordId','sourceRecordId','retainedRecordId','entityId','sourceId')`);
  for (const r of columns) {
    if (['accounting_audit_logs', 'accounting_correction_requests'].includes(r.table_name)) continue;
    const [count] = await tx.$queryRawUnsafe('SELECT count(*)::int AS count FROM ' + quote(r.table_name) + ' WHERE ' + quote(r.column_name) + '=$1', invoiceId);
    if (count.count) throw Error('OTHER_REFERENCE:' + r.table_name);
  }
  const corrections = await tx.accountingCorrectionRequest.findMany({ where: { recordId: invoiceId } });
  if (corrections.length !== 1 || corrections[0].id !== requestId) throw Error('CORRECTION_POPULATION_CHANGED');
}
let result;
(async () => {
  if (!['REHEARSE','COMMIT'].includes(cleanupMode) || !verifiedBackup.decryptVerified || !verifiedBackup.restoreListVerified || !verifiedBackup.serverCopyReadbackVerified) throw Error('VERIFIED_BACKUP_REQUIRED');
  try {
    await database.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");
      await tx.$executeRawUnsafe("SET LOCAL statement_timeout='25s'");
      await lockPartnerOperationsControl(tx);
      if (await tx.deploymentOperation.count({ where: { activeKey: { not: null } } })) throw Error('ACTIVE_DEPLOYMENT');
      await tx.$queryRawUnsafe('SELECT id FROM partner_sale_cases WHERE id=$1 FOR UPDATE', caseId);
      await tx.$queryRawUnsafe('SELECT id FROM sales_contracts WHERE id=$1 FOR UPDATE', contractId);
      await tx.$queryRawUnsafe('SELECT id FROM accounting_financial_records WHERE id=$1 FOR UPDATE', invoiceId);
      await tx.$queryRawUnsafe('SELECT id FROM accounting_correction_requests WHERE id=$1 FOR UPDATE', requestId);
      await tx.$queryRawUnsafe('SELECT id FROM hr_duties WHERE id=$1 FOR UPDATE', dutyId);
      const actor = await tx.user.findUniqueOrThrow({ where: { username: 'admin' } });
      if (!actor.isActive || actor.role !== 'ADMIN') throw Error('ACTOR_NOT_ADMIN');
      const contract = await tx.salesContract.findUniqueOrThrow({ where: { id: contractId } });
      const root = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: caseId }, include: { profile: true } });
      if (contract.contractNumber !== '100697' || contract.partnerCaseId !== caseId || root.customerContractId !== contractId) throw Error('TARGET_MISMATCH');
      const invoice = await tx.accountingFinancialRecord.findUniqueOrThrow({ where: { id: invoiceId } });
      if (invoice.sourceKind !== 'PARTNER_INTERNAL_RECORD' || invoice.sourceId !== root.internalRecordId || invoice.status !== 'DRAFT' || invoice.kind !== 'INVOICE_CANDIDATE' || invoice.contractId || invoice.customerId || invoice.financiallyApprovedAt || invoice.financiallyApprovedBy || invoice.systemInvoiceNumber || invoice.postedAt || invoice.voidedAt) throw Error('NOT_UNISSUED_TARGET_DRAFT');
      await noDependencies(tx);
      const retained = invoice.sourceSnapshot?.partnerPreparation;
      const views = await readPartnerRevisionProjections(tx, retained.owner);
      const source = view => ({ view: { ...view, state: 'COMMITTED' }, partnerSellerId: root.profile.userId });
      const original = await preparePartnerFinancialSource(source(views.accounting), retained.owner);
      const current = await preparePartnerFinancialSource(source(await withCurrentSabalanPlan(tx, views.accounting)), retained.owner);
      if (!original.ok || !matchesFinancialPreparation(original.value, retained) || !current.ok || matchesFinancialPreparation(current.value, retained)) throw Error('ORIGINAL_BUG_NOT_REPRODUCED');
      const correction = await tx.accountingCorrectionRequest.findUniqueOrThrow({ where: { id: requestId } });
      if (correction.contractId !== contractId || correction.recordId !== invoiceId || correction.status !== 'APPROVED_FOR_SALES_EDIT') throw Error('CORRECTION_CHANGED');
      const duty = await tx.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: dutyId }, include: { assignmentHistory: true, auditVersions: true } });
      if (duty.sourceId !== requestId || duty.sourceType !== 'SALES_CONTRACT_CORRECTION' || duty.sourceActionCode !== 'SALES_EDIT_CONTRACT_CORRECTION' || duty.status !== 'OPEN') throw Error('DUTY_CHANGED');
      const openDuties = await tx.crossWorkspaceDuty.findMany({ where: { sourceType: 'SALES_CONTRACT_CORRECTION', sourceId: requestId, status: 'OPEN' } });
      if (openDuties.length !== 1 || openDuties[0].id !== dutyId) throw Error('OPEN_DUTY_POPULATION_CHANGED');
      const before = await fingerprints(tx);
      const otherInvoicesBefore = hash(await tx.accountingFinancialRecord.findMany({ where: { id: { not: invoiceId } }, orderBy: { id: 'asc' } }));
      const originalAudit = await tx.accountingAuditLog.findMany({ where: { OR: [{ recordId: invoiceId }, { entityId: invoiceId }, { entityId: requestId }, { contractId }] }, orderBy: { id: 'asc' } });
      const now = new Date();
      const cancelled = await cancelOpenCrossWorkspaceDuty(tx, { dutyId, structuredResult: { actionCode: 'OWNER_AUTHORIZED_DRAFT_RETIREMENT', reason: note, invoiceId } });
      if (cancelled.count !== 1) throw Error('DUTY_CANCEL_COUNT');
      await tx.crossWorkspaceDutyAssignmentHistory.updateMany({ where: { dutyId, endedAt: null }, data: { endedAt: now, endReason: 'SOURCE_CHANGED', changedByUserId: actor.id } });
      const version = (await tx.crossWorkspaceDutyAuditVersion.aggregate({ where: { dutyId }, _max: { version: true } }))._max.version ?? 0;
      await tx.crossWorkspaceDutyAuditVersion.create({ data: { dutyId, version: version + 1, eventCode: 'CANCELLED', actorUserId: actor.id, sourceVersion: duty.sourceVersion, envelopeVersion: duty.envelopeVersion, policyVersion: 1, beforeJson: json(duty), afterJson: { status: 'CANCELLED', reason: 'OWNER_AUTHORIZED_DRAFT_RETIREMENT' }, reason: note } });
      const closedCorrection = await tx.accountingCorrectionRequest.update({ where: { id: requestId }, data: { status: 'CANCELLED', assignedToUserId: null, resolvedBy: actor.id, resolvedAt: now, resolutionNote: [correction.resolutionNote, note].filter(Boolean).join('\n'), dutySourceVersion: { increment: 1 } } });
      const deleted = await tx.accountingFinancialRecord.deleteMany({ where: { id: invoiceId, status: 'DRAFT', sourceKind: 'PARTNER_INTERNAL_RECORD', sourceId: root.internalRecordId, systemInvoiceNumber: null, financiallyApprovedAt: null, postedAt: null } });
      if (deleted.count !== 1) throw Error('INVOICE_DELETE_COUNT');
      const archive = await tx.accountingAuditLog.create({ data: { action: 'OWNER_AUTHORIZED_PARTNER_DRAFT_RETIREMENT', actorId: actor.id, contractId, recordId: invoiceId, entityType: 'AccountingFinancialRecord', entityId: invoiceId, beforeState: json({ invoice, correction, duty, originalAudit }), afterState: json({ retired: true, deletedInvoiceId: invoiceId, correction: closedCorrection, backup: verifiedBackup, executionChannel: 'AUTHORIZED_SSH_REPAIR', historicalCommercialEvidenceUnchanged: true }), note } });
      await tx.accountingAuditLog.create({ data: { action: 'CANCEL_CORRECTION_ON_OWNER_AUTHORIZED_DRAFT_RETIREMENT', actorId: actor.id, contractId, recordId: invoiceId, entityType: 'AccountingCorrectionRequest', entityId: requestId, beforeState: json(correction), afterState: json(closedCorrection), note } });
      const reconciliation = await reconcileSalesContractCorrectionDuties(tx, { sourceIds: [requestId] });
      const preservedAudit = await tx.accountingAuditLog.findMany({ where: { id: { in: originalAudit.map(row => row.id) } }, orderBy: { id: 'asc' } });
      if (!reconciliation.ok || reconciliation.counts.openDuties !== 0 || hash(originalAudit) !== hash(preservedAudit) || hash(before) !== hash(await fingerprints(tx)) || otherInvoicesBefore !== hash(await tx.accountingFinancialRecord.findMany({ where: { id: { not: invoiceId } }, orderBy: { id: 'asc' } }))) throw Error('PRESERVATION_CHECK_FAILED');
      if (await tx.accountingFinancialRecord.count({ where: { id: invoiceId } })) throw Error('INVOICE_STILL_EXISTS');
      if (cleanupMode === 'REHEARSE') {
        // Route the standalone service harness through this rollback-only
        // transaction; the running backend and its singleton are untouched.
        const harness = new Proxy(tx, { get(target, property) { if (property === '$transaction') return operation => typeof operation === 'function' ? operation(harness) : Promise.all(operation); const value = target[property]; return typeof value === 'function' ? value.bind(target) : value; } });
        prismaModule.prisma = harness;
        try {
          const { listAccountingContracts } = require('/app/dist/services/accountingService');
          const list = await listAccountingContracts({ view: 'reviewable', lifecycleView: 'active', status: 'ALL', sourceStatus: 'ALL', page: 1, pageSize: 50 }, { userId: actor.id });
          if (!list.items?.length || !list.total) throw Error('ACCOUNTING_STILL_EMPTY');
          result = { verdict: 'REHEARSAL_PASS_ROLLED_BACK', total: list.total, rows: list.items.length, contractNumber: '100697', deletedInvoiceCount: deleted.count, preservedCaseTables: Object.keys(before).length, reconciliation };
        } finally { prismaModule.prisma = database; }
        throw Error('EXPECTED_REHEARSAL_ROLLBACK');
      }
      result = { verdict: 'COMMITTED', contractNumber: '100697', deletedInvoiceCount: deleted.count, auditId: archive.id, preservedCaseTables: Object.keys(before).length, reconciliation, committedAt: now.toISOString() };
    }, { isolationLevel: 'Serializable', timeout: 60000 });
  } catch (error) {
    if (error.message !== 'EXPECTED_REHEARSAL_ROLLBACK' || !result) throw error;
  }
  console.log(JSON.stringify(result));
})().catch(error => { console.error(JSON.stringify({ verdict: 'FAIL_NO_SUCCESS_CLAIM', code: error.code, message: error.message?.slice(0, 350) })); process.exitCode = 1; }).finally(() => { prismaModule.prisma = database; return database.$disconnect(); });
